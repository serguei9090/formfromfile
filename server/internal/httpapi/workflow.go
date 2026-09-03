package httpapi

import (
	"archive/zip"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/serguei9090/formfromfile/internal/store"
	"github.com/serguei9090/formfromfile/internal/webhook"
)

// --- submission comments -------------------------------------------------

func (h *handlers) listComments(w http.ResponseWriter, r *http.Request) {
	cs, err := h.opts.Store.ListComments(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "submission not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"comments": cs})
}

func (h *handlers) addComment(w http.ResponseWriter, r *http.Request) {
	var b struct{ Body string }
	if err := decode(w, r, &b); err != nil || strings.TrimSpace(b.Body) == "" {
		writeErr(w, http.StatusBadRequest, "a comment body is required")
		return
	}
	u := currentUser(r)
	c, err := h.opts.Store.AddComment(u.ID, chi.URLParam(r, "id"), u.Email, strings.TrimSpace(b.Body))
	if handleErr(w, err, "submission not found") {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"comment": c})
}

// --- webhooks ----------------------------------------------------------

func (h *handlers) listWebhooks(w http.ResponseWriter, r *http.Request) {
	whs, err := h.opts.Store.ListWebhooks(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"webhooks": whs})
}

func (h *handlers) addWebhook(w http.ResponseWriter, r *http.Request) {
	var b struct {
		URL    string   `json:"url"`
		Events []string `json:"events"`
	}
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	if !strings.HasPrefix(b.URL, "https://") && !strings.HasPrefix(b.URL, "http://") {
		writeErr(w, http.StatusBadRequest, "url must be http(s)")
		return
	}
	wh, err := h.opts.Store.AddWebhook(currentUser(r).ID, chi.URLParam(r, "id"), b.URL, b.Events)
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"webhook": wh})
}

func (h *handlers) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	if handleErr(w, h.opts.Store.DeleteWebhook(currentUser(r).ID, chi.URLParam(r, "id")), "webhook not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *handlers) listDeliveries(w http.ResponseWriter, r *http.Request) {
	ds, err := h.opts.Store.ListDeliveries(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "webhook not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deliveries": ds})
}

// fireSubmissionWebhooks POSTs to a template's webhooks (background).
func (h *handlers) fireSubmissionWebhooks(templateID, event string, sub *store.Submission) {
	rows, err := h.opts.Store.WebhooksForTemplate(templateID)
	if err != nil || len(rows) == 0 {
		return
	}
	targets := make([]webhook.Target, len(rows))
	for i, wh := range rows {
		targets[i] = webhook.Target{ID: wh.ID, URL: wh.URL, Secret: wh.Secret, Events: wh.Events}
	}
	webhook.Fire(targets, templateID, event, sub, sub.Output,
		func(id string, code, attempts int, errMsg string) {
			h.opts.Store.RecordDelivery(id, event, code, attempts, errMsg)
		})
}

// --- submissions.zip -------------------------------------------------

func (h *handlers) submissionsZip(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	list, err := h.opts.Store.ListSubmissions(currentUser(r).ID, id)
	if handleErr(w, err, "schema not found") {
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="submissions.zip"`)
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, s := range list {
		full, err := h.opts.Store.GetSubmission(currentUser(r).ID, s.ID)
		if err != nil {
			continue
		}
		name := sanitize(full.Submitter)
		if name == "" {
			name = "anon"
		}
		f, err := zw.Create(name + "-" + full.ID + ".txt")
		if err != nil {
			return
		}
		_, _ = f.Write([]byte(full.Output))
	}
}

func sanitize(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == '\n' || r == '\r' {
			return '_'
		}
		return r
	}, s)
	if len(s) > 40 {
		s = s[:40]
	}
	return strings.TrimSpace(s)
}
