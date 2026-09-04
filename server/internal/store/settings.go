package store

import (
	"database/sql"
	"errors"
	"time"
)

// Settings is the runtime key/value overrides an admin edits from
// /admin/settings. Callers merge these over env vars and built-in defaults.

// AllSettings returns every stored override as key→value. An empty map means
// nothing is overridden (fresh install / all reset).
func (s *Store) AllSettings() (map[string]string, error) {
	rows, err := s.DB.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// GetSetting returns one override and whether it exists.
func (s *Store) GetSetting(key string) (string, bool, error) {
	var v string
	err := s.DB.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// SetSetting upserts one override.
func (s *Store) SetSetting(key, value, userID string) error {
	var by any
	if userID != "" {
		by = userID
	}
	_, err := s.DB.Exec(`
		INSERT INTO settings (key, value, updated_at, updated_by)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value,
		                              updated_at = excluded.updated_at,
		                              updated_by = excluded.updated_by`,
		key, value, time.Now().Unix(), by)
	return err
}

// DeleteSetting removes one override (revert to env / default).
func (s *Store) DeleteSetting(key string) error {
	_, err := s.DB.Exec(`DELETE FROM settings WHERE key = ?`, key)
	return err
}
