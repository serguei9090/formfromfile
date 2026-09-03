package store

import (
	"encoding/json"
	"time"
)

// --- submission comments ---------------------------------------------------

type Comment struct {
	ID         string  `json:"id"`
	AuthorID   *string `json:"authorId,omitempty"`
	AuthorName string  `json:"authorName"`
	Body       string  `json:"body"`
	CreatedAt  int64   `json:"createdAt"`
}

// AddComment posts a comment on a submission the caller owns (via the template).
func (s *Store) AddComment(userID, submissionID, name, body string) (*Comment, error) {
	if _, err := s.GetSubmission(userID, submissionID); err != nil {
		return nil, err
	}
	c := Comment{ID: "cmt_" + randHex(9), AuthorID: &userID, AuthorName: name, Body: body,
		CreatedAt: time.Now().UnixMilli()}
	_, err := s.DB.Exec(
		`INSERT INTO submission_comments (id, submission_id, author_id, author_name, body, created_at)
		 VALUES (?,?,?,?,?,?)`, c.ID, submissionID, userID, name, body, c.CreatedAt)
	return &c, err
}

func (s *Store) ListComments(userID, submissionID string) ([]Comment, error) {
	if _, err := s.GetSubmission(userID, submissionID); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(
		`SELECT id, author_id, author_name, body, created_at
		 FROM submission_comments WHERE submission_id = ? ORDER BY created_at`, submissionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.AuthorID, &c.AuthorName, &c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// --- webhooks -------------------------------------------------------------

type Webhook struct {
	ID        string   `json:"id"`
	URL       string   `json:"url"`
	Secret    string   `json:"secret,omitempty"`
	Events    []string `json:"events"`
	CreatedAt int64    `json:"createdAt"`
}

type WebhookDelivery struct {
	ID         string `json:"id"`
	Event      string `json:"event"`
	StatusCode int    `json:"statusCode"`
	Error      string `json:"error,omitempty"`
	Attempts   int    `json:"attempts"`
	CreatedAt  int64  `json:"createdAt"`
}

func (s *Store) AddWebhook(userID, templateID, url string, events []string) (*Webhook, error) {
	if _, err := s.GetSchema(userID, templateID); err != nil {
		return nil, err
	}
	if len(events) == 0 {
		events = []string{"submission.created"}
	}
	ev, _ := json.Marshal(events)
	wh := Webhook{ID: "wh_" + randHex(9), URL: url, Secret: randHex(16), Events: events,
		CreatedAt: time.Now().UnixMilli()}
	_, err := s.DB.Exec(
		`INSERT INTO webhooks (id, template_id, url, secret, events, created_at) VALUES (?,?,?,?,?,?)`,
		wh.ID, templateID, url, wh.Secret, string(ev), wh.CreatedAt)
	return &wh, err
}

func (s *Store) ListWebhooks(userID, templateID string) ([]Webhook, error) {
	if _, err := s.GetSchema(userID, templateID); err != nil {
		return nil, err
	}
	return s.webhookRows(`SELECT id, url, '', events, created_at FROM webhooks WHERE template_id = ?`, templateID)
}

// WebhooksForTemplate returns webhooks (with secrets) for firing — no user scope.
func (s *Store) WebhooksForTemplate(templateID string) ([]Webhook, error) {
	return s.webhookRows(
		`SELECT id, url, secret, events, created_at FROM webhooks WHERE template_id = ?`, templateID)
}

func (s *Store) webhookRows(q, arg string) ([]Webhook, error) {
	rows, err := s.DB.Query(q, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Webhook{}
	for rows.Next() {
		var wh Webhook
		var ev string
		if err := rows.Scan(&wh.ID, &wh.URL, &wh.Secret, &ev, &wh.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(ev), &wh.Events)
		out = append(out, wh)
	}
	return out, rows.Err()
}

func (s *Store) DeleteWebhook(userID, id string) error {
	res, err := s.DB.Exec(
		`DELETE FROM webhooks WHERE id = ?
		 AND template_id IN (SELECT id FROM schemas WHERE user_id = ?)`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RecordDelivery(webhookID, event string, code, attempts int, errMsg string) {
	_, _ = s.DB.Exec(
		`INSERT INTO webhook_deliveries (id, webhook_id, event, status_code, error, attempts, created_at)
		 VALUES (?,?,?,?,?,?,?)`,
		"wd_"+randHex(9), webhookID, event, code, errMsg, attempts, time.Now().UnixMilli())
}

func (s *Store) ListDeliveries(userID, webhookID string) ([]WebhookDelivery, error) {
	var owned int
	_ = s.DB.QueryRow(
		`SELECT COUNT(*) FROM webhooks wh JOIN schemas sc ON sc.id = wh.template_id
		 WHERE wh.id = ? AND sc.user_id = ?`, webhookID, userID).Scan(&owned)
	if owned == 0 {
		return nil, ErrNotFound
	}
	rows, err := s.DB.Query(
		`SELECT id, event, status_code, error, attempts, created_at
		 FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50`, webhookID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WebhookDelivery{}
	for rows.Next() {
		var d WebhookDelivery
		if err := rows.Scan(&d.ID, &d.Event, &d.StatusCode, &d.Error, &d.Attempts, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
