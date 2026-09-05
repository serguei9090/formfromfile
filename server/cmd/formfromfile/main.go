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
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/serguei9090/formfromfile/internal/ai"
	"github.com/serguei9090/formfromfile/internal/auth"
	"github.com/serguei9090/formfromfile/internal/firebaseauth"
	"github.com/serguei9090/formfromfile/internal/httpapi"
	"github.com/serguei9090/formfromfile/internal/metrics"
	"github.com/serguei9090/formfromfile/internal/store"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "user" {
		runUserCLI(os.Args[2:])
		return
	}

	addr := flag.String("addr", envOr("FFF_ADDR", "127.0.0.1:8787"), "listen address")
	dbPath := flag.String("db", envOr("FFF_DB", "formfromfile.db"), "SQLite database path (ignored if FFF_DATABASE_URL is set)")
	allowRegister := flag.Bool("allow-register", envOr("FFF_ALLOW_REGISTER", "true") == "true", "allow public self-registration")
	healthcheck := flag.Bool("healthcheck", false, "probe the local server's /healthz and exit 0/1 (for Docker HEALTHCHECK)")
	flag.Parse()

	if *healthcheck {
		os.Exit(probeHealth(*addr))
	}

	setupLogging()

	// FFF_DATABASE_URL (or *_FILE, for Docker/k8s secrets) wins over --db /
	// FFF_DB. A "postgres://…" value selects Postgres; anything else is a
	// SQLite file path. Unset → SQLite at --db, exactly as before.
	dbTarget := resolveDBTarget(*dbPath)

	st, err := store.Open(dbTarget)
	if err != nil {
		slog.Error("open db", "err", err, "db", store.RedactDSN(dbTarget))
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
	registerMetrics(st, dbTarget)
	startRetentionSweep(st)

	// Firebase sign-in (Google / Firebase email) is off unless a project id
	// is set — no service account credentials needed, only the (public)
	// project id; the ID token's signature is checked against Google's
	// published keys.
	var fbVerifier *firebaseauth.Verifier
	fbProjectID := os.Getenv("FFF_FIREBASE_PROJECT_ID")
	if fbProjectID != "" {
		fbVerifier = firebaseauth.New(fbProjectID)
	}

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
		MetricsToken:           os.Getenv("FFF_METRICS_TOKEN"),
		ErrorWebhook:           os.Getenv("FFF_ERROR_WEBHOOK"),
		Firebase:               fbVerifier,
		FirebaseProjectID:      fbProjectID,
		FirebaseAPIKey:         os.Getenv("FFF_FIREBASE_API_KEY"),
		FirebaseAuthDomain:     os.Getenv("FFF_FIREBASE_AUTH_DOMAIN"),
		FirebaseAppID:          os.Getenv("FFF_FIREBASE_APP_ID"),
		StaticFS:               staticFS,
	})

	srv := &http.Server{
		Addr:              *addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
	}
	n, _ := st.CountUsers()
	slog.Info("listening",
		"addr", *addr, "db", store.RedactDSN(dbTarget), "users", n,
		"register", *allowRegister, "spa", staticFS != nil, "ai", aiSvc.Enabled(),
		"firebase", fbVerifier != nil)
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

// registerMetrics wires the scrape-time gauges. Counters/histograms register
// themselves in the metrics package.
func registerMetrics(st *store.Store, dbTarget string) {
	metrics.R.Gauge("fff_users_total", "Registered accounts.", func() float64 {
		return float64(st.UsersTotal())
	})
	metrics.R.Gauge("fff_sessions_active", "Unexpired sessions.", func() float64 {
		return float64(st.SessionsActive())
	})
	metrics.R.Gauge("fff_submissions_total", "Stored submissions.", func() float64 {
		return float64(st.SubmissionsTotal())
	})
	// fff_db_bytes is the SQLite file size — meaningless for Postgres, so skip
	// the gauge entirely on that path rather than report a bogus 0.
	if !store.IsPostgresDSN(dbTarget) {
		metrics.R.Gauge("fff_db_bytes", "SQLite database file size in bytes.", func() float64 {
			fi, err := os.Stat(dbTarget)
			if err != nil {
				return 0
			}
			return float64(fi.Size())
		})
	}
}

// resolveDBTarget picks the database target, in precedence order:
//  1. FFF_DATABASE_URL (or FFF_DATABASE_URL_FILE) — a full connection URL.
//  2. FFF_DB_HOST + friends — discrete parts, assembled into a postgres URL
//     with proper escaping. The production-friendly path: each field, and
//     the password especially, can come from its own secret.
//  3. the --db / FFF_DB SQLite path (the default).
func resolveDBTarget(dbFlag string) string {
	if v := envOrFile("FFF_DATABASE_URL"); v != "" {
		return v
	}
	if host := os.Getenv("FFF_DB_HOST"); host != "" {
		return assemblePostgresURL(host)
	}
	return dbFlag
}

// assemblePostgresURL builds a postgres:// URL from the discrete FFF_DB_*
// vars. url.URL handles percent-escaping, so a password with @ / : # etc.
// works without the caller quoting anything.
func assemblePostgresURL(host string) string {
	u := url.URL{
		Scheme: "postgres",
		Host:   net.JoinHostPort(host, envOr("FFF_DB_PORT", "5432")),
		Path:   "/" + envOr("FFF_DB_NAME", "formfromfile"),
	}
	if user := os.Getenv("FFF_DB_USER"); user != "" {
		if pw := envOrFile("FFF_DB_PASSWORD"); pw != "" {
			u.User = url.UserPassword(user, pw)
		} else {
			u.User = url.User(user)
		}
	}
	q := url.Values{}
	q.Set("sslmode", envOr("FFF_DB_SSLMODE", "require"))
	u.RawQuery = q.Encode()
	return u.String()
}

// envOrFile returns the contents of $<name>_FILE if that points at a file
// (for Docker/k8s secrets), else the trimmed value of $<name>, else "".
func envOrFile(name string) string {
	if f := os.Getenv(name + "_FILE"); f != "" {
		b, err := os.ReadFile(f)
		if err != nil {
			slog.Error("read "+name+"_FILE", "path", f, "err", err)
			os.Exit(1)
		}
		return strings.TrimSpace(string(b))
	}
	return strings.TrimSpace(os.Getenv(name))
}

// startRetentionSweep runs an hourly pass that deletes submissions past their
// template's retention window (or the `retention_days_default` setting). It is
// a no-op until a window is configured, so it costs one cheap query/hour.
func startRetentionSweep(st *store.Store) {
	sweep := func() {
		def := 0
		if v, ok, _ := st.GetSetting("retention_days_default"); ok {
			def, _ = strconv.Atoi(v)
		}
		n, err := st.PurgeExpiredSubmissions(def)
		if err != nil {
			slog.Error("retention sweep", "err", err)
			return
		}
		if n > 0 {
			slog.Info("retention sweep", "deleted", n)
			st.LogDataOp("system", "retention.purge", "", strconv.FormatInt(n, 10)+" submissions")
		}
	}
	go func() {
		sweep()
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for range t.C {
			sweep()
		}
	}()
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
