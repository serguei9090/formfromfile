package store

import (
	"path/filepath"
	"testing"
)

func userVersion(t *testing.T, s *Store) int {
	t.Helper()
	var v int
	if err := s.DB.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		t.Fatalf("user_version: %v", err)
	}
	return v
}

func hasColumn(t *testing.T, s *Store, table, col string) bool {
	t.Helper()
	rows, err := s.DB.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		t.Fatalf("table_info(%s): %v", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			cid, notnull, pk int
			name, ctype      string
			dflt             any
		)
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			t.Fatal(err)
		}
		if name == col {
			return true
		}
	}
	return false
}

func TestMigrateFreshDB(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	if got := userVersion(t, st); got != len(migrations) {
		t.Fatalf("user_version = %d, want %d", got, len(migrations))
	}
	for _, col := range []string{"visibility", "share_slug", "published_at"} {
		if !hasColumn(t, st, "schemas", col) {
			t.Errorf("schemas.%s missing after migrate", col)
		}
	}
}

func TestMigrateIsIdempotentAndNonDestructive(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "t.db")

	st, err := Open(dsn)
	if err != nil {
		t.Fatalf("open 1: %v", err)
	}
	if _, err := st.DB.Exec(`INSERT INTO users (id, email, pw_hash, role, created_at)
		VALUES ('u1','a@b.com','x','user',0)`); err != nil {
		t.Fatal(err)
	}
	sc, err := st.CreateSchema("u1", Schema{Name: "keep me", Kind: "xml", Body: "<a/>", FormJSON: "{}"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	_ = st.Close()

	// Reopen the same file — migrate() must be a no-op and leave data intact.
	st2, err := Open(dsn)
	if err != nil {
		t.Fatalf("open 2: %v", err)
	}
	t.Cleanup(func() { _ = st2.Close() })

	if got := userVersion(t, st2); got != len(migrations) {
		t.Fatalf("user_version after reopen = %d, want %d", got, len(migrations))
	}
	got, err := st2.GetSchema("u1", sc.ID)
	if err != nil {
		t.Fatalf("get after reopen: %v", err)
	}
	if got.Name != "keep me" {
		t.Errorf("row lost/changed across reopen: %+v", got)
	}

	var visibility string
	if err := st2.DB.QueryRow(`SELECT visibility FROM schemas WHERE id = ?`, sc.ID).Scan(&visibility); err != nil {
		t.Fatalf("select visibility: %v", err)
	}
	if visibility != "private" {
		t.Errorf("visibility default = %q, want private", visibility)
	}
}
