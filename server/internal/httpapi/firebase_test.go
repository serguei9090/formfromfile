package httpapi

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/serguei9090/formfromfile/internal/auth"
	"github.com/serguei9090/formfromfile/internal/firebaseauth"
	"github.com/serguei9090/formfromfile/internal/store"
)

const fbTestProject = "test-project"
const fbTestKid = "kid-1"

// fbTestClaims mirrors the wire shape of a real Firebase ID token — a
// black-box test against the JSON payload, not firebaseauth's internals.
type fbTestClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	jwt.RegisteredClaims
}

// newFirebaseEnv builds a Router with Firebase sign-in enabled against a fake
// JWKS server, and returns a signer for minting test ID tokens.
func newFirebaseEnv(t *testing.T) (*testEnv, func(claims fbTestClaims) string) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwksSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := base64.RawURLEncoding.EncodeToString(priv.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(priv.E)).Bytes())
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{"kid": fbTestKid, "kty": "RSA", "n": n, "e": e}},
		})
	}))
	t.Cleanup(jwksSrv.Close)

	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	svc := auth.NewService(st)
	srv := httptest.NewServer(Router(Options{
		Store: st, Auth: svc, AllowRegister: true,
		Firebase: firebaseauth.NewWithJWKSURL(fbTestProject, jwksSrv.URL),
	}))
	t.Cleanup(srv.Close)

	jar, _ := cookiejar.New(nil)
	e := &testEnv{srv: srv, jar: jar, anon: &http.Client{}}

	sign := func(claims fbTestClaims) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		tok.Header["kid"] = fbTestKid
		s, err := tok.SignedString(priv)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	return e, sign
}

func fbValidClaims() fbTestClaims {
	now := time.Now()
	return fbTestClaims{
		Email:         "owner@example.com",
		EmailVerified: true,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "fb-uid-1",
			Issuer:    "https://securetoken.google.com/" + fbTestProject,
			Audience:  jwt.ClaimStrings{fbTestProject},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
}

func (e *testEnv) postRaw(t *testing.T, client *http.Client, path string, body []byte) (*http.Response, map[string]any) {
	t.Helper()
	res, err := client.Post(e.srv.URL+path, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	_ = res.Body.Close()
	return res, out
}

func TestFirebaseSignInDisabledByDefault(t *testing.T) {
	e := newEnv(t) // Router built with no Firebase option
	res, out := e.do(t, e.anon, "POST", "/api/auth/firebase", map[string]string{"idToken": "whatever"})
	if res.StatusCode != http.StatusNotImplemented {
		t.Fatalf("want 501, got %d %v", res.StatusCode, out)
	}
}

func TestFirebaseSignInFirstUserBecomesAdmin(t *testing.T) {
	e, sign := newFirebaseEnv(t)
	client := &http.Client{Jar: e.jar}

	body, _ := json.Marshal(map[string]string{"idToken": sign(fbValidClaims())})
	res, out := e.postRaw(t, client, "/api/auth/firebase", body)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("firebase sign-in: %d %v", res.StatusCode, out)
	}
	u := out["user"].(map[string]any)
	if u["email"] != "owner@example.com" || u["role"] != "admin" {
		t.Fatalf("unexpected user: %v", u)
	}
	if len(res.Cookies()) == 0 {
		t.Fatal("no session cookie set")
	}

	// the session works
	res2, out2 := e.do(t, client, "GET", "/api/auth/me", nil)
	if res2.StatusCode != http.StatusOK || out2["user"] == nil {
		t.Fatalf("me after firebase sign-in: %d %v", res2.StatusCode, out2)
	}
}

func TestFirebaseSignInSecondUserIsNotAdmin(t *testing.T) {
	e, sign := newFirebaseEnv(t)
	c1 := &http.Client{Jar: mustJar(t)}
	body1, _ := json.Marshal(map[string]string{"idToken": sign(fbValidClaims())})
	e.postRaw(t, c1, "/api/auth/firebase", body1)

	c2 := &http.Client{Jar: mustJar(t)}
	c2Claims := fbValidClaims()
	c2Claims.Email = "second@example.com"
	c2Claims.Subject = "fb-uid-2"
	body2, _ := json.Marshal(map[string]string{"idToken": sign(c2Claims)})
	res, out := e.postRaw(t, c2, "/api/auth/firebase", body2)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("second sign-in: %d %v", res.StatusCode, out)
	}
	u := out["user"].(map[string]any)
	if u["role"] != "user" {
		t.Fatalf("second firebase user role = %v, want user", u["role"])
	}
}

func TestFirebaseSignInUnverifiedEmailRejected(t *testing.T) {
	e, sign := newFirebaseEnv(t)
	claims := fbValidClaims()
	claims.EmailVerified = false
	body, _ := json.Marshal(map[string]string{"idToken": sign(claims)})
	res, out := e.postRaw(t, &http.Client{Jar: mustJar(t)}, "/api/auth/firebase", body)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("unverified email: want 403, got %d %v", res.StatusCode, out)
	}
}

func TestFirebaseSignInInvalidToken(t *testing.T) {
	e, _ := newFirebaseEnv(t)
	body, _ := json.Marshal(map[string]string{"idToken": "not-a-jwt"})
	res, out := e.postRaw(t, &http.Client{Jar: mustJar(t)}, "/api/auth/firebase", body)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("garbage token: want 401, got %d %v", res.StatusCode, out)
	}
}

func TestFirebaseSecurityHeaders(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	srv := httptest.NewServer(Router(Options{
		Store: st, Auth: auth.NewService(st), AllowRegister: true,
		Firebase:           firebaseauth.New(fbTestProject),
		FirebaseAuthDomain: "demo-project.firebaseapp.com",
	}))
	t.Cleanup(srv.Close)

	res, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()

	if got := res.Header.Get("Cross-Origin-Opener-Policy"); got != "same-origin-allow-popups" {
		t.Fatalf("COOP with firebase configured: %q, want same-origin-allow-popups (signInWithPopup breaks under strict same-origin)", got)
	}
	csp := res.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "frame-src https://demo-project.firebaseapp.com") {
		t.Fatalf("authDomain not in frame-src: %q", csp)
	}
	if !strings.Contains(csp, "https://*.googleapis.com") || !strings.Contains(csp, "https://securetoken.google.com") {
		t.Fatalf("google identity APIs not in connect-src: %q", csp)
	}
}

func mustJar(t *testing.T) http.CookieJar {
	t.Helper()
	j, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return j
}
