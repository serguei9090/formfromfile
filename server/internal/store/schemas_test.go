package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// newTestStore opens a fresh store. Against SQLite that's a temp file. If
// TEST_DATABASE_URL points at a Postgres, it wipes and rebuilds the public
// schema there instead, so `go test ./internal/store` exercises both backends
// (CI runs it a second time with the var set).
func newTestStore(t *testing.T) *Store {
	t.Helper()
	target := filepath.Join(t.TempDir(), "t.db")
	if u := os.Getenv("TEST_DATABASE_URL"); u != "" && IsPostgresDSN(u) {
		wipePostgres(t, u)
		target = u
	}
	st, err := Open(target)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	// a schema row needs a user (FK)
	_, err = st.DB.Exec(`INSERT INTO users (id, email, pw_hash, role, created_at) VALUES
		('u1','a@b.com','x','user',0), ('u2','c@d.com','x','user',0)`)
	if err != nil {
		t.Fatal(err)
	}
	return st
}

// wipePostgres drops and recreates the public schema so each test starts
// clean (a Postgres DB is shared across tests, unlike a per-test temp file).
func wipePostgres(t *testing.T, url string) {
	t.Helper()
	db, err := sql.Open(PGDriverName, url)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	defer db.Close()
	for _, q := range []string{`DROP SCHEMA IF EXISTS public CASCADE`, `CREATE SCHEMA public`} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("wipe public schema: %v", err)
		}
	}
}

func TestSchemaCRUDScoped(t *testing.T) {
	st := newTestStore(t)

	sc, err := st.CreateSchema("u1", Schema{Name: "prod cfg", Kind: "yaml", Body: "a: 1", FormJSON: "{}"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if sc.ID == "" || sc.CreatedAt == 0 {
		t.Fatalf("bad create result %+v", sc)
	}

	// u2 can't see it
	if _, err := st.GetSchema("u2", sc.ID); err != ErrNotFound {
		t.Errorf("cross-user get → %v, want ErrNotFound", err)
	}
	if _, err := st.UpdateSchema("u2", sc.ID, Schema{Name: "hax", Kind: "yaml"}, ""); err != ErrNotFound {
		t.Errorf("cross-user update → %v", err)
	}
	if err := st.DeleteSchema("u2", sc.ID); err != ErrNotFound {
		t.Errorf("cross-user delete → %v", err)
	}

	// owner sees it in the list (no body)
	list, err := st.ListSchemas("u1", SchemaFilter{})
	if err != nil || len(list) != 1 || list[0].Body != "" {
		t.Fatalf("list: %v %+v", err, list)
	}

	upd, err := st.UpdateSchema("u1", sc.ID, Schema{Name: "renamed", Kind: "json", Body: "{}", FormJSON: "[]"}, "renamed it")
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if upd.Name != "renamed" || upd.Kind != "json" || upd.UpdatedAt < upd.CreatedAt {
		t.Errorf("bad update %+v", upd)
	}
	if upd.CurrentVersion != 2 {
		t.Errorf("update should bump version, got %d", upd.CurrentVersion)
	}
	vs, err := st.ListVersions("u1", sc.ID)
	if err != nil || len(vs) != 2 || vs[0].Version != 2 || vs[0].Notes != "renamed it" {
		t.Fatalf("versions: %v %+v", err, vs)
	}
	back, err := st.RollbackSchema("u1", sc.ID, 1)
	if err != nil || back.CurrentVersion != 3 {
		t.Fatalf("rollback: %v %+v", err, back)
	}
	if back.Name != "renamed" { // rollback restores body/form_json, not name
		t.Logf("note: rollback keeps the current name (%q) — bodies only", back.Name)
	}

	if err := st.DeleteSchema("u1", sc.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := st.GetSchema("u1", sc.ID); err != ErrNotFound {
		t.Errorf("after delete → %v", err)
	}
}
