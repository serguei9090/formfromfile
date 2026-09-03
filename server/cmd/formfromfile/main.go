// Command formfromfile is the FormFromFile web server: it serves the built SPA
// and the /api backend (multi-user auth + per-user saved forms).
package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/serguei9090/formfromfile/internal/httpapi"
	"github.com/serguei9090/formfromfile/internal/store"
)

func main() {
	addr := flag.String("addr", envOr("FFF_ADDR", "127.0.0.1:8787"), "listen address")
	dbPath := flag.String("db", envOr("FFF_DB", "formfromfile.db"), "SQLite database path")
	secret := flag.String("session-secret", os.Getenv("FFF_SESSION_SECRET"), "session cookie signing secret (random if empty)")
	allowRegister := flag.Bool("allow-register", envOr("FFF_ALLOW_REGISTER", "true") == "true", "allow public self-registration")
	flag.Parse()

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer st.Close()

	sec := []byte(*secret)
	if len(sec) == 0 {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		sec = []byte(hex.EncodeToString(b))
		log.Printf("no --session-secret given — using a random one (sessions drop on restart)")
	}

	// web/dist is embedded by the release build; in dev this dir is absent and
	// Vite proxies /api instead.
	var staticFS fs.FS
	if sub, serr := fs.Sub(distFS, "dist"); serr == nil {
		if _, e := fs.Stat(sub, "index.html"); e == nil {
			staticFS = sub
		}
	}

	h := httpapi.Router(httpapi.Options{
		Store:         st,
		SessionSecret: sec,
		AllowRegister: *allowRegister,
		StaticFS:      staticFS,
	})

	srv := &http.Server{
		Addr:              *addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
	}
	n, _ := st.CountUsers()
	log.Printf("formfromfile listening on %s (db=%s, users=%d, register=%v, spa=%v)",
		*addr, *dbPath, n, *allowRegister, staticFS != nil)
	log.Fatal(srv.ListenAndServe())
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
