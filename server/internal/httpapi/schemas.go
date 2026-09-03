package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/serguei9090/formfromfile/internal/store"
)

func (h *handlers) listSchemas(w http.ResponseWriter, r *http.Request) {
	list, err := h.opts.Store.ListSchemas(currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemas": list})
}

func (h *handlers) getSchema(w http.ResponseWriter, r *http.Request) {
	sc, err := h.opts.Store.GetSchema(currentUser(r).ID, chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "schema not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": sc})
}

type schemaBody struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Body     string `json:"body"`
	FormJSON string `json:"formJson"`
}

// validKinds is the set of accepted schema formats. F12 extends this as new
// format plugins land.
var validKinds = map[string]bool{"xml": true, "yaml": true, "json": true}

func (b schemaBody) validate() (store.Schema, string) {
	name := strings.TrimSpace(b.Name)
	if name == "" {
		return store.Schema{}, "a name is required"
	}
	if !validKinds[b.Kind] {
		return store.Schema{}, "kind must be xml, yaml or json"
	}
	if len(b.Body) > store.MaxSchemaBody || len(b.FormJSON) > store.MaxSchemaBody {
		return store.Schema{}, "file too large (max 1 MiB)"
	}
	return store.Schema{Name: name, Kind: b.Kind, Body: b.Body, FormJSON: b.FormJSON}, ""
}

func (h *handlers) createSchema(w http.ResponseWriter, r *http.Request) {
	var b schemaBody
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	sc, msg := b.validate()
	if msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	saved, err := h.opts.Store.CreateSchema(currentUser(r).ID, sc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"schema": saved})
}

func (h *handlers) updateSchema(w http.ResponseWriter, r *http.Request) {
	var b schemaBody
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	sc, msg := b.validate()
	if msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	saved, err := h.opts.Store.UpdateSchema(currentUser(r).ID, chi.URLParam(r, "id"), sc)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "schema not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": saved})
}

func (h *handlers) publishSchema(w http.ResponseWriter, r *http.Request) {
	sc, err := h.opts.Store.PublishSchema(currentUser(r).ID, chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "schema not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": sc})
}

func (h *handlers) unpublishSchema(w http.ResponseWriter, r *http.Request) {
	sc, err := h.opts.Store.UnpublishSchema(currentUser(r).ID, chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "schema not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": sc})
}

func (h *handlers) deleteSchema(w http.ResponseWriter, r *http.Request) {
	err := h.opts.Store.DeleteSchema(currentUser(r).ID, chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "schema not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
