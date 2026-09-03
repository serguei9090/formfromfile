package store

import (
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "t.db"))
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
	if _, err := st.UpdateSchema("u2", sc.ID, Schema{Name: "hax", Kind: "yaml"}); err != ErrNotFound {
		t.Errorf("cross-user update → %v", err)
	}
	if err := st.DeleteSchema("u2", sc.ID); err != ErrNotFound {
		t.Errorf("cross-user delete → %v", err)
	}

	// owner sees it in the list (no body)
	list, err := st.ListSchemas("u1")
	if err != nil || len(list) != 1 || list[0].Body != "" {
		t.Fatalf("list: %v %+v", err, list)
	}

	upd, err := st.UpdateSchema("u1", sc.ID, Schema{Name: "renamed", Kind: "json", Body: "{}", FormJSON: "[]"})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if upd.Name != "renamed" || upd.Kind != "json" || upd.UpdatedAt < upd.CreatedAt {
		t.Errorf("bad update %+v", upd)
	}

	if err := st.DeleteSchema("u1", sc.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := st.GetSchema("u1", sc.ID); err != ErrNotFound {
		t.Errorf("after delete → %v", err)
	}
}
