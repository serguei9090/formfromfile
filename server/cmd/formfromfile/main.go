// Command formfromfile is the FormFromFile web server: it serves the built SPA
// and the /api backend (multi-user auth + per-user saved forms).
package main

import (
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/serguei9090/formfromfile/internal/ai"
	"github.com/serguei9090/formfromfile/internal/auth"
	"github.com/serguei9090/formfromfile/internal/httpapi"
	"github.com/serguei9090/formfromfile/internal/store"
)

func main() {
	addr := flag.String("addr", envOr("FFF_ADDR", "127.0.0.1:8787"), "listen address")
	dbPath := flag.String("db", envOr("FFF_DB", "formfromfile.db"), "SQLite database path")
	allowRegister := flag.Bool("allow-register", envOr("FFF_ALLOW_REGISTER", "true") == "true", "allow public self-registration")
	healthcheck := flag.Bool("healthcheck", false, "probe the local server's /healthz and exit 0/1 (for Docker HEALTHCHECK)")
	flag.Parse()

	if *healthcheck {
		os.Exit(probeHealth(*addr))
	}

	setupLogging()

	st, err := store.Open(*dbPath)
	if err != nil {
		slog.Error("open db", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	svc := auth.NewService(st)

	// web/dist is embedded by the release build; in dev this dir is absent and
	// Vite proxies /api instead.
	var staticFS fs.FS
	if sub, serr := fs.Sub(distFS, "dist"); serr == nil {
		if _, e := fs.Stat(sub, "index.html"); e == nil {
			staticFS = sub
		}
	}

	aiSvc := ai.New()

	h := httpapi.Router(httpapi.Options{
		Store:                  st,
		Auth:                   svc,
		AI:                     aiSvc,
		AllowRegister:          *allowRegister,
		WebhookAllowPrivate:    truthy(os.Getenv("FFF_WEBHOOK_ALLOW_PRIVATE")),
		TrustProxy:             truthy(os.Getenv("FFF_TRUST_PROXY")),
		TurnstileSiteKey:       os.Getenv("FFF_TURNSTILE_SITE_KEY"),
		TurnstileSecret:        os.Getenv("FFF_TURNSTILE_SECRET"),
		DisableSecurityHeaders: off(os.Getenv("FFF_SECURITY_HEADERS")),
		StaticFS:               staticFS,
	})

	srv := &http.Server{
		Addr:              *addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
	}
	n, _ := st.CountUsers()
	slog.Info("listening",
		"addr", *addr, "db", *dbPath, "users", n,
		"register", *allowRegister, "spa", staticFS != nil, "ai", aiSvc.Enabled())
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

// setupLogging configures slog. Text to stderr by default; FFF_LOG_FORMAT=json
// switches to JSON lines (use in containers / prod). FFF_LOG_LEVEL sets the
// threshold (debug|info|warn|error).
func setupLogging() {
	lvl := new(slog.LevelVar)
	switch strings.ToLower(os.Getenv("FFF_LOG_LEVEL")) {
	case "debug":
		lvl.Set(slog.LevelDebug)
	case "warn":
		lvl.Set(slog.LevelWarn)
	case "error":
		lvl.Set(slog.LevelError)
	default:
		lvl.Set(slog.LevelInfo)
	}
	opts := &slog.HandlerOptions{Level: lvl}
	var h slog.Handler = slog.NewTextHandler(os.Stderr, opts)
	if strings.EqualFold(os.Getenv("FFF_LOG_FORMAT"), "json") {
		h = slog.NewJSONHandler(os.Stderr, opts)
	}
	slog.SetDefault(slog.New(h))
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func truthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// off reports an explicit opt-out ("0"/"false"/"no"/"off"). Blank → not off,
// so a setting defaults on.
func off(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "false", "no", "off":
		return true
	}
	return false
}

// probeHealth GETs http://<addr>/healthz (rewriting 0.0.0.0 / empty host to
// localhost) and returns a process exit code. Used by the Dockerfile
// HEALTHCHECK — distroless has no shell or curl.
func probeHealth(addr string) int {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		host, port = "", addr
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	c := http.Client{Timeout: 3 * time.Second}
	res, err := c.Get(fmt.Sprintf("http://%s/healthz", net.JoinHostPort(host, port)))
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	if res.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: status", res.StatusCode)
		return 1
	}
	return 0
}
