package store

import (
	"database/sql"
	"errors"
	"time"
)

// MaxSubmissionBody caps a stored values blob / rendered output.
const MaxSubmissionBody = 1 << 20 // 1 MiB

// Submission is one filled-in copy of a shared template.
type Submission struct {
	ID              string  `json:"id"`
	TemplateID      string  `json:"templateId"`
	TemplateVersion *int    `json:"templateVersion,omitempty"`
	FilledBy        *string `json:"filledBy,omitempty"`
	Submitter       string  `json:"submitter"`
	ValuesJSON      string  `json:"valuesJson,omitempty"`
	Output          string  `json:"output,omitempty"`
	Status          string  `json:"status"` // "pending" | "approved" | "rejected"
	ReviewNote      string  `json:"reviewNote,omitempty"`
	CreatedAt       int64   `json:"createdAt"`
}

// CreateSubmission records a filled template. filledBy may be "" for an
// anonymous (share-link) submission. The submission records the template's
// current version, and lands "pending" when the template gates on approval.
func (s *Store) CreateSubmission(sub Submission, filledBy string) (*Submission, error) {
	sub.ID = "sub_" + randHex(9)
	sub.CreatedAt = time.Now().UnixMilli()

	var version int
	var gate bool
	if err := s.DB.QueryRow(
		`SELECT current_version, requires_approval FROM schemas WHERE id = ?`, sub.TemplateID).
		Scan(&version, &gate); err != nil {
		return nil, err
	}
	sub.TemplateVersion = &version
	sub.Status = "approved"
	if gate {
		sub.Status = "pending"
	}

	var by any
	if filledBy != "" {
		by = filledBy
	}
	_, err := s.DB.Exec(
		`INSERT INTO submissions
		 (id, template_id, template_version, filled_by, submitter, values_json, output, status, created_at)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		sub.ID, sub.TemplateID, version, by, sub.Submitter, sub.ValuesJSON, sub.Output, sub.Status, sub.CreatedAt)
	if err != nil {
		return nil, err
	}
	if filledBy != "" {
		sub.FilledBy = &filledBy
	}
	return &sub, nil
}

// ListSubmissions returns submissions for a template the user owns (newest
// first), without the bulky blobs. ErrNotFound if the template isn't theirs.
func (s *Store) ListSubmissions(userID, templateID string) ([]Submission, error) {
	if _, err := s.GetSchema(userID, templateID); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(
		`SELECT id, template_id, template_version, filled_by, submitter, status, created_at
		 FROM submissions WHERE template_id = ? ORDER BY created_at DESC`, templateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Submission{}
	for rows.Next() {
		var sub Submission
		if err := rows.Scan(&sub.ID, &sub.TemplateID, &sub.TemplateVersion, &sub.FilledBy,
			&sub.Submitter, &sub.Status, &sub.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// DeleteSubmission removes a submission if the caller owns its template.
func (s *Store) DeleteSubmission(userID, id string) error {
	res, err := s.DB.Exec(
		`DELETE FROM submissions
		 WHERE id = ? AND template_id IN (SELECT id FROM schemas WHERE user_id = ?)`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// GetSubmission returns one submission (with blobs) if the caller owns its template.
func (s *Store) GetSubmission(userID, id string) (*Submission, error) {
	var sub Submission
	err := s.DB.QueryRow(
		`SELECT sub.id, sub.template_id, sub.template_version, sub.filled_by, sub.submitter,
		 sub.values_json, sub.output, sub.status, sub.review_note, sub.created_at
		 FROM submissions sub JOIN schemas sc ON sc.id = sub.template_id
		 WHERE sub.id = ? AND sc.user_id = ?`, id, userID).
		Scan(&sub.ID, &sub.TemplateID, &sub.TemplateVersion, &sub.FilledBy, &sub.Submitter,
			&sub.ValuesJSON, &sub.Output, &sub.Status, &sub.ReviewNote, &sub.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &sub, nil
}

// ReviewSubmission approves or rejects a pending submission (owner only).
func (s *Store) ReviewSubmission(userID, id string, approved bool, note string) (*Submission, error) {
	status := "rejected"
	if approved {
		status = "approved"
	}
	res, err := s.DB.Exec(
		`UPDATE submissions SET status = ?, reviewed_by = ?, review_note = ?
		 WHERE id = ? AND template_id IN (SELECT id FROM schemas WHERE user_id = ?)`,
		status, userID, note, id, userID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.GetSubmission(userID, id)
}
