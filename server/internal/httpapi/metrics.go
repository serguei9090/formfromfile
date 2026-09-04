package httpapi

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/serguei9090/formfromfile/internal/metrics"
)

// metricsHandler serves the Prometheus text exposition. It is mounted only when
// Options.MetricsToken is set, and requires `Authorization: Bearer <token>`.
func (h *handlers) metricsHandler(w http.ResponseWriter, r *http.Request) {
	want := h.opts.MetricsToken
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if want == "" || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="metrics"`)
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	metrics.R.WriteText(w)
}
