package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/serguei9090/formfromfile/internal/metrics"
)

// requestLogger emits one structured line per request (method, path, status,
// bytes, duration, request id, client) and feeds the /metrics counters. Pair
// it with middleware.RequestID.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)

		status := ww.Status()
		dur := time.Since(start)

		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "other" // unmatched — keep label cardinality bounded
		}
		metrics.HTTPRequests.Inc(r.Method, route, strconv.Itoa(status))
		metrics.HTTPDuration.Observe(dur.Seconds())

		lvl := slog.LevelInfo
		switch {
		case status >= 500:
			lvl = slog.LevelError
		case status >= 400:
			lvl = slog.LevelWarn
		}
		slog.LogAttrs(r.Context(), lvl, "http",
			slog.String("id", middleware.GetReqID(r.Context())),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", status),
			slog.Int("bytes", ww.BytesWritten()),
			slog.Duration("dur", dur),
			slog.String("ip", clientIP(r)),
		)
	})
}
