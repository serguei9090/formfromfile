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
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"` // "xml" | "yaml" | "json"
	Body      string `json:"body"`
	FormJSON  string `json:"formJson"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

func newSchemaID() string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return "sch_" + hex.EncodeToString(b)
}

// ListSchemas returns a user's schemas without bodies (list view), newest edit first.
func (s *Store) ListSchemas(userID string) ([]Schema, error) {
	rows, err := s.DB.Query(
		`SELECT id, name, kind, created_at, updated_at FROM schemas WHERE user_id = ? ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Schema{}
	for rows.Next() {
		var sc Schema
		if err := rows.Scan(&sc.ID, &sc.Name, &sc.Kind, &sc.CreatedAt, &sc.UpdatedAt); err != nil {
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
		`SELECT id, name, kind, body, form_json, created_at, updated_at
		 FROM schemas WHERE id = ? AND user_id = ?`, id, userID).
		Scan(&sc.ID, &sc.Name, &sc.Kind, &sc.Body, &sc.FormJSON, &sc.CreatedAt, &sc.UpdatedAt)
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
