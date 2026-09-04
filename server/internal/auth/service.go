package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/serguei9090/formfromfile/internal/store"
)

// SessionTTL is how long an issued session stays valid (sliding — every
// authenticated request extends it).
const SessionTTL = 30 * 24 * time.Hour

// Service is the auth use-case layer over the store.
type Service struct {
	st  *store.Store
	thr *throttle
}

func NewService(st *store.Store) *Service {
	return &Service{st: st, thr: newThrottle()}
}

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

// Register creates an account. The first-ever account becomes admin.
func (s *Service) Register(email, pw string) (User, error) {
	email = normEmail(email)
	if email == "" || !strings.Contains(email, "@") {
		return User{}, errors.New("a valid email is required")
	}
	if len(pw) < MinPasswordLen {
		return User{}, ErrWeakPassword
	}
	n, err := s.st.CountUsers()
	if err != nil {
		return User{}, err
	}
	hash, err := hashPassword(pw)
	if err != nil {
		return User{}, err
	}
	role := RoleUser
	if n == 0 {
		role = RoleAdmin
	}
	u := User{ID: newID(), Email: email, Role: role, CreatedAt: time.Now().UnixMilli(), passwordHash: hash}
	_, err = s.st.DB.Exec(
		`INSERT INTO users (id, email, pw_hash, role, disabled, created_at) VALUES (?,?,?,?,0,?)`,
		u.ID, u.Email, u.passwordHash, string(u.Role), u.CreatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, ErrTaken
		}
		return User{}, err
	}
	return u, nil
}

// Login verifies credentials and issues a session token. `key` is a
// throttle key (usually the client IP + email).
func (s *Service) Login(email, pw, throttleKey string) (token string, u User, err error) {
	email = normEmail(email)
	if !s.thr.allowed(throttleKey) {
		return "", User{}, ErrLockedOut
	}
	u, err = s.userByEmail(email)
	if err != nil {
		s.thr.fail(throttleKey)
		return "", User{}, ErrInvalidCredentials
	}
	if !verifyPassword(pw, u.passwordHash) {
		s.thr.fail(throttleKey)
		return "", User{}, ErrInvalidCredentials
	}
	if u.Disabled {
		return "", User{}, ErrDisabled
	}
	s.thr.ok(throttleKey)

	token, err = s.issueSession(u.ID)
	if err != nil {
		return "", User{}, err
	}
	return token, u, nil
}

// issueSession mints a new opaque session token for userID.
func (s *Service) issueSession(userID string) (string, error) {
	raw := make([]byte, 32)
	_, _ = rand.Read(raw)
	token := hex.EncodeToString(raw)
	now := time.Now()
	_, err := s.st.DB.Exec(
		`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)`,
		hashToken(token), userID, now.UnixMilli(), now.Add(SessionTTL).UnixMilli(),
	)
	if err != nil {
		return "", err
	}
	return token, nil
}

// LoginOrProvisionFirebase signs in a user who authenticated with Firebase
// (Google, or Firebase's own email sign-in). uid is Firebase's stable
// per-account id; email must already be verified by the caller — Google
// sign-ins always are, Firebase email/password sign-ins are not guaranteed to
// be. The first account ever created (by any method) becomes admin, matching
// Register's bootstrap rule. Existing accounts are looked up by email and
// linked to uid; new ones are provisioned with no local password.
func (s *Service) LoginOrProvisionFirebase(uid, email string) (token string, u User, err error) {
	email = normEmail(email)
	if email == "" {
		return "", User{}, errors.New("firebase token had no email claim")
	}
	if uid == "" {
		return "", User{}, errors.New("firebase token had no subject claim")
	}

	u, err = s.userByEmail(email)
	if errors.Is(err, ErrNotFound) {
		n, cerr := s.st.CountUsers()
		if cerr != nil {
			return "", User{}, cerr
		}
		role := RoleUser
		if n == 0 {
			role = RoleAdmin
		}
		u = User{ID: newID(), Email: email, Role: role, CreatedAt: time.Now().UnixMilli()}
		_, err = s.st.DB.Exec(
			`INSERT INTO users (id, email, pw_hash, role, disabled, firebase_uid, created_at) VALUES (?,?,?,?,0,?,?)`,
			u.ID, u.Email, "", string(u.Role), uid, u.CreatedAt,
		)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE") {
				return "", User{}, ErrTaken
			}
			return "", User{}, err
		}
	} else if err != nil {
		return "", User{}, err
	} else {
		if u.Disabled {
			return "", User{}, ErrDisabled
		}
		if _, err = s.st.DB.Exec(`UPDATE users SET firebase_uid = ? WHERE id = ?`, uid, u.ID); err != nil {
			return "", User{}, err
		}
	}

	token, err = s.issueSession(u.ID)
	if err != nil {
		return "", User{}, err
	}
	return token, u, nil
}

