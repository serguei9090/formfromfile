// Package firebaseauth verifies Firebase Authentication ID tokens (Google
// sign-in, or Firebase's own email sign-in) without the Firebase Admin SDK —
// that pulls a large cloud.google.com/go dependency tree and needs a service
// account key just to check a signature. A Firebase ID token is a standard
// RS256 JWT signed by Google; verifying it needs only the project id (public)
// and Google's public signing keys (published, rotated periodically). See
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library.
package firebaseauth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// defaultJWKSURL serves Google's current signing keys for Firebase ID tokens,
// in standard JWK Set format.
const defaultJWKSURL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"

// ErrNotConfigured is returned by a nil *Verifier — the httpapi layer treats
// this the same as "Firebase sign-in is off" (501 to the client).
var ErrNotConfigured = errors.New("firebase sign-in is not configured")

// Claims is what the caller needs from a verified ID token.
type Claims struct {
	UID           string
	Email         string
	EmailVerified bool
	Name          string
	Picture       string
}

// Verifier checks Firebase ID tokens for one Firebase project. Safe for
// concurrent use; caches Google's public keys for up to an hour.
type Verifier struct {
	projectID string
	jwksURL   string
	client    *http.Client

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

// New builds a verifier for the given Firebase project id. No credentials
// are needed — only the (public) project id.
func New(projectID string) *Verifier {
	return NewWithJWKSURL(projectID, defaultJWKSURL)
}

// NewWithJWKSURL is New with the signing-key endpoint overridden — for tests
// that stand up a fake JWKS server rather than calling out to Google.
func NewWithJWKSURL(projectID, jwksURL string) *Verifier {
	return &Verifier{
		projectID: projectID,
		jwksURL:   jwksURL,
		client:    &http.Client{Timeout: 5 * time.Second},
	}
}

type idTokenClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	jwt.RegisteredClaims
}

// VerifyIDToken checks the token's signature against Google's published keys
// and validates alg=RS256, iss, aud, and expiry. A nil receiver always
// returns ErrNotConfigured, so callers can pass a possibly-nil *Verifier
// straight through without a separate "is this enabled" check.
func (v *Verifier) VerifyIDToken(ctx context.Context, idToken string) (*Claims, error) {
	if v == nil {
		return nil, ErrNotConfigured
	}
	var claims idTokenClaims
	parsed, err := jwt.ParseWithClaims(idToken, &claims, v.keyFunc(ctx),
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer("https://securetoken.google.com/"+v.projectID),
		jwt.WithAudience(v.projectID),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, fmt.Errorf("invalid firebase id token: %w", err)
	}
	if !parsed.Valid {
		return nil, errors.New("invalid firebase id token")
	}
	if claims.Subject == "" {
		return nil, errors.New("firebase id token has no subject")
	}
	return &Claims{
		UID:           claims.Subject,
		Email:         claims.Email,
		EmailVerified: claims.EmailVerified,
		Name:          claims.Name,
		Picture:       claims.Picture,
	}, nil
}

func (v *Verifier) keyFunc(ctx context.Context) jwt.Keyfunc {
	return func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("token has no kid header")
		}
		return v.publicKey(ctx, kid)
	}
}

// publicKey resolves kid from the cache, refreshing it if stale or missing.
// A refresh failure falls back to a still-cached (but stale) key rather than
// failing outright — Google rotates keys well before the old ones stop
// working, so a transient fetch error shouldn't lock everyone out.
func (v *Verifier) publicKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	key, ok := v.keys[kid]
	stale := time.Since(v.fetchedAt) > time.Hour
	v.mu.Unlock()
	if ok && !stale {
		return key, nil
	}

	if err := v.refreshKeys(ctx); err != nil {
		if ok {
			return key, nil
		}
		return nil, err
	}

	v.mu.Lock()
	key, ok = v.keys[kid]
	v.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("unknown firebase signing key %q", kid)
	}
	return key, nil
}

type jwkSet struct {
	Keys []struct {
		Kid string `json:"kid"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

func (v *Verifier) refreshKeys(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return err
	}
	res, err := v.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("fetch firebase signing keys: status %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	var set jwkSet
	if err := json.Unmarshal(body, &set); err != nil {
		return err
	}
	next := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		pub, err := rsaPublicKey(k.N, k.E)
		if err != nil {
			continue // one malformed entry shouldn't drop the whole set
		}
		next[k.Kid] = pub
	}
	if len(next) == 0 {
		return errors.New("no usable signing keys returned")
	}
	v.mu.Lock()
	v.keys = next
	v.fetchedAt = time.Now()
	v.mu.Unlock()
	return nil
}

func rsaPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, err
	}
	e := new(big.Int).SetBytes(eBytes)
	if !e.IsInt64() {
		return nil, errors.New("exponent out of range")
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: int(e.Int64())}, nil
}
