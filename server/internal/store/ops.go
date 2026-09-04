package store

import "time"

// AuditEntry is one recorded state change.
type AuditEntry struct {
	ID         string `json:"id"`
	ActorEmail string `json:"actorEmail"`
	Action     string `json:"action"`
	Target     string `json:"target"`
	Detail     string `json:"detail,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
}

// Audit records an action. Best-effort — never fails the caller.
func (s *Store) Audit(actorID, actorEmail, action, target, detail string) {
	var by any
	if actorID != "" {
		by = actorID
	}
	_, _ = s.DB.Exec(
		`INSERT INTO audit_log (id, actor_id, actor_email, action, target, detail, created_at)
		 VALUES (?,?,?,?,?,?,?)`,
		"aud_"+randHex(9), by, actorEmail, action, target, detail, time.Now().UnixMilli())
}

// RecentAudit returns the newest entries (admin only).
func (s *Store) RecentAudit(limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.DB.Query(
		`SELECT id, actor_email, action, target, detail, created_at
		 FROM audit_log ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var a AuditEntry
		if err := rows.Scan(&a.ID, &a.ActorEmail, &a.Action, &a.Target, &a.Detail, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// BumpViewCount records a public template view (for completion-rate analytics).
func (s *Store) BumpViewCount(templateID string) {
	_, _ = s.DB.Exec(`UPDATE schemas SET view_count = view_count + 1 WHERE id = ?`, templateID)
}

// SubmissionCount returns how many submissions a template has (any status).
func (s *Store) SubmissionCount(templateID string) int {
	var n int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM submissions WHERE template_id = ?`, templateID).Scan(&n)
	return n
}

// SetTemplateOps updates the submission cap, brand JSON, retention window and
// public-access mode for a template. publicAccess is caller-validated (the
// httpapi handler rejects anything but "anyone"/"authenticated" before this
// is called).
func (s *Store) SetTemplateOps(userID, id string, cap, retentionDays int, brand, publicAccess string) (*Schema, error) {
	res, err := s.DB.Exec(
		`UPDATE schemas SET submission_cap = ?, brand = ?, retention_days = ?, public_access = ?
		 WHERE id = ? AND user_id = ?`,
		cap, brand, retentionDays, publicAccess, id, userID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.GetSchema(userID, id)
}
