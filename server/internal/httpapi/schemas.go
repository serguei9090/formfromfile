package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/serguei9090/formfromfile/internal/store"
)

func (h *handlers) listSchemas(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	list, err := h.opts.Store.ListSchemas(currentUser(r).ID, store.SchemaFilter{
		Folder: q.Get("folder"),
		Tag:    q.Get("tag"),
		Query:  q.Get("q"),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemas": list})
}

func (h *handlers) getSchema(w http.ResponseWriter, r *http.Request) {
	sc, err := h.opts.Store.GetSchema(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": sc})
}

type schemaBody struct {
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Body     string   `json:"body"`
	FormJSON string   `json:"formJson"`
	Folder   string   `json:"folder"`
	Tags     []string `json:"tags"`
	Notes    string   `json:"notes"`
}

// validKinds is the set of accepted schema formats (the frontend's formatId).
var validKinds = map[string]bool{
	"xml": true, "yaml": true, "json": true,
	"toml": true, "ini": true, "csv": true, "dotenv": true,
}

func (b schemaBody) validate() (store.Schema, string) {
	name := strings.TrimSpace(b.Name)
	if name == "" {
		return store.Schema{}, "a name is required"
	}
	if !validKinds[b.Kind] {
		return store.Schema{}, "unsupported kind"
	}
	if len(b.Body) > store.MaxSchemaBody || len(b.FormJSON) > store.MaxSchemaBody {
		return store.Schema{}, "file too large (max 1 MiB)"
	}
	tags := b.Tags
	if tags == nil {
		tags = []string{}
	}
	return store.Schema{
		Name: name, Kind: b.Kind, Body: b.Body, FormJSON: b.FormJSON,
		Folder: strings.TrimSpace(b.Folder), Tags: tags,
	}, ""
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
	saved, err := h.opts.Store.UpdateSchema(currentUser(r).ID, chi.URLParam(r, "id"), sc, strings.TrimSpace(b.Notes))
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": saved})
}

func (h *handlers) forkSchema(w http.ResponseWriter, r *http.Request) {
	sc, err := h.opts.Store.ForkSchema(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"schema": sc})
}

func (h *handlers) listVersions(w http.ResponseWriter, r *http.Request) {
	vs, err := h.opts.Store.ListVersions(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": vs})
}

func (h *handlers) getVersion(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(chi.URLParam(r, "n"))
	v, err := h.opts.Store.GetVersion(currentUser(r).ID, chi.URLParam(r, "id"), n)
	if handleErr(w, err, "version not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": v})
}

func (h *handlers) rollbackSchema(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(chi.URLParam(r, "n"))
	sc, err := h.opts.Store.RollbackSchema(currentUser(r).ID, chi.URLParam(r, "id"), n)
	if handleErr(w, err, "version not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": sc})
}

func (h *handlers) publishSchema(w http.ResponseWriter, r *http.Request) {
	sc, err := h.opts.Store.PublishSchema(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": sc})
}

func (h *handlers) unpublishSchema(w http.ResponseWriter, r *http.Request) {
	sc, err := h.opts.Store.UnpublishSchema(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": sc})
}

func (h *handlers) setApprovalGate(w http.ResponseWriter, r *http.Request) {
	var b struct {
		RequiresApproval bool `json:"requiresApproval"`
	}
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	sc, err := h.opts.Store.SetApprovalGate(currentUser(r).ID, chi.URLParam(r, "id"), b.RequiresApproval)
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schema": sc})
}

func (h *handlers) deleteSchema(w http.ResponseWriter, r *http.Request) {
	err := h.opts.Store.DeleteSchema(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleErr writes a 404 for ErrNotFound, a 500 for any other error, and
// reports whether the caller should stop. Returns false when err is nil.
func handleErr(w http.ResponseWriter, err error, notFoundMsg string) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, notFoundMsg)
		return true
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
	return true
}
