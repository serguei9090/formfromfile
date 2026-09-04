package httpapi

import (
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/serguei9090/formfromfile/internal/auth"
)

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *handlers) register(w http.ResponseWriter, r *http.Request) {
	if !h.cfg().AllowRegister {
		// still allow the very first (bootstrap admin) account
		if n, _ := h.opts.Store.CountUsers(); n > 0 {
			writeErr(w, http.StatusForbidden, auth.ErrRegisterClosed.Error())
			return
		}
	}
	var c credentials
	if err := decode(w, r, &c); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	u, err := h.opts.Auth.Register(c.Email, c.Password)
	if err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, auth.ErrTaken) {
			code = http.StatusConflict
		}
		writeErr(w, code, err.Error())
		return
	}
	token, u2, lerr := h.opts.Auth.Login(c.Email, c.Password, throttleKey(r, c.Email))
	if lerr != nil {
		// account made but auto-login failed — client can sign in manually
		writeJSON(w, http.StatusCreated, map[string]any{"user": u})
		return
	}
	h.setSessionCookie(w, r, token)
	writeJSON(w, http.StatusCreated, map[string]any{"user": u2})
}

func (h *handlers) login(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if err := decode(w, r, &c); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	token, u, err := h.opts.Auth.Login(c.Email, c.Password, throttleKey(r, c.Email))
	if err != nil {
		code := http.StatusUnauthorized
		if errors.Is(err, auth.ErrLockedOut) {
			code = http.StatusTooManyRequests
		}
		if errors.Is(err, auth.ErrDisabled) {
			code = http.StatusForbidden
		}
		writeErr(w, code, err.Error())
		return
	}
	h.setSessionCookie(w, r, token)
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (h *handlers) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		h.opts.Auth.Logout(c.Value)
	}
	h.clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *handlers) me(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}
	u, err := h.opts.Auth.UserByToken(r.Context(), c.Value)
	if err != nil {
		h.clearSessionCookie(w, r)
		writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

type firebaseSignInBody struct {
	IDToken string `json:"idToken"`
}

// firebaseLimiter caps how often one IP can hit the verify+provision path —
// Firebase already checked the credential, this just bounds the DB writes.
var firebaseLimiter = &fixedWindow{hits: map[string][]int64{}, limit: 30, window: time.Minute}

func (h *handlers) firebaseSignIn(w http.ResponseWriter, r *http.Request) {
	if !firebaseLimiter.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "too many attempts, try again shortly")
		return
	}
	if h.opts.Firebase == nil {
		writeErr(w, http.StatusNotImplemented, "Firebase sign-in is not configured")
		return
	}
	var b firebaseSignInBody
	if err := decode(w, r, &b); err != nil || b.IDToken == "" {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	claims, err := h.opts.Firebase.VerifyIDToken(r.Context(), b.IDToken)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid sign-in token")
		return
	}
	if !claims.EmailVerified {
		writeErr(w, http.StatusForbidden, auth.ErrEmailNotVerified.Error())
		return
	}

	token, u, err := h.opts.Auth.LoginOrProvisionFirebase(claims.UID, claims.Email)
	switch {
	case err == nil:
		h.setSessionCookie(w, r, token)
		writeJSON(w, http.StatusOK, map[string]any{"user": u})
	case errors.Is(err, auth.ErrDisabled):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, auth.ErrTaken):
		writeErr(w, http.StatusConflict, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, err.Error())
	}
}

func throttleKey(r *http.Request, email string) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return host + "|" + email
}
