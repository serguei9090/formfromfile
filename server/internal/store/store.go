// Package store is the SQLite persistence layer for FormFromFile.
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  pw_hash     TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
  disabled    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS schemas (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,                  -- 'xml' | 'yaml' | 'json' (F12: + toml/ini/dotenv/csv)
  body        TEXT NOT NULL,
  form_json   TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_schemas_user ON schemas(user_id, updated_at DESC);
`

// migrations are applied in order; the DB's PRAGMA user_version tracks how many
// have run. Index i (0-based) brings the DB to user_version i+1. Never edit or
// reorder a shipped entry — only append.
var migrations = []string{
	// v1 — template publish/share columns.
	`ALTER TABLE schemas ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
	 ALTER TABLE schemas ADD COLUMN share_slug TEXT;
	 ALTER TABLE schemas ADD COLUMN published_at INTEGER;`,

	// v2 — submissions: one filled-in copy of a template (F11).
	`CREATE TABLE submissions (
	   id           TEXT PRIMARY KEY,
	   template_id  TEXT NOT NULL REFERENCES schemas(id) ON DELETE CASCADE,
	   filled_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
	   submitter    TEXT NOT NULL DEFAULT '',
	   values_json  TEXT NOT NULL DEFAULT '',
	   output       TEXT NOT NULL DEFAULT '',
	   created_at   INTEGER NOT NULL
	 );
	 CREATE INDEX ix_submissions_template ON submissions(template_id, created_at DESC);
	 CREATE UNIQUE INDEX ix_schemas_slug ON schemas(share_slug) WHERE share_slug IS NOT NULL;`,
}

func migrate(db *sql.DB) error {
	var v int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}
	for i := v; i < len(migrations); i++ {
		if _, err := db.Exec(migrations[i]); err != nil {
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		// PRAGMA user_version cannot be parameterized; i+1 is a trusted int.
		if _, err := db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			return fmt.Errorf("bump user_version to %d: %w", i+1, err)
		}
	}
	return nil
}

// Store wraps the database handle.
type Store struct{ DB *sql.DB }

// Open opens (creating if needed) the SQLite database at dsn and applies the
// schema.
func Open(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if err := migrate(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{DB: db}, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// CountUsers reports how many accounts exist (the first one becomes admin).
func (s *Store) CountUsers() (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}
