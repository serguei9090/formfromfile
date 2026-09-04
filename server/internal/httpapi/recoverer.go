package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// recoverer catches a panic in a handler, logs it with the request id, writes a
// 500, and — if Options.ErrorWebhook is set — POSTs a JSON report there. It
// replaces chi's middleware.Recoverer so the report hook can be added.
func (h *handlers) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			if rec == http.ErrAbortHandler { //nolint:errorlint // sentinel compare, as chi does
				panic(rec)
			}
			reqID := middleware.GetReqID(r.Context())
			stack := debug.Stack()
			slog.LogAttrs(r.Context(), slog.LevelError, "panic",
				slog.String("id", reqID),
				slog.String("path", r.URL.Path),
				slog.Any("err", rec),
				slog.String("stack", string(stack)),
			)
			if h.opts.ErrorWebhook != "" {
				go postErrorReport(h.opts.ErrorWebhook, errorReport{
					Time:      time.Now().UTC().Format(time.RFC3339),
					RequestID: reqID,
					Method:    r.Method,
					Path:      r.URL.Path,
					Error:     sprint(rec),
					Stack:     string(stack),
				})
			}
			if !headersSent(w) {
				writeErr(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type errorReport struct {
	Time      string `json:"time"`
	RequestID string `json:"requestId"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Error     string `json:"error"`
	Stack     string `json:"stack"`
}

func postErrorReport(url string, rep errorReport) {
	body, _ := json.Marshal(rep)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

func sprint(v any) string {
	if err, ok := v.(error); ok {
		return err.Error()
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// headersSent is a best-effort check so we don't double-write a response.
func headersSent(w http.ResponseWriter) bool {
	if ww, ok := w.(middleware.WrapResponseWriter); ok {
		return ww.Status() != 0
	}
	return false
}
