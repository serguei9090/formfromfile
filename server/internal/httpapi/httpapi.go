// Package httpapi wires the FormFromFile HTTP router.
package httpapi

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/serguei9090/formfromfile/internal/ai"
	"github.com/serguei9090/formfromfile/internal/auth"
	"github.com/serguei9090/formfromfile/internal/store"
)

// Options configures the router.
type Options struct {
	Store         *store.Store
	Auth          *auth.Service
	AI            ai.Service
	AllowRegister bool
	// WebhookAllowPrivate lets webhook targets point at LAN / loopback
	// addresses (internal deployments). Default false blocks them.
	WebhookAllowPrivate bool
	// TrustProxy: honour X-Forwarded-For / X-Real-IP for rate-limit keys.
	// Only enable behind a reverse proxy that overwrites those headers —
	// otherwise clients spoof their IP. Default false: use the socket address.
	TrustProxy bool
	// TurnstileSiteKey is exposed to the SPA; TurnstileSecret verifies tokens.
	// Both set → the public fill page shows a challenge and submits are checked.
	TurnstileSiteKey string
	TurnstileSecret  string
	// DisableSecurityHeaders turns off the securityHeaders middleware
	// (FFF_SECURITY_HEADERS=off). Default (zero value) keeps them on.
	DisableSecurityHeaders bool
	// MetricsToken, when set (FFF_METRICS_TOKEN), mounts GET /metrics behind a
	// bearer-token check. Empty → no /metrics route at all.
	MetricsToken string
	// ErrorWebhook, when set (FFF_ERROR_WEBHOOK), receives a JSON POST on every
	// recovered panic (request id, path, error, stack).
	ErrorWebhook string
	// StaticFS serves the built SPA (web/dist). Nil in dev — Vite proxies /api.
	StaticFS fs.FS
}

// Router builds the full handler tree.
func Router(opts Options) http.Handler {
	h := &handlers{opts: opts}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	if !opts.DisableSecurityHeaders {
		r.Use(h.securityHeaders)
	}
	if opts.TrustProxy {
		r.Use(trustedProxyIP)
	}
	r.Use(requestLogger)
	r.Use(h.recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	if opts.MetricsToken != "" {
		r.Get("/metrics", h.metricsHandler)
	}

	r.Route("/api", func(r chi.Router) {
		r.Get("/config", h.getConfig)

		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", h.register)
			r.Post("/login", h.login)
			r.Post("/logout", h.logout)
			r.Get("/me", h.me)
		})

		// Public: fill a shared template by slug. No auth.
		r.Get("/public/templates/{slug}", h.publicTemplateBySlug)
		r.Post("/public/templates/{slug}/submissions", h.createPublicSubmission)
		r.Post("/public/templates/{slug}/check", h.validateProxy)

		r.Group(func(r chi.Router) {
			r.Use(h.requireAuth)
			r.Get("/schemas", h.listSchemas)
			r.Get("/schemas/{id}", h.getSchema)
			r.Get("/schemas/{id}/versions", h.listVersions)
			r.Get("/schemas/{id}/versions/{n}", h.getVersion)
			r.Get("/schemas/{id}/submissions", h.listSubmissions)
			r.Get("/schemas/{id}/submissions.zip", h.submissionsZip)
			r.Get("/submissions/{id}", h.getSubmission)
			r.Get("/submissions/{id}/comments", h.listComments)
			r.Post("/submissions/{id}/comments", h.addComment)
			r.Post("/submissions/{id}/review", h.reviewSubmission)
			r.Delete("/submissions/{id}", h.deleteSubmission)
			r.Get("/schemas/{id}/webhooks", h.listWebhooks)
			r.Get("/webhooks/{id}/deliveries", h.listDeliveries)

			r.Get("/ai/status", h.aiStatus)
			r.Post("/ai/suggest-meta", h.aiSuggestMeta)
			r.Post("/ai/explain-diff", h.aiExplainDiff)
			r.Post("/ai/schema-from-prompt", h.aiSchemaFromPrompt)
			r.Post("/ai/fill-assist", h.aiFillAssist)

			r.Group(func(r chi.Router) {
				r.Use(h.requireAuthor)
				r.Post("/schemas", h.createSchema)
				r.Put("/schemas/{id}", h.updateSchema)
				r.Delete("/schemas/{id}", h.deleteSchema)
				r.Post("/schemas/{id}/fork", h.forkSchema)
				r.Post("/schemas/{id}/rollback/{n}", h.rollbackSchema)
				r.Post("/schemas/{id}/publish", h.publishSchema)
				r.Post("/schemas/{id}/unpublish", h.unpublishSchema)
				r.Post("/schemas/{id}/approval", h.setApprovalGate)
				r.Post("/schemas/{id}/webhooks", h.addWebhook)
				r.Delete("/webhooks/{id}", h.deleteWebhook)
				r.Post("/schemas/{id}/ops", h.setTemplateOps)
			})
		})

		r.Group(func(r chi.Router) {
			r.Use(h.requireAuth)
			r.Use(h.requireAdmin)
			r.Get("/admin/users", h.listUsers)
			r.Post("/admin/users/{id}/disable", h.setUserDisabled)
			r.Post("/admin/users/{id}/reset", h.resetUserPassword)
			r.Post("/admin/users/{id}/role", h.setUserRole)
			r.Get("/admin/users/{id}/export", h.exportUser)
			r.Post("/admin/users/{id}/erase", h.eraseUser)
			r.Get("/admin/audit", h.adminAudit)
			r.Get("/admin/data-ops", h.adminDataOps)
			r.Get("/admin/settings", h.getSettings)
			r.Put("/admin/settings", h.putSettings)
		})

		r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		})
	})

	if opts.StaticFS != nil {
		r.Handle("/*", spaHandler(opts.StaticFS))
	}
	return r
}

type handlers struct {
	opts Options

	cfgMu  sync.Mutex
	cfgVal effConfig
	cfgAt  time.Time
}

// spaHandler serves static files and falls back to index.html for client routes.
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(fsys, p); err != nil {
			http.ServeFileFS(w, r, fsys, "index.html")
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"error": msg})
}

func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	return json.NewDecoder(r.Body).Decode(v)
}
