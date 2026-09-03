package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/serguei9090/formfromfile/internal/auth"
)

func (h *handlers) listUsers(w http.ResponseWriter, _ *http.Request) {
	users, err := h.opts.Auth.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (h *handlers) setUserDisabled(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Disabled bool `json:"disabled"`
	}
	_ = decode(w, r, &b)
	err := h.opts.Auth.SetDisabled(chi.URLParam(r, "id"), b.Disabled)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case errors.Is(err, auth.ErrLastAdmin):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, auth.ErrNotFound):
		writeErr(w, http.StatusNotFound, "user not found")
	default:
		writeErr(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *handlers) setUserRole(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Role string `json:"role"`
	}
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	err := h.opts.Auth.SetRole(chi.URLParam(r, "id"), auth.Role(b.Role))
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case errors.Is(err, auth.ErrInvalidRole):
		writeErr(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, auth.ErrLastAdmin):
		writeErr(w, http.StatusConflict, "cannot demote the last admin")
	case errors.Is(err, auth.ErrNotFound):
		writeErr(w, http.StatusNotFound, "user not found")
	default:
		writeErr(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *handlers) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Password string `json:"password"`
	}
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	err := h.opts.Auth.ResetPassword(chi.URLParam(r, "id"), b.Password)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case errors.Is(err, auth.ErrWeakPassword):
		writeErr(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, auth.ErrNotFound):
		writeErr(w, http.StatusNotFound, "user not found")
	default:
		writeErr(w, http.StatusInternalServerError, err.Error())
	}
}
