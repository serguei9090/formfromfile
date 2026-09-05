package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/stdlib"
)

// FormFromFile is SQLite-first. Point FFF_DATABASE_URL at a postgres:// URL to
// use Postgres instead — see docs/planning/PLAN-F33.md and docs/deployment/
// SCALE.md. SQLite stays the default and the recommendation for a single team.
//
// The rest of the codebase writes SQLite-style `?` placeholders and relies on
// the single-writer connection to serialize writes. To run that same SQL
// against Postgres unchanged we:
//   - wrap the pgx driver so every statement's `?` becomes `$1,$2,…` (Postgres
//     has no `?` param syntax);
//   - widen `INTEGER` → `BIGINT` in DDL (our timestamps are unix-millis, which
//     overflow Postgres' 32-bit int4);
//   - replace `PRAGMA user_version` with a `schema_migrations` table;
//   - add `FOR UPDATE` to the last-admin guard reads (see users_guard.go).

// PGDriverName is the registered database/sql driver: pgx with a `?`→`$N`
// placeholder-rewriting wrapper. Exported for tests that need a raw handle
// (e.g. to wipe the schema between runs).
const PGDriverName = "pgx-rebind"

func init() { sql.Register(PGDriverName, rebindDriver{base: stdlib.GetDefaultDriver()}) }

// IsPostgresDSN reports whether target names a Postgres database rather than a
// SQLite file path.
func IsPostgresDSN(target string) bool {
	return strings.HasPrefix(target, "postgres://") || strings.HasPrefix(target, "postgresql://")
}

// RedactDSN returns a form of target safe to log: a SQLite path is returned
// as-is, a Postgres URL has its userinfo (password) and query string stripped.
func RedactDSN(target string) string {
	if !IsPostgresDSN(target) {
		return target
	}
	u, err := url.Parse(target)
	if err != nil {
		return "postgres://[unparseable]"
	}
	db := strings.TrimPrefix(u.Path, "/")
	if db == "" {
		return "postgres://" + u.Host
	}
	return "postgres://" + u.Host + "/" + db
}

// --- driver wrapper: rewrite `?` placeholders to `$N` -----------------------

type rebindDriver struct{ base driver.Driver }

func (d rebindDriver) Open(name string) (driver.Conn, error) {
	c, err := d.base.Open(name)
	if err != nil {
		return nil, err
	}
	return rebindConn{c}, nil
}

type rebindConn struct{ driver.Conn }

func (c rebindConn) Prepare(q string) (driver.Stmt, error) {
	return c.Conn.Prepare(rebindPlaceholders(q))
}

func (c rebindConn) PrepareContext(ctx context.Context, q string) (driver.Stmt, error) {
	if p, ok := c.Conn.(driver.ConnPrepareContext); ok {
		return p.PrepareContext(ctx, rebindPlaceholders(q))
	}
	return c.Conn.Prepare(rebindPlaceholders(q))
}

func (c rebindConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	if qc, ok := c.Conn.(driver.QueryerContext); ok {
		return qc.QueryContext(ctx, rebindPlaceholders(q), args)
	}
	return nil, driver.ErrSkip
}

func (c rebindConn) ExecContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	if ec, ok := c.Conn.(driver.ExecerContext); ok {
		return ec.ExecContext(ctx, rebindPlaceholders(q), args)
	}
	return nil, driver.ErrSkip
}

func (c rebindConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	// pgx's stdlib conn always implements ConnBeginTx.
	return c.Conn.(driver.ConnBeginTx).BeginTx(ctx, opts)
}

func (c rebindConn) Ping(ctx context.Context) error {
	if p, ok := c.Conn.(driver.Pinger); ok {
		return p.Ping(ctx)
	}
	return nil
}

func (c rebindConn) ResetSession(ctx context.Context) error {
	if r, ok := c.Conn.(driver.SessionResetter); ok {
		return r.ResetSession(ctx)
	}
	return nil
}

func (c rebindConn) IsValid() bool {
	if v, ok := c.Conn.(driver.Validator); ok {
		return v.IsValid()
	}
	return true
}

func (c rebindConn) CheckNamedValue(v *driver.NamedValue) error {
	if ck, ok := c.Conn.(driver.NamedValueChecker); ok {
		return ck.CheckNamedValue(v)
	}
	return driver.ErrSkip
}

// rebindPlaceholders replaces each `?` with a positional `$N`. Safe for this
// codebase: no query contains a literal `?` inside a string literal or comment
// (checked). Not a general-purpose rewriter.
func rebindPlaceholders(q string) string {
	if !strings.ContainsRune(q, '?') {
		return q
	}
	var b strings.Builder
	b.Grow(len(q) + 8)
	n := 0
	for i := 0; i < len(q); i++ {
		if q[i] == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
			continue
		}
		b.WriteByte(q[i])
	}
	return b.String()
}

// --- Postgres schema bring-up ---------------------------------------------

// openPostgres connects with a small pool and applies the schema + migrations.
func openPostgres(dsn string) (*Store, error) {
	db, err := sql.Open(PGDriverName, dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(4)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	s := &Store{DB: db, forUpdate: " FOR UPDATE"}
	if err := s.applyPostgres(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) applyPostgres() error {
	for _, stmt := range splitStatements(pgDDL(schema)) {
		if _, err := s.DB.Exec(stmt); err != nil {
			return fmt.Errorf("apply pg schema (%.60s…): %w", stmt, err)
		}
	}
	if _, err := s.DB.Exec(
		`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`,
	); err != nil {
		return fmt.Errorf("pg schema_migrations: %w", err)
	}
	var have int
	if err := s.DB.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&have); err != nil {
		return fmt.Errorf("pg migration version: %w", err)
	}
	for i := have; i < len(migrations); i++ {
		if err := s.tx(func(tx *sql.Tx) error {
			for _, stmt := range splitStatements(pgDDL(migrations[i])) {
				if _, err := tx.Exec(stmt); err != nil {
					return fmt.Errorf("statement %.60s…: %w", stmt, err)
				}
			}
			_, err := tx.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, i+1)
			return err
		}); err != nil {
			return fmt.Errorf("pg migration %d: %w", i+1, err)
		}
	}
	return nil
}

// pgDDL adapts a DDL string for Postgres:
//   - our unix-millis timestamps are declared INTEGER (fine in SQLite's
//     dynamic typing) but overflow Postgres int4, so widen every INTEGER to
//     BIGINT. No column or identifier in the schema contains the substring
//     "INTEGER" and no AUTOINCREMENT is used, so a blanket replace is safe.
//   - the v3 data backfill generates ids with lower(hex(randomblob(12))), a
//     SQLite-only expression; swap it for a portable 32-hex-char equivalent
//     (ids are opaque). No-op on a fresh DB where `schemas` is empty.
func pgDDL(s string) string {
	s = strings.ReplaceAll(s, "INTEGER", "BIGINT")
	s = strings.ReplaceAll(s,
		"lower(hex(randomblob(12)))",
		"md5(random()::text || clock_timestamp()::text)")
	return s
}

// splitStatements breaks a multi-statement SQL string on `;`. The pgx driver
// (extended protocol) rejects multiple statements per Exec; SQLite accepts
// them but splitting is harmless there too. Migration strings in this package
// never contain a `;` inside a string literal or a quoted body — keep it that
// way.
func splitStatements(s string) []string {
	parts := strings.Split(s, ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// tx runs fn inside a transaction, rolling back on error.
func (s *Store) tx(fn func(*sql.Tx) error) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func isNoRows(err error) bool { return errors.Is(err, sql.ErrNoRows) }
