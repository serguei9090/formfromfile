package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/serguei9090/formfromfile/internal/netguard"
)

// checkClient is used for the async-validation proxy — short timeout, no redirects
// to keep the SSRF surface small.
var checkClient = &http.Client{
	Timeout: 5 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

type checkReq struct {
	Path  string `json:"path"`
	Value string `json:"value"`
}

// validateProxy runs a template's author-configured `checkUrl` for one field.
// The URL comes from the stored template meta (never the request body), so a
// filler can't turn this into an open proxy. Private / loopback targets are
// rejected.
func (h *handlers) validateProxy(w http.ResponseWriter, r *http.Request) {
	if !submitLimiter.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	sc, err := h.opts.Store.SchemaBySlug(chi.URLParam(r, "slug"))
	if handleErr(w, err, "template not found") {
		return
	}
	var b checkReq
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	target := checkURLFor(sc.FormJSON, b.Path)
	if target == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if !netguard.SafeOutboundURL(target) {
		writeErr(w, http.StatusBadRequest, "check URL not allowed")
		return
	}

	payload, _ := json.Marshal(map[string]string{"value": b.Value})
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodPost, target, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	res, err := checkClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "message": "validation service unreachable"})
		return
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	var out map[string]any
	if json.Unmarshal(body, &out) == nil {
		writeJSON(w, http.StatusOK, out)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": res.StatusCode < 400})
}

// checkURLFor digs `meta.<path>.checkUrl` out of a stored formJson blob.
func checkURLFor(formJSON, path string) string {
	var parsed struct {
		Meta map[string]struct {
			CheckURL string `json:"checkUrl"`
		} `json:"meta"`
	}
	if json.Unmarshal([]byte(formJSON), &parsed) != nil {
		return ""
	}
	return parsed.Meta[path].CheckURL
}
