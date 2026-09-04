package httpapi

import (
	"errors"
	"net"
	"net/http"

	"github.com/serguei9090/formfromfile/internal/auth"
)

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *handlers) register(w http.ResponseWriter, r *http.Request) {
	if !h.opts.AllowRegister {
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

func throttleKey(r *http.Request, email string) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return host + "|" + email
}
