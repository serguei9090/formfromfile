package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

// ErrNotFound is returned when a schema id doesn't exist (or isn't the
// caller's).
var ErrNotFound = errors.New("not found")

// MaxSchemaBody caps a stored source file / form JSON.
const MaxSchemaBody = 1 << 20 // 1 MiB

// Schema is one user's saved form / template.
type Schema struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Kind             string   `json:"kind"`
	Body             string   `json:"body"`
	FormJSON         string   `json:"formJson"`
	Visibility       string   `json:"visibility"` // "private" | "shared"
	ShareSlug        *string  `json:"shareSlug,omitempty"`
	PublishedAt      *int64   `json:"publishedAt,omitempty"`
	CurrentVersion   int      `json:"currentVersion"`
	Status           string   `json:"status"` // "draft" | "published"
	Folder           string   `json:"folder"`
	Tags             []string `json:"tags"`
	ForkedFrom       *string  `json:"forkedFrom,omitempty"`
	RequiresApproval bool     `json:"requiresApproval"`
	CreatedAt        int64    `json:"createdAt"`
	UpdatedAt        int64    `json:"updatedAt"`
}

// TemplateVersion is one saved revision of a template.
type TemplateVersion struct {
	ID        string  `json:"id"`
	Version   int     `json:"version"`
	Body      string  `json:"body,omitempty"`
	FormJSON  string  `json:"formJson,omitempty"`
	Notes     string  `json:"notes"`
	CreatedBy *string `json:"createdBy,omitempty"`
	CreatedAt int64   `json:"createdAt"`
}

func newSchemaID() string { return "sch_" + randHex(9) }

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func encodeTags(tags []string) string {
	if len(tags) == 0 {
		return "[]"
	}
	b, _ := json.Marshal(tags)
	return string(b)
}

func decodeTags(s string) []string {
	out := []string{}
	if s == "" {
		return out
	}
	_ = json.Unmarshal([]byte(s), &out)
	return out
}

// summaryCols / detailCols keep the SELECT lists in one place.
const summaryCols = `id, name, kind, visibility, share_slug, published_at, current_version,
	status, folder, tags, forked_from, requires_approval, created_at, updated_at`
const detailCols = `id, name, kind, body, form_json, visibility, share_slug, published_at,
	current_version, status, folder, tags, forked_from, requires_approval, created_at, updated_at`

func scanSummary(row interface{ Scan(...any) error }) (*Schema, error) {
	var sc Schema
	var tags string
	err := row.Scan(&sc.ID, &sc.Name, &sc.Kind, &sc.Visibility, &sc.ShareSlug, &sc.PublishedAt,
		&sc.CurrentVersion, &sc.Status, &sc.Folder, &tags, &sc.ForkedFrom, &sc.RequiresApproval,
		&sc.CreatedAt, &sc.UpdatedAt)
	if err != nil {
		return nil, err
	}
	sc.Tags = decodeTags(tags)
	return &sc, nil
}

func scanDetail(row interface{ Scan(...any) error }) (*Schema, error) {
	var sc Schema
	var tags string
	err := row.Scan(&sc.ID, &sc.Name, &sc.Kind, &sc.Body, &sc.FormJSON, &sc.Visibility, &sc.ShareSlug,
		&sc.PublishedAt, &sc.CurrentVersion, &sc.Status, &sc.Folder, &tags, &sc.ForkedFrom,
		&sc.RequiresApproval, &sc.CreatedAt, &sc.UpdatedAt)
	if err != nil {
		return nil, err
	}
	sc.Tags = decodeTags(tags)
	return &sc, nil
}

// SchemaFilter narrows ListSchemas.
type SchemaFilter struct {
	Folder string
	Tag    string
	Query  string
}

// ListSchemas returns a user's schemas (no bodies), newest edit first, filtered.
func (s *Store) ListSchemas(userID string, f SchemaFilter) ([]Schema, error) {
	q := `SELECT ` + summaryCols + ` FROM schemas WHERE user_id = ?`
	args := []any{userID}
	if f.Folder != "" {
		q += ` AND folder = ?`
		args = append(args, f.Folder)
	}
	if f.Tag != "" {
		q += ` AND tags LIKE ?`
		args = append(args, `%"`+f.Tag+`"%`)
	}
	if f.Query != "" {
		q += ` AND lower(name) LIKE ?`
		args = append(args, "%"+strings.ToLower(f.Query)+"%")
	}
	q += ` ORDER BY updated_at DESC`
	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Schema{}
	for rows.Next() {
		sc, err := scanSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sc)
	}
	return out, rows.Err()
}

