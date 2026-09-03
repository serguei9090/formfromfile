package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"
)

// ErrNotFound is returned when a schema id doesn't exist (or isn't the
// caller's).
var ErrNotFound = errors.New("not found")

// MaxSchemaBody caps a stored source file / form JSON.
const MaxSchemaBody = 1 << 20 // 1 MiB

// Schema is one user's saved form.
type Schema struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Kind        string  `json:"kind"` // "xml" | "yaml" | "json"
	Body        string  `json:"body"`
	FormJSON    string  `json:"formJson"`
	Visibility  string  `json:"visibility"` // "private" | "shared"
	ShareSlug   *string `json:"shareSlug,omitempty"`
	PublishedAt *int64  `json:"publishedAt,omitempty"`
	CreatedAt   int64   `json:"createdAt"`
	UpdatedAt   int64   `json:"updatedAt"`
}

func newSchemaID() string {
	return "sch_" + randHex(9)
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ListSchemas returns a user's schemas without bodies (list view), newest edit first.
func (s *Store) ListSchemas(userID string) ([]Schema, error) {
	rows, err := s.DB.Query(
		`SELECT id, name, kind, visibility, share_slug, published_at, created_at, updated_at
		 FROM schemas WHERE user_id = ? ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Schema{}
	for rows.Next() {
		var sc Schema
		if err := rows.Scan(&sc.ID, &sc.Name, &sc.Kind, &sc.Visibility, &sc.ShareSlug, &sc.PublishedAt,
			&sc.CreatedAt, &sc.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}

// GetSchema returns one schema (with bodies) scoped to the user.
func (s *Store) GetSchema(userID, id string) (*Schema, error) {
	var sc Schema
	err := s.DB.QueryRow(
		`SELECT id, name, kind, body, form_json, visibility, share_slug, published_at, created_at, updated_at
		 FROM schemas WHERE id = ? AND user_id = ?`, id, userID).
		Scan(&sc.ID, &sc.Name, &sc.Kind, &sc.Body, &sc.FormJSON, &sc.Visibility, &sc.ShareSlug,
			&sc.PublishedAt, &sc.CreatedAt, &sc.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &sc, nil
}

// PublishSchema marks a user's schema shared, minting a share slug on first
// publish. Returns the updated row.
func (s *Store) PublishSchema(userID, id string) (*Schema, error) {
	now := time.Now().UnixMilli()
	res, err := s.DB.Exec(
		`UPDATE schemas
		 SET visibility = 'shared',
		     share_slug = COALESCE(share_slug, ?),
		     published_at = ?
		 WHERE id = ? AND user_id = ?`,
		randHex(12), now, id, userID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.GetSchema(userID, id)
}

// UnpublishSchema makes a shared schema private again (the slug is kept, so a
// re-publish reuses the same link).
func (s *Store) UnpublishSchema(userID, id string) (*Schema, error) {
	res, err := s.DB.Exec(
		`UPDATE schemas SET visibility = 'private' WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.GetSchema(userID, id)
}

// SchemaBySlug looks up a shared schema by its public slug. No user scope; only
// returns rows whose visibility is currently 'shared'.
func (s *Store) SchemaBySlug(slug string) (*Schema, error) {
	var sc Schema
	err := s.DB.QueryRow(
		`SELECT id, name, kind, body, form_json, visibility, share_slug, published_at, created_at, updated_at
		 FROM schemas WHERE share_slug = ? AND visibility = 'shared'`, slug).
		Scan(&sc.ID, &sc.Name, &sc.Kind, &sc.Body, &sc.FormJSON, &sc.Visibility, &sc.ShareSlug,
			&sc.PublishedAt, &sc.CreatedAt, &sc.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &sc, nil
}

// CreateSchema inserts a new schema for the user.
func (s *Store) CreateSchema(userID string, sc Schema) (*Schema, error) {
	now := time.Now().UnixMilli()
	sc.ID = newSchemaID()
	sc.CreatedAt, sc.UpdatedAt = now, now
	sc.Visibility = "private"
	sc.ShareSlug, sc.PublishedAt = nil, nil
	_, err := s.DB.Exec(
		`INSERT INTO schemas (id, user_id, name, kind, body, form_json, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		sc.ID, userID, sc.Name, sc.Kind, sc.Body, sc.FormJSON, now, now)
	if err != nil {
		return nil, err
	}
	return &sc, nil
}

// UpdateSchema replaces the mutable fields of a user's schema.
func (s *Store) UpdateSchema(userID, id string, sc Schema) (*Schema, error) {
	now := time.Now().UnixMilli()
	res, err := s.DB.Exec(
		`UPDATE schemas SET name = ?, kind = ?, body = ?, form_json = ?, updated_at = ?
		 WHERE id = ? AND user_id = ?`,
		sc.Name, sc.Kind, sc.Body, sc.FormJSON, now, id, userID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.GetSchema(userID, id)
}

// DeleteSchema removes a user's schema.
func (s *Store) DeleteSchema(userID, id string) error {
	res, err := s.DB.Exec(`DELETE FROM schemas WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
