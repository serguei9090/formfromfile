package auth

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/serguei9090/formfromfile/internal/store"
)

// newTestService opens a store — a temp SQLite file, or the Postgres at
// TEST_DATABASE_URL (public schema wiped first) so the last-admin guard
// changes get exercised against both backends.
func newTestService(t *testing.T) *Service {
	t.Helper()
	target := filepath.Join(t.TempDir(), "t.db")
	if u := os.Getenv("TEST_DATABASE_URL"); u != "" && store.IsPostgresDSN(u) {
		db, err := sql.Open(store.PGDriverName, u)
		if err != nil {
			t.Fatalf("connect TEST_DATABASE_URL: %v", err)
		}
		for _, q := range []string{`DROP SCHEMA IF EXISTS public CASCADE`, `CREATE SCHEMA public`} {
			if _, err := db.Exec(q); err != nil {
				t.Fatalf("wipe public schema: %v", err)
			}
		}
		db.Close()
		target = u
	}
	st, err := store.Open(target)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return NewService(st)
}

func TestRegisterFirstUserIsAdmin(t *testing.T) {
	s := newTestService(t)
	u1, err := s.Register("Admin@Example.com ", "correcthorse1")
	if err != nil {
		t.Fatalf("register 1: %v", err)
	}
	if u1.Role != RoleAdmin || u1.Email != "admin@example.com" {
		t.Fatalf("first user: role=%q email=%q", u1.Role, u1.Email)
	}
	u2, err := s.Register("bob@example.com", "correcthorse2")
	if err != nil {
		t.Fatalf("register 2: %v", err)
	}
	if u2.Role != RoleUser {
		t.Errorf("second user role = %q, want user", u2.Role)
	}
}

func TestRegisterValidation(t *testing.T) {
	s := newTestService(t)
	if _, err := s.Register("no-at-sign", "correcthorse1"); err == nil {
		t.Error("bad email accepted")
	}
	if _, err := s.Register("a@b.com", "short"); err != ErrWeakPassword {
		t.Errorf("short pw → %v, want ErrWeakPassword", err)
	}
	if _, err := s.Register("dup@b.com", "correcthorse1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Register("DUP@b.com", "correcthorse1"); err != ErrTaken {
		t.Errorf("dup email → %v, want ErrTaken", err)
	}
}

func TestLoginAndSession(t *testing.T) {
	s := newTestService(t)
	if _, err := s.Register("u@e.com", "correcthorse1"); err != nil {
		t.Fatal(err)
	}

	if _, _, err := s.Login("u@e.com", "wrong", "k1"); err != ErrInvalidCredentials {
		t.Errorf("wrong pw → %v", err)
	}
	tok, u, err := s.Login("u@e.com", "correcthorse1", "k2")
	if err != nil || tok == "" {
		t.Fatalf("login: %v tok=%q", err, tok)
	}

	got, err := s.UserByToken(context.Background(), tok)
	if err != nil || got.ID != u.ID {
		t.Fatalf("UserByToken: %v id=%q want %q", err, got.ID, u.ID)
	}

	s.Logout(tok)
	if _, err := s.UserByToken(context.Background(), tok); err != ErrNotFound {
		t.Errorf("after logout → %v, want ErrNotFound", err)
	}
}

func TestLoginThrottle(t *testing.T) {
	s := newTestService(t)
	_, _ = s.Register("u@e.com", "correcthorse1")
	key := "1.2.3.4|u@e.com"
	for i := 0; i < 3; i++ {
		_, _, _ = s.Login("u@e.com", "bad", key)
	}
	if _, _, err := s.Login("u@e.com", "correcthorse1", key); err != ErrLockedOut {
		t.Errorf("after 3 fails → %v, want ErrLockedOut", err)
	}
}

func TestSetDisabledLastAdmin(t *testing.T) {
	s := newTestService(t)
	admin, _ := s.Register("a@e.com", "correcthorse1")
	if err := s.SetDisabled(admin.ID, true); err != ErrLastAdmin {
		t.Errorf("disable last admin → %v, want ErrLastAdmin", err)
	}
	user, _ := s.Register("u@e.com", "correcthorse1")
	if err := s.SetDisabled(user.ID, true); err != nil {
		t.Errorf("disable normal user: %v", err)
	}
	if _, _, err := s.Login("u@e.com", "correcthorse1", "k"); err != ErrDisabled {
		t.Errorf("disabled login → %v, want ErrDisabled", err)
	}
}

