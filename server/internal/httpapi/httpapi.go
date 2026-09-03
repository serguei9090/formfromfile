// Package httpapi wires the FormFromFile HTTP router.
package httpapi

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/serguei9090/formfromfile/internal/store"
)

// Options configures the router.
type Options struct {
	Store         *store.Store
	SessionSecret []byte
	AllowRegister bool
	// StaticFS serves the built SPA (web/dist). Nil in dev — Vite proxies /api.
	StaticFS fs.FS
}

// Router builds the full handler tree.
func Router(opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	r.Route("/api", func(r chi.Router) {
		r.Get("/config", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{"allowRegister": opts.AllowRegister})
		})
		// auth endpoints land in F2, schema endpoints in F3.
		r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusNotImplemented, map[string]any{"error": "not implemented yet"})
		})
	})

	if opts.StaticFS != nil {
		r.Handle("/*", spaHandler(opts.StaticFS))
	}
	return r
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
			r2 := new(http.Request)
			*r2 = *r
			r2.URL.Path = "/"
			http.ServeFileFS(w, r2, fsys, "index.html")
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
