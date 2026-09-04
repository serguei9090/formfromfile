package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/serguei9090/formfromfile/internal/auth"
)

type ctxKey int

const userKey ctxKey = 0

const sessionCookie = "fff_session"

// currentUser returns the authenticated user for a request handled behind
// requireAuth.
func currentUser(r *http.Request) auth.User {
	u, _ := r.Context().Value(userKey).(auth.User)
	return u
}

func (h *handlers) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "not signed in")
			return
		}
		u, err := h.opts.Auth.UserByToken(r.Context(), c.Value)
		if err != nil {
			clearSessionCookie(w, r)
			writeErr(w, http.StatusUnauthorized, "session expired")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	})
}

func (h *handlers) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !currentUser(r).IsAdmin() {
			writeErr(w, http.StatusForbidden, "admin only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// trustedProxyIP rewrites r.RemoteAddr from X-Forwarded-For (first hop) or
// X-Real-IP. Applied ONLY when Options.TrustProxy is set, i.e. the operator has
// asserted a reverse proxy overwrites those headers. Without that assertion the
// socket address is used and cannot be spoofed.
func trustedProxyIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if i := strings.IndexByte(xff, ','); i >= 0 {
				xff = xff[:i]
			}
			r.RemoteAddr = strings.TrimSpace(xff)
		} else if xr := r.Header.Get("X-Real-IP"); xr != "" {
			r.RemoteAddr = strings.TrimSpace(xr)
		}
		next.ServeHTTP(w, r)
	})
}

// requireAuthor gates template creation / editing / publishing. `user`-role
// accounts can fill forms but not author them.
func (h *handlers) requireAuthor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !currentUser(r).CanAuthor() {
			writeErr(w, http.StatusForbidden, "you don't have permission to author templates")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(auth.SessionTTL.Seconds()),
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}