func TestResetPassword(t *testing.T) {
	s := newTestService(t)
	u, _ := s.Register("u@e.com", "correcthorse1")
	tok, _, _ := s.Login("u@e.com", "correcthorse1", "k")
	if err := s.ResetPassword(u.ID, "newcorrecthorse"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserByToken(context.Background(), tok); err != ErrNotFound {
		t.Error("reset should revoke sessions")
	}
	if _, _, err := s.Login("u@e.com", "newcorrecthorse", "k2"); err != nil {
		t.Errorf("login with new pw: %v", err)
	}
}

func TestLoginOrProvisionFirebaseFirstUserIsAdmin(t *testing.T) {
	s := newTestService(t)
	tok, u, err := s.LoginOrProvisionFirebase("fb-uid-1", "Owner@Example.com")
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	if u.Role != RoleAdmin || u.Email != "owner@example.com" {
		t.Fatalf("first firebase user: role=%q email=%q", u.Role, u.Email)
	}
	if tok == "" {
		t.Fatal("expected a session token")
	}
	if _, err := s.UserByToken(context.Background(), tok); err != nil {
		t.Fatalf("session should be valid: %v", err)
	}

	_, u2, err := s.LoginOrProvisionFirebase("fb-uid-2", "second@example.com")
	if err != nil {
		t.Fatalf("provision 2: %v", err)
	}
	if u2.Role != RoleUser {
		t.Fatalf("second firebase user role = %q, want user", u2.Role)
	}
}

func TestLoginOrProvisionFirebaseLinksExistingAccount(t *testing.T) {
	s := newTestService(t)
	pw, err := s.Register("shared@example.com", "correcthorse1")
	if err != nil {
		t.Fatal(err)
	}
	_, u, err := s.LoginOrProvisionFirebase("fb-uid-9", "shared@example.com")
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	if u.ID != pw.ID {
		t.Fatalf("firebase sign-in created a second account instead of linking: %s != %s", u.ID, pw.ID)
	}

	var count int
	if err := s.st.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 user row, got %d", count)
	}
}

func TestLoginOrProvisionFirebaseDisabledAccount(t *testing.T) {
	s := newTestService(t)
	if _, err := s.Register("a@e.com", "correcthorse1"); err != nil {
		t.Fatal(err)
	}
	u, _ := s.Register("u@e.com", "correcthorse2")
	if err := s.SetDisabled(u.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.LoginOrProvisionFirebase("fb-uid-x", "u@e.com"); err != ErrDisabled {
		t.Fatalf("disabled account via firebase: %v, want ErrDisabled", err)
	}
}

func TestCreateUser(t *testing.T) {
	s := newTestService(t)

	// blank password → generated, and it actually logs in
	u, gen, err := s.CreateUser("new@example.com", "", RoleUser)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if u.Role != RoleUser || u.Email != "new@example.com" {
		t.Fatalf("user: %+v", u)
	}
	if len(gen) < MinPasswordLen {
		t.Fatalf("generated password too short: %q", gen)
	}
	if _, _, err := s.Login("new@example.com", gen, "k"); err != nil {
		t.Fatalf("login with generated password: %v", err)
	}

	// explicit password → no generated one returned
	_, gen2, err := s.CreateUser("explicit@example.com", "correcthorse1", RoleAuthor)
	if err != nil {
		t.Fatalf("create with explicit pw: %v", err)
	}
	if gen2 != "" {
		t.Fatalf("expected no generated password, got %q", gen2)
	}

	// weak explicit password rejected
	if _, _, err := s.CreateUser("weak@example.com", "short", RoleUser); err != ErrWeakPassword {
		t.Fatalf("weak password: %v, want ErrWeakPassword", err)
	}

	// invalid role rejected
	if _, _, err := s.CreateUser("bad-role@example.com", "correcthorse1", Role("superuser")); err != ErrInvalidRole {
		t.Fatalf("invalid role: %v, want ErrInvalidRole", err)
	}

	// duplicate email rejected
	if _, _, err := s.CreateUser("new@example.com", "correcthorse1", RoleUser); err != ErrTaken {
		t.Fatalf("duplicate email: %v, want ErrTaken", err)
	}
}
