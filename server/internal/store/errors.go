package store

import (
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// IsUniqueViolation reports whether err is a duplicate-key / unique-constraint
// error, from either backend. SQLite (modernc) returns a message containing
// "UNIQUE constraint failed"; Postgres returns SQLSTATE 23505.
func IsUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	if strings.Contains(err.Error(), "UNIQUE constraint failed") {
		return true
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}
