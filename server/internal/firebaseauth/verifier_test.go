package firebaseauth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testProject = "test-project"
const testKid = "test-kid-1"

// newTestVerifier spins up a fake JWKS server backed by a fresh RSA key and
// returns a Verifier pointed at it, plus a function to sign a token with
// that key.
func newTestVerifier(t *testing.T) (*Verifier, func(claims idTokenClaims) string) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := base64.RawURLEncoding.EncodeToString(priv.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(priv.E)).Bytes())
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{"kid": testKid, "kty": "RSA", "n": n, "e": e}},
		})
	}))
	t.Cleanup(srv.Close)

	v := New(testProject)
	v.jwksURL = srv.URL

	sign := func(claims idTokenClaims) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		tok.Header["kid"] = testKid
		s, err := tok.SignedString(priv)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	return v, sign
}

func validClaims() idTokenClaims {
	now := time.Now()
	return idTokenClaims{
		Email:         "user@example.com",
		EmailVerified: true,
		Name:          "Test User",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "firebase-uid-123",
			Issuer:    "https://securetoken.google.com/" + testProject,
			Audience:  jwt.ClaimStrings{testProject},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
}

func TestVerifyIDToken_Valid(t *testing.T) {
	v, sign := newTestVerifier(t)
	claims, err := v.VerifyIDToken(context.Background(), sign(validClaims()))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.UID != "firebase-uid-123" || claims.Email != "user@example.com" || !claims.EmailVerified {
		t.Fatalf("claims: %+v", claims)
	}
}

func TestVerifyIDToken_NilVerifier(t *testing.T) {
	var v *Verifier
	if _, err := v.VerifyIDToken(context.Background(), "anything"); err != ErrNotConfigured {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
}

func TestVerifyIDToken_WrongAudience(t *testing.T) {
	v, sign := newTestVerifier(t)
	c := validClaims()
	c.Audience = jwt.ClaimStrings{"some-other-project"}
	if _, err := v.VerifyIDToken(context.Background(), sign(c)); err == nil {
		t.Fatal("expected an error for the wrong audience")
	}
}

func TestVerifyIDToken_WrongIssuer(t *testing.T) {
	v, sign := newTestVerifier(t)
	c := validClaims()
	c.Issuer = "https://securetoken.google.com/some-other-project"
	if _, err := v.VerifyIDToken(context.Background(), sign(c)); err == nil {
		t.Fatal("expected an error for the wrong issuer")
	}
}

func TestVerifyIDToken_Expired(t *testing.T) {
	v, sign := newTestVerifier(t)
	c := validClaims()
	c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour))
	if _, err := v.VerifyIDToken(context.Background(), sign(c)); err == nil {
		t.Fatal("expected an error for an expired token")
	}
}

func TestVerifyIDToken_NoSubject(t *testing.T) {
	v, sign := newTestVerifier(t)
	c := validClaims()
	c.Subject = ""
	if _, err := v.VerifyIDToken(context.Background(), sign(c)); err == nil {
		t.Fatal("expected an error for a missing subject")
	}
}

func TestVerifyIDToken_TamperedSignature(t *testing.T) {
	v, sign := newTestVerifier(t)
	tok := sign(validClaims())
	tampered := tok[:len(tok)-4] + "aaaa"
	if _, err := v.VerifyIDToken(context.Background(), tampered); err == nil {
		t.Fatal("expected an error for a tampered signature")
	}
}

func TestVerifyIDToken_UnknownKid(t *testing.T) {
	v, _ := newTestVerifier(t)
	priv2, _ := rsa.GenerateKey(rand.Reader, 2048)
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, validClaims())
	tok.Header["kid"] = "not-in-jwks"
	s, err := tok.SignedString(priv2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.VerifyIDToken(context.Background(), s); err == nil {
		t.Fatal("expected an error for an unrecognized kid")
	}
}

func TestVerifyIDToken_RejectsNoneAlg(t *testing.T) {
	v, _ := newTestVerifier(t)
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, validClaims())
	s, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.VerifyIDToken(context.Background(), s); err == nil {
		t.Fatal("expected alg=none to be rejected")
	}
}
