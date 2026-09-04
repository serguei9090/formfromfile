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

	// v3 — template lifecycle (F21): version history, draft/publish status,
	// folders + tags, fork lineage, approval gate.
	`CREATE TABLE template_versions (
	   id           TEXT PRIMARY KEY,
	   template_id  TEXT NOT NULL REFERENCES schemas(id) ON DELETE CASCADE,
	   version      INTEGER NOT NULL,
	   body         TEXT NOT NULL DEFAULT '',
	   form_json    TEXT NOT NULL DEFAULT '',
	   notes        TEXT NOT NULL DEFAULT '',
	   created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
	   created_at   INTEGER NOT NULL
	 );
	 CREATE UNIQUE INDEX ix_tv ON template_versions(template_id, version);
	 ALTER TABLE schemas ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1;
	 ALTER TABLE schemas ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
	 ALTER TABLE schemas ADD COLUMN folder TEXT NOT NULL DEFAULT '';
	 ALTER TABLE schemas ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
	 ALTER TABLE schemas ADD COLUMN forked_from TEXT;
	 ALTER TABLE schemas ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0;
	 ALTER TABLE submissions ADD COLUMN template_version INTEGER;
	 ALTER TABLE submissions ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
	 ALTER TABLE submissions ADD COLUMN reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
	 ALTER TABLE submissions ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
	 UPDATE schemas SET status = 'published' WHERE visibility = 'shared';
	 INSERT INTO template_versions (id, template_id, version, body, form_json, notes, created_at)
	   SELECT lower(hex(randomblob(12))), id, 1, body, form_json, 'initial', created_at FROM schemas;`,

	// v4 — team & workflow (F25): the 'author' role, submission comments,
	// webhooks + delivery log. Existing 'user' accounts become 'author' so
	// multi-user setups keep working; new sign-ups are fillers ('user').
	`UPDATE users SET role = 'author' WHERE role = 'user';
	 CREATE TABLE submission_comments (
	   id            TEXT PRIMARY KEY,
	   submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
	   author_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
	   author_name   TEXT NOT NULL DEFAULT '',
	   body          TEXT NOT NULL,
	   created_at    INTEGER NOT NULL
	 );
	 CREATE INDEX ix_sc_submission ON submission_comments(submission_id, created_at);
	 CREATE TABLE webhooks (
	   id          TEXT PRIMARY KEY,
	   template_id TEXT NOT NULL REFERENCES schemas(id) ON DELETE CASCADE,
	   url         TEXT NOT NULL,
	   secret      TEXT NOT NULL,
	   events      TEXT NOT NULL DEFAULT '["submission.created"]',
	   created_at  INTEGER NOT NULL
	 );
	 CREATE INDEX ix_wh_template ON webhooks(template_id);
	 CREATE TABLE webhook_deliveries (
	   id          TEXT PRIMARY KEY,
	   webhook_id  TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
	   event       TEXT NOT NULL,
	   status_code INTEGER NOT NULL DEFAULT 0,
	   error       TEXT NOT NULL DEFAULT '',
	   attempts    INTEGER NOT NULL DEFAULT 0,
	   created_at  INTEGER NOT NULL
	 );
	 CREATE INDEX ix_wd_webhook ON webhook_deliveries(webhook_id, created_at DESC);`,

	// v5 — ops (F26): audit log, per-slug submission cap, per-template branding,
	// a public-view counter for completion-rate analytics.
	`CREATE TABLE audit_log (
	   id          TEXT PRIMARY KEY,
	   actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
	   actor_email TEXT NOT NULL DEFAULT '',
	   action      TEXT NOT NULL,
	   target      TEXT NOT NULL DEFAULT '',
	   detail      TEXT NOT NULL DEFAULT '',
	   created_at  INTEGER NOT NULL
	 );
	 CREATE INDEX ix_audit_time ON audit_log(created_at DESC);
	 ALTER TABLE schemas ADD COLUMN submission_cap INTEGER NOT NULL DEFAULT 0;
	 ALTER TABLE schemas ADD COLUMN brand TEXT NOT NULL DEFAULT '';
	 ALTER TABLE schemas ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;`,

	// v6 — runtime settings (F29b): a key/value store an admin edits from
	// /admin/settings. A row here overrides the matching env var / built-in
	// default; an empty table means behaviour is exactly as before.
	`CREATE TABLE settings (
	   key        TEXT PRIMARY KEY,
	   value      TEXT NOT NULL,
	   updated_at INTEGER NOT NULL,
	   updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
	 );`,
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
