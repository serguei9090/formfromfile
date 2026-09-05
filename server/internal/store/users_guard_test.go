package store

import (
	"sync"
	"testing"
)

// The last-admin guard must hold under concurrency: with exactly two admins,
// two simultaneous "demote this admin" calls must not both succeed. On SQLite
// the single writer serializes them; on Postgres the transaction + FOR UPDATE
// in users_guard.go does. Run with TEST_DATABASE_URL set to exercise the
// Postgres path (that's the one that would race without the fix).
func TestLastAdminGuardConcurrent(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.DB.Exec(`INSERT INTO users (id, email, pw_hash, role, disabled, created_at) VALUES
		('a1','a1@x.com','x','admin',0,0), ('a2','a2@x.com','x','admin',0,0)`); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, id := range []string{"a1", "a2"} {
		wg.Add(1)
		go func(i int, id string) {
			defer wg.Done()
			errs[i] = st.SetUserRole(id, "user")
		}(i, id)
	}
	wg.Wait()

	// exactly one demotion must have been refused
	refused := 0
	for _, e := range errs {
		if e == ErrLastAdmin {
			refused++
		} else if e != nil {
			t.Fatalf("unexpected error: %v", e)
		}
	}
	if refused != 1 {
		t.Fatalf("refused %d of 2 concurrent demotions, want exactly 1", refused)
	}

	var admins int
	if err := st.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0`).Scan(&admins); err != nil {
		t.Fatal(err)
	}
	if admins != 1 {
		t.Fatalf("left %d active admins, want 1", admins)
	}
}
