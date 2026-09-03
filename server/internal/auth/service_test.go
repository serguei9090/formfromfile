package auth

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/serguei9090/formfromfile/internal/store"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
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