// Logout revokes a session token.
func (s *Service) Logout(token string) {
	_, _ = s.st.DB.Exec(`DELETE FROM sessions WHERE token = ?`, hashToken(token))
}

// UserByToken resolves a session token to its user, sliding the expiry.
func (s *Service) UserByToken(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrNotFound
	}
	h := hashToken(token)
	var sess Session
	err := s.st.DB.QueryRowContext(ctx,
		`SELECT user_id, created_at, expires_at FROM sessions WHERE token = ?`, h).
		Scan(&sess.UserID, &sess.CreatedAt, &sess.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	now := time.Now()
	if now.UnixMilli() > sess.ExpiresAt {
		_, _ = s.st.DB.Exec(`DELETE FROM sessions WHERE token = ?`, h)
		return User{}, ErrNotFound
	}
	u, err := s.userByID(sess.UserID)
	if err != nil {
		return User{}, err
	}
	if u.Disabled {
		return User{}, ErrDisabled
	}
	// slide
	_, _ = s.st.DB.Exec(`UPDATE sessions SET expires_at = ? WHERE token = ?`,
		now.Add(SessionTTL).UnixMilli(), h)
	return u, nil
}

// --- admin ---

// ListUsers returns every account (admin only), newest first.
func (s *Service) ListUsers() ([]User, error) {
	rows, err := s.st.DB.Query(`SELECT id, email, role, disabled, created_at FROM users ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		var role string
		var disabled int
		if err := rows.Scan(&u.ID, &u.Email, &role, &disabled, &u.CreatedAt); err != nil {
			return nil, err
		}
		u.Role, u.Disabled = Role(role), disabled != 0
		out = append(out, u)
	}
	return out, rows.Err()
}

// SetDisabled enables/disables an account. Refuses to disable the last admin.
func (s *Service) SetDisabled(id string, disabled bool) error {
	u, err := s.userByID(id)
	if err != nil {
		return err
	}
	if disabled && u.IsAdmin() {
		var admins int
		_ = s.st.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0`).Scan(&admins)
		if admins <= 1 {
			return ErrLastAdmin
		}
	}
	b := 0
	if disabled {
		b = 1
	}
	_, err = s.st.DB.Exec(`UPDATE users SET disabled = ? WHERE id = ?`, b, id)
	if err == nil && disabled {
		_, _ = s.st.DB.Exec(`DELETE FROM sessions WHERE user_id = ?`, id)
	}
	return err
}

// SetRole changes an account's role (admin only). Refuses to demote the last
// admin.
func (s *Service) SetRole(id string, role Role) error {
	if !ValidRole(role) {
		return ErrInvalidRole
	}
	u, err := s.userByID(id)
	if err != nil {
		return err
	}
	if u.IsAdmin() && role != RoleAdmin {
		var admins int
		_ = s.st.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0`).Scan(&admins)
		if admins <= 1 {
			return ErrLastAdmin
		}
	}
	_, err = s.st.DB.Exec(`UPDATE users SET role = ? WHERE id = ?`, string(role), id)
	return err
}

// ResetPassword sets a new password for an account and revokes its sessions.
func (s *Service) ResetPassword(id, pw string) error {
	if len(pw) < MinPasswordLen {
		return ErrWeakPassword
	}
	if _, err := s.userByID(id); err != nil {
		return err
	}
	hash, err := hashPassword(pw)
	if err != nil {
		return err
	}
	if _, err := s.st.DB.Exec(`UPDATE users SET pw_hash = ? WHERE id = ?`, hash, id); err != nil {
		return err
	}
	_, _ = s.st.DB.Exec(`DELETE FROM sessions WHERE user_id = ?`, id)
	return nil
}

// --- internal lookups ---

func (s *Service) userByEmail(email string) (User, error) {
	return s.scanUser(s.st.DB.QueryRow(
		`SELECT id, email, pw_hash, role, disabled, created_at FROM users WHERE email = ?`, email))
}

func (s *Service) userByID(id string) (User, error) {
	return s.scanUser(s.st.DB.QueryRow(
		`SELECT id, email, pw_hash, role, disabled, created_at FROM users WHERE id = ?`, id))
}

func (s *Service) scanUser(row *sql.Row) (User, error) {
	var u User
	var role string
	var disabled int
	err := row.Scan(&u.ID, &u.Email, &u.passwordHash, &role, &disabled, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	u.Role, u.Disabled = Role(role), disabled != 0
	return u, nil
}
