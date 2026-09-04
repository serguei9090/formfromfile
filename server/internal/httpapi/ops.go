package httpapi

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// audit records a state change (best-effort).
func (h *handlers) audit(r *http.Request, action, target, detail string) {
	u := currentUser(r)
	h.opts.Store.Audit(u.ID, u.Email, action, target, detail)
}

func (h *handlers) adminAudit(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, err := h.opts.Store.RecentAudit(n)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (h *handlers) setTemplateOps(w http.ResponseWriter, r *http.Request) {
	var b struct {
		SubmissionCap int    `json:"submissionCap"`
		Brand         string `json:"brand"`
		RetentionDays int    `json:"retentionDays"`
	}
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	if b.SubmissionCap < 0 {
		b.SubmissionCap = 0
	}
	if b.RetentionDays < 0 {
		b.RetentionDays = 0
	}
	if len(b.Brand) > 200_000 {
		writeErr(w, http.StatusBadRequest, "brand too large")
		return
	}
	sc, err := h.opts.Store.SetTemplateOps(currentUser(r).ID, chi.URLParam(r, "id"), b.SubmissionCap, b.RetentionDays, b.Brand)
	if handleErr(w, err, "schema not found") {
		return
	}
	h.audit(r, "template.ops", sc.ID, "")
	writeJSON(w, http.StatusOK, map[string]any{"schema": sc})
}
