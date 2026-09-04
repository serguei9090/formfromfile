package httpapi

import (
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/serguei9090/formfromfile/internal/store"
)

// --- owner: submissions for a template -----------------------------------

func (h *handlers) listSubmissions(w http.ResponseWriter, r *http.Request) {
	subs, err := h.opts.Store.ListSubmissions(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "schema not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"submissions": subs})
}

func (h *handlers) deleteSubmission(w http.ResponseWriter, r *http.Request) {
	err := h.opts.Store.DeleteSubmission(currentUser(r).ID, chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "submission not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *handlers) getSubmission(w http.ResponseWriter, r *http.Request) {
	sub, err := h.opts.Store.GetSubmission(currentUser(r).ID, chi.URLParam(r, "id"))
	if handleErr(w, err, "submission not found") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"submission": sub})
}

func (h *handlers) reviewSubmission(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Approved bool   `json:"approved"`
		Note     string `json:"note"`
	}
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	sub, err := h.opts.Store.ReviewSubmission(currentUser(r).ID, chi.URLParam(r, "id"), b.Approved, b.Note)
	if handleErr(w, err, "submission not found") {
		return
	}
	h.audit(r, "submission.review", sub.ID, map[bool]string{true: "approved", false: "rejected"}[b.Approved])
	if b.Approved {
		full, _ := h.opts.Store.GetSubmission(currentUser(r).ID, sub.ID)
		if full != nil {
			h.fireSubmissionWebhooks(sub.TemplateID, "submission.approved", full)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"submission": sub})
}

// --- public: fill a shared template -------------------------------------

// publicTemplate is the trimmed view a filler sees — no owner id, no sibling
// templates, no submissions.
type publicTemplate struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Body     string `json:"body"`
	FormJSON string `json:"formJson"`
	Brand    string `json:"brand,omitempty"`
}

func (h *handlers) publicTemplateBySlug(w http.ResponseWriter, r *http.Request) {
	sc, err := h.opts.Store.SchemaBySlug(chi.URLParam(r, "slug"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.opts.Store.BumpViewCount(sc.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"template": publicTemplate{
			Name: sc.Name, Kind: sc.Kind, Body: sc.Body, FormJSON: sc.FormJSON, Brand: sc.Brand,
		},
	})
}

type submissionBody struct {
	Submitter  string `json:"submitter"`
	ValuesJSON string `json:"valuesJson"`
	Output     string `json:"output"`
	Turnstile  string `json:"turnstileToken"`
}

func (h *handlers) createPublicSubmission(w http.ResponseWriter, r *http.Request) {
	if !submitLimiter.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "too many submissions, try again shortly")
		return
	}
	sc, err := h.opts.Store.SchemaBySlug(chi.URLParam(r, "slug"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	var b submissionBody
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	if secret := h.cfg().TurnstileSecret; secret != "" && !verifyTurnstile(r.Context(), secret, b.Turnstile, clientIP(r)) {
		writeErr(w, http.StatusForbidden, "captcha check failed — please retry")
		return
	}
	if len(b.ValuesJSON) > store.MaxSubmissionBody || len(b.Output) > store.MaxSubmissionBody {
		writeErr(w, http.StatusBadRequest, "submission too large (max 1 MiB)")
		return
	}
	if len(b.Submitter) > 200 {
		b.Submitter = b.Submitter[:200]
	}

	// a per-template cap wins; otherwise fall back to the org-wide default
	limit := sc.SubmissionCap
	if limit == 0 {
		limit = h.cfg().SubmissionCapDefault
	}
	if limit > 0 && h.opts.Store.SubmissionCount(sc.ID) >= limit {
		writeErr(w, http.StatusForbidden, "this form is no longer accepting submissions")
		return
	}

	// A logged-in filler is attributed; a share-link visitor is anonymous.
	filledBy := currentUser(r).ID

	saved, err := h.opts.Store.CreateSubmission(store.Submission{
		TemplateID: sc.ID,
		Submitter:  b.Submitter,
		ValuesJSON: b.ValuesJSON,
		Output:     b.Output,
	}, filledBy)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// only fire on creation for auto-approved submissions; gated ones fire on review
	if saved.Status == "approved" {
		h.fireSubmissionWebhooks(sc.ID, "submission.created", saved)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"submission": map[string]any{
		"id":        saved.ID,
		"createdAt": saved.CreatedAt,
	}})
}

// --- a tiny fixed-window per-IP limiter for the public submit route -----

type fixedWindow struct {
	mu     sync.Mutex
	hits   map[string][]int64
	limit  int
	window time.Duration
}

func (f *fixedWindow) allow(key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now().UnixNano()
	cutoff := now - int64(f.window)
	kept := f.hits[key][:0]
	for _, t := range f.hits[key] {
		if t > cutoff {
			kept = append(kept, t)
		}
	}
	if len(kept) >= f.limit {
		f.hits[key] = kept
		return false
	}
	f.hits[key] = append(kept, now)
	return true
}

var submitLimiter = &fixedWindow{hits: map[string][]int64{}, limit: 20, window: time.Minute}

func clientIP(r *http.Request) string {
	if r.RemoteAddr != "" {
		return r.RemoteAddr
	}
	return "unknown"
}
