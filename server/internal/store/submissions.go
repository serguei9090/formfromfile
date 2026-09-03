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
	ID         string  `json:"id"`
	TemplateID string  `json:"templateId"`
	FilledBy   *string `json:"filledBy,omitempty"`
	Submitter  string  `json:"submitter"`
	ValuesJSON string  `json:"valuesJson,omitempty"`
	Output     string  `json:"output,omitempty"`
	CreatedAt  int64   `json:"createdAt"`
}

// CreateSubmission records a filled template. filledBy may be "" for an
// anonymous (share-link) submission.
func (s *Store) CreateSubmission(sub Submission, filledBy string) (*Submission, error) {
	sub.ID = "sub_" + randHex(9)
	sub.CreatedAt = time.Now().UnixMilli()
	var by any
	if filledBy != "" {
		by = filledBy
	}
	_, err := s.DB.Exec(
		`INSERT INTO submissions (id, template_id, filled_by, submitter, values_json, output, created_at)
		 VALUES (?,?,?,?,?,?,?)`,
		sub.ID, sub.TemplateID, by, sub.Submitter, sub.ValuesJSON, sub.Output, sub.CreatedAt)
	if err != nil {
		return nil, err
	}
	if filledBy != "" {
		sub.FilledBy = &filledBy
	}
	return &sub, nil
}

// ListSubmissions returns submissions for a template the user owns (newest
// first), without the bulky values/output blobs. ErrNotFound if the template
// isn't theirs.
func (s *Store) ListSubmissions(userID, templateID string) ([]Submission, error) {
	if _, err := s.GetSchema(userID, templateID); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(
		`SELECT id, template_id, filled_by, submitter, created_at
		 FROM submissions WHERE template_id = ? ORDER BY created_at DESC`, templateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Submission{}
	for rows.Next() {
		var sub Submission
		if err := rows.Scan(&sub.ID, &sub.TemplateID, &sub.FilledBy, &sub.Submitter, &sub.CreatedAt); err != nil {
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

// GetSubmission returns one submission (with blobs) if the caller owns its
// template.
func (s *Store) GetSubmission(userID, id string) (*Submission, error) {
	var sub Submission
	err := s.DB.QueryRow(
		`SELECT sub.id, sub.template_id, sub.filled_by, sub.submitter, sub.values_json, sub.output, sub.created_at
		 FROM submissions sub
		 JOIN schemas sc ON sc.id = sub.template_id
		 WHERE sub.id = ? AND sc.user_id = ?`, id, userID).
		Scan(&sub.ID, &sub.TemplateID, &sub.FilledBy, &sub.Submitter, &sub.ValuesJSON, &sub.Output, &sub.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &sub, nil
}
