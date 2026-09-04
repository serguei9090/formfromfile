// Package auth is FormFromFile's identity layer: email + argon2id password,
// opaque session tokens stored hashed, a first-user-is-admin bootstrap, and a
// small in-memory login throttle.
package auth

import "errors"

var (
	ErrNotFound           = errors.New("not found")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrLockedOut          = errors.New("too many attempts — try again later")
	ErrDisabled           = errors.New("account disabled")
	ErrTaken              = errors.New("that email is already registered")
	ErrWeakPassword       = errors.New("password too short (min 10 characters)")
	ErrRegisterClosed     = errors.New("self-registration is disabled")
	ErrLastAdmin          = errors.New("cannot disable the last admin")
	ErrInvalidRole        = errors.New("invalid role")
	ErrEmailNotVerified   = errors.New("that email address is not verified")
)

const MinPasswordLen = 10

type Role string

const (
	RoleAdmin  Role = "admin"
	RoleAuthor Role = "author"
	RoleUser   Role = "user"
)

// ValidRole reports whether r is one an admin may assign.
func ValidRole(r Role) bool {
	return r == RoleAdmin || r == RoleAuthor || r == RoleUser
}

// User is an account. The password hash never leaves this package.
type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Role      Role   `json:"role"`
	Disabled  bool   `json:"disabled"`
	CreatedAt int64  `json:"createdAt"`

	passwordHash string
}

// IsAdmin reports whether the user holds the admin role.
func (u User) IsAdmin() bool { return u.Role == RoleAdmin }

// CanAuthor reports whether the user may create + publish templates.
func (u User) CanAuthor() bool { return u.Role == RoleAdmin || u.Role == RoleAuthor }

// Session is one issued login (stored keyed by sha256(token)).
type Session struct {
	UserID    string
	CreatedAt int64
	ExpiresAt int64
}
