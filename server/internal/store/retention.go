package store

import (
	"database/sql"
	"errors"
	"time"
)

// DataOp is one row of the retention / export / erase log.
type DataOp struct {
	ID        string `json:"id"`
	Actor     string `json:"actor"`
	Action    string `json:"action"`
	Subject   string `json:"subject"`
	Detail    string `json:"detail,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

// LogDataOp records a data-lifecycle action. Best-effort.
func (s *Store) LogDataOp(actor, action, subject, detail string) {
	_, _ = s.DB.Exec(
		`INSERT INTO data_ops_log (id, actor, action, subject, detail, created_at)
		 VALUES (?,?,?,?,?,?)`,
		"dol_"+randHex(9), actor, action, subject, detail, time.Now().UnixMilli())
}

// RecentDataOps returns the newest log rows (admin only).
func (s *Store) RecentDataOps(limit int) ([]DataOp, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.DB.Query(
		`SELECT id, actor, action, subject, detail, created_at
		 FROM data_ops_log ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DataOp{}
	for rows.Next() {
		var d DataOp
		if err := rows.Scan(&d.ID, &d.Actor, &d.Action, &d.Subject, &d.Detail, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// PurgeExpiredSubmissions deletes submissions older than each template's
// retention_days (falling back to defaultDays when a template's own value is
// 0). A default of 0 and no per-template windows → nothing happens. Returns
// the number of rows removed.
func (s *Store) PurgeExpiredSubmissions(defaultDays int) (int64, error) {
	now := time.Now().UnixMilli()
	dayMS := int64(86400000)

	// per-template windows
	res, err := s.DB.Exec(`
		DELETE FROM submissions
		WHERE created_at < ? - (
		  (SELECT retention_days FROM schemas WHERE schemas.id = submissions.template_id) * ?
		)
		AND (SELECT retention_days FROM schemas WHERE schemas.id = submissions.template_id) > 0`,
		now, dayMS)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()

	if defaultDays > 0 {
		res, err = s.DB.Exec(`
			DELETE FROM submissions
			WHERE created_at < ? - ?
			AND COALESCE((SELECT retention_days FROM schemas WHERE schemas.id = submissions.template_id), 0) = 0`,
			now, int64(defaultDays)*dayMS)
		if err != nil {
			return n, err
		}
		m, _ := res.RowsAffected()
		n += m
	}
	return n, nil
}

// UserExport is the GDPR "download my data" payload.
type UserExport struct {
	User struct {
		ID        string `json:"id"`
		Email     string `json:"email"`
		Role      string `json:"role"`
		Disabled  bool   `json:"disabled"`
		CreatedAt int64  `json:"createdAt"`
	} `json:"user"`
	Templates   []Schema     `json:"templates"`        // templates they own (with bodies)
	OwnedSubs   []Submission `json:"ownedSubmissions"` // submissions to those templates
	TheirFills  []Submission `json:"theirFills"`       // submissions they filled elsewhere
	GeneratedAt int64        `json:"generatedAt"`
}

// ExportUser gathers everything tied to one account.
func (s *Store) ExportUser(id string) (*UserExport, error) {
	var ex UserExport
	ex.GeneratedAt = time.Now().UnixMilli()
	err := s.DB.QueryRow(
		`SELECT id, email, role, disabled, created_at FROM users WHERE id = ?`, id).
		Scan(&ex.User.ID, &ex.User.Email, &ex.User.Role, &ex.User.Disabled, &ex.User.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	tpls, err := s.ListSchemas(id, SchemaFilter{})
	if err != nil {
		return nil, err
	}
	ex.Templates = tpls

	ex.OwnedSubs, err = s.querySubs(
		`WHERE template_id IN (SELECT id FROM schemas WHERE user_id = ?) ORDER BY created_at DESC`, id)
	if err != nil {
		return nil, err
	}
	ex.TheirFills, err = s.querySubs(
		`WHERE filled_by = ? ORDER BY created_at DESC`, id)
	if err != nil {
		return nil, err
	}
	return &ex, nil
}

func (s *Store) querySubs(whereClause string, args ...any) ([]Submission, error) {
	rows, err := s.DB.Query(`SELECT id, template_id, template_version, filled_by, submitter,
		values_json, output, status, review_note, created_at FROM submissions `+whereClause, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Submission{}
	for rows.Next() {
		var sub Submission
		if err := rows.Scan(&sub.ID, &sub.TemplateID, &sub.TemplateVersion, &sub.FilledBy,
			&sub.Submitter, &sub.ValuesJSON, &sub.Output, &sub.Status, &sub.ReviewNote,
			&sub.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// EraseUser hard-deletes an account. FK rules cascade the user's templates,
// versions, webhooks and the submissions on those templates, and null out
// their authorship on comments / audit rows / submissions they filled
// elsewhere. Refuses to remove the last admin.
func (s *Store) EraseUser(id string) error {
	var role string
	err := s.DB.QueryRow(`SELECT role FROM users WHERE id = ?`, id).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if role == "admin" {
		var admins int
		_ = s.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&admins)
		if admins <= 1 {
			return ErrLastAdmin
		}
	}
	_, err = s.DB.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// ErrLastAdmin mirrors auth.ErrLastAdmin for the store-level guard.
var ErrLastAdmin = errors.New("cannot remove the last admin")