// GetSchema returns one schema (with bodies) scoped to the user.
func (s *Store) GetSchema(userID, id string) (*Schema, error) {
	sc, err := scanDetail(s.DB.QueryRow(
		`SELECT `+detailCols+` FROM schemas WHERE id = ? AND user_id = ?`, id, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return sc, err
}

// SchemaBySlug looks up a shared schema by public slug (no user scope).
func (s *Store) SchemaBySlug(slug string) (*Schema, error) {
	sc, err := scanDetail(s.DB.QueryRow(
		`SELECT `+detailCols+` FROM schemas WHERE share_slug = ? AND visibility = 'shared'`, slug))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return sc, err
}

// CreateSchema inserts a new schema + its version 1.
func (s *Store) CreateSchema(userID string, sc Schema) (*Schema, error) {
	now := time.Now().UnixMilli()
	sc.ID = newSchemaID()
	sc.CreatedAt, sc.UpdatedAt = now, now
	sc.Visibility, sc.ShareSlug, sc.PublishedAt = "private", nil, nil
	sc.CurrentVersion, sc.Status = 1, "draft"
	if sc.Tags == nil {
		sc.Tags = []string{}
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(
		`INSERT INTO schemas (id, user_id, name, kind, body, form_json, folder, tags, forked_from,
		 current_version, status, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,1,'draft',?,?)`,
		sc.ID, userID, sc.Name, sc.Kind, sc.Body, sc.FormJSON, sc.Folder, encodeTags(sc.Tags),
		sc.ForkedFrom, now, now); err != nil {
		return nil, err
	}
	if err := insertVersion(tx, sc.ID, 1, sc.Body, sc.FormJSON, "initial", userID, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &sc, nil
}

// UpdateSchema writes a new version and mirrors it onto the schema row.
func (s *Store) UpdateSchema(userID, id string, sc Schema, notes string) (*Schema, error) {
	now := time.Now().UnixMilli()
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var cur int
	err = tx.QueryRow(`SELECT current_version FROM schemas WHERE id = ? AND user_id = ?`, id, userID).Scan(&cur)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	next := cur + 1
	if _, err := tx.Exec(
		`UPDATE schemas SET name = ?, kind = ?, body = ?, form_json = ?, folder = ?, tags = ?,
		 current_version = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		sc.Name, sc.Kind, sc.Body, sc.FormJSON, sc.Folder, encodeTags(sc.Tags), next, now, id, userID); err != nil {
		return nil, err
	}
	if err := insertVersion(tx, id, next, sc.Body, sc.FormJSON, notes, userID, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetSchema(userID, id)
}

func insertVersion(tx *sql.Tx, templateID string, version int, body, formJSON, notes, by string, at int64) error {
	_, err := tx.Exec(
		`INSERT INTO template_versions (id, template_id, version, body, form_json, notes, created_by, created_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		"tv_"+randHex(9), templateID, version, body, formJSON, notes, by, at)
	return err
}

// ListVersions returns a template's revisions (no bodies), newest first.
func (s *Store) ListVersions(userID, templateID string) ([]TemplateVersion, error) {
	if _, err := s.GetSchema(userID, templateID); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(
		`SELECT id, version, notes, created_by, created_at
		 FROM template_versions WHERE template_id = ? ORDER BY version DESC`, templateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TemplateVersion{}
	for rows.Next() {
		var v TemplateVersion
		if err := rows.Scan(&v.ID, &v.Version, &v.Notes, &v.CreatedBy, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetVersion returns one revision with bodies.
func (s *Store) GetVersion(userID, templateID string, version int) (*TemplateVersion, error) {
	if _, err := s.GetSchema(userID, templateID); err != nil {
		return nil, err
	}
	var v TemplateVersion
	err := s.DB.QueryRow(
		`SELECT id, version, body, form_json, notes, created_by, created_at
		 FROM template_versions WHERE template_id = ? AND version = ?`, templateID, version).
		Scan(&v.ID, &v.Version, &v.Body, &v.FormJSON, &v.Notes, &v.CreatedBy, &v.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &v, err
}

// RollbackSchema copies version `to` into a fresh version and makes it current.
func (s *Store) RollbackSchema(userID, templateID string, to int) (*Schema, error) {
	v, err := s.GetVersion(userID, templateID, to)
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var cur int
	if err := tx.QueryRow(`SELECT current_version FROM schemas WHERE id = ? AND user_id = ?`,
		templateID, userID).Scan(&cur); err != nil {
		return nil, err
	}
	next := cur + 1
	if _, err := tx.Exec(
		`UPDATE schemas SET body = ?, form_json = ?, current_version = ?, updated_at = ?
		 WHERE id = ? AND user_id = ?`, v.Body, v.FormJSON, next, now, templateID, userID); err != nil {
		return nil, err
	}
	notes := "rolled back to v" + strconv.Itoa(to)
	if err := insertVersion(tx, templateID, next, v.Body, v.FormJSON, notes, userID, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetSchema(userID, templateID)
}

// ForkSchema copies a template into a new one owned by the caller.
func (s *Store) ForkSchema(userID, id string) (*Schema, error) {
	src, err := s.GetSchema(userID, id)
	if err != nil {
		return nil, err
	}
	fork := Schema{
		Name: src.Name + " (fork)", Kind: src.Kind, Body: src.Body, FormJSON: src.FormJSON,
		Folder: src.Folder, Tags: src.Tags, ForkedFrom: &src.ID,
	}
	return s.CreateSchema(userID, fork)
}

// PublishSchema marks the template shared + published, minting a slug once.
func (s *Store) PublishSchema(userID, id string) (*Schema, error) {
	now := time.Now().UnixMilli()
	res, err := s.DB.Exec(
		`UPDATE schemas SET visibility = 'shared', status = 'published',
		 share_slug = COALESCE(share_slug, ?), published_at = ?
		 WHERE id = ? AND user_id = ?`, randHex(12), now, id, userID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.GetSchema(userID, id)
}

// UnpublishSchema returns the template to draft/private (slug kept).
func (s *Store) UnpublishSchema(userID, id string) (*Schema, error) {
	res, err := s.DB.Exec(
		`UPDATE schemas SET visibility = 'private', status = 'draft' WHERE id = ? AND user_id = ?`,
		id, userID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.GetSchema(userID, id)
}

// SetApprovalGate toggles the "submissions need review" flag.
func (s *Store) SetApprovalGate(userID, id string, on bool) (*Schema, error) {
	res, err := s.DB.Exec(
		`UPDATE schemas SET requires_approval = ? WHERE id = ? AND user_id = ?`, on, id, userID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.GetSchema(userID, id)
}

// DeleteSchema removes a user's schema (versions + submissions cascade).
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
