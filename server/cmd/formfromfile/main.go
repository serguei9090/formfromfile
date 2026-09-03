// Command formfromfile is the FormFromFile web server: it serves the built SPA
// and the /api backend (multi-user auth + per-user saved forms).
package main

import (
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
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

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
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
		Store:         st,
		Auth:          svc,
		AI:            aiSvc,
		AllowRegister: *allowRegister,
		StaticFS:      staticFS,
	})

	srv := &http.Server{
		Addr:              *addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
	}
	n, _ := st.CountUsers()
	log.Printf("formfromfile listening on %s (db=%s, users=%d, register=%v, spa=%v, ai=%v)",
		*addr, *dbPath, n, *allowRegister, staticFS != nil, aiSvc.Enabled())
	log.Fatal(srv.ListenAndServe())
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
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
