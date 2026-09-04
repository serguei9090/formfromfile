package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/serguei9090/formfromfile/internal/auth"
	"github.com/serguei9090/formfromfile/internal/store"
)

func (h *handlers) createUser(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	role := auth.Role(b.Role)
	if role == "" {
		role = auth.RoleUser
	}
	u, generated, err := h.opts.Auth.CreateUser(b.Email, b.Password, role)
	switch {
	case err == nil:
		h.audit(r, "user.create", u.ID, u.Email)
		resp := map[string]any{"user": u}
		if generated != "" {
			resp["generatedPassword"] = generated
		}
		writeJSON(w, http.StatusCreated, resp)
	case errors.Is(err, auth.ErrTaken):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, auth.ErrWeakPassword), errors.Is(err, auth.ErrInvalidRole):
		writeErr(w, http.StatusBadRequest, err.Error())
	default:
		writeErr(w, http.StatusBadRequest, err.Error())
	}
}

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
		h.audit(r, "user.role", chi.URLParam(r, "id"), b.Role)
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

// --- GDPR: export / erase a user's data (admin) -------------------------

func (h *handlers) exportUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ex, err := h.opts.Store.ExportUser(id)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.opts.Store.LogDataOp(currentUser(r).Email, "user.export", id, ex.User.Email)
	h.audit(r, "user.export", id, ex.User.Email)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="fff-user-`+id+`.json"`)
	_ = json.NewEncoder(w).Encode(ex)
}

func (h *handlers) eraseUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var b struct {
		Confirm string `json:"confirm"`
	}
	_ = decode(w, r, &b)
	if b.Confirm != "ERASE" {
		writeErr(w, http.StatusBadRequest, `send {"confirm":"ERASE"} to proceed`)
		return
	}
	if id == currentUser(r).ID {
		writeErr(w, http.StatusBadRequest, "you can't erase your own account here")
		return
	}
	err := h.opts.Store.EraseUser(id)
	switch {
	case err == nil:
		h.opts.Store.LogDataOp(currentUser(r).Email, "user.erase", id, "")
		h.audit(r, "user.erase", id, "")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case errors.Is(err, store.ErrLastAdmin):
		writeErr(w, http.StatusConflict, "cannot erase the last admin")
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "user not found")
	default:
		writeErr(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *handlers) adminDataOps(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	ops, err := h.opts.Store.RecentDataOps(n)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": ops})
}
