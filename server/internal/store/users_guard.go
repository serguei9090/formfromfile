package store

import "database/sql"

// The last-admin guards below do a read (count active admins) then a write
// (disable / demote / delete). On SQLite the single-writer connection makes
// that atomic for free. On Postgres two concurrent callers could each pass
// the check and both remove the second-to-last admin, leaving zero — so the
// read locks the admin rows (forUpdate is " FOR UPDATE" there, "" on SQLite)
// and the whole thing runs in one transaction.
//
// auth.Service delegates SetDisabled / SetRole to these; EraseUser's guard
// (retention.go) is wrapped the same way.

// activeAdminCount counts enabled admins, locking those rows on Postgres.
func activeAdminCount(tx *sql.Tx, forUpdate string) (int, error) {
	rows, err := tx.Query(`SELECT 1 FROM users WHERE role = 'admin' AND disabled = 0` + forUpdate)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		n++
	}
	return n, rows.Err()
}

// SetUserDisabled enables/disables an account, refusing to disable the last
// active admin. Disabling also revokes the account's sessions.
func (s *Store) SetUserDisabled(id string, disabled bool) error {
	return s.tx(func(tx *sql.Tx) error {
		var role string
		if err := tx.QueryRow(`SELECT role FROM users WHERE id = ?`, id).Scan(&role); err != nil {
			if isNoRows(err) {
				return ErrNotFound
			}
			return err
		}
		if disabled && role == "admin" {
			n, err := activeAdminCount(tx, s.forUpdate)
			if err != nil {
				return err
			}
			if n <= 1 {
				return ErrLastAdmin
			}
		}
		b := 0
		if disabled {
			b = 1
		}
		if _, err := tx.Exec(`UPDATE users SET disabled = ? WHERE id = ?`, b, id); err != nil {
			return err
		}
		if disabled {
			if _, err := tx.Exec(`DELETE FROM sessions WHERE user_id = ?`, id); err != nil {
				return err
			}
		}
		return nil
	})
}

// SetUserRole changes an account's role, refusing to demote the last active
// admin. The caller validates that role is a known value.
func (s *Store) SetUserRole(id, role string) error {
	return s.tx(func(tx *sql.Tx) error {
		var cur string
		if err := tx.QueryRow(`SELECT role FROM users WHERE id = ?`, id).Scan(&cur); err != nil {
			if isNoRows(err) {
				return ErrNotFound
			}
			return err
		}
		if cur == "admin" && role != "admin" {
			n, err := activeAdminCount(tx, s.forUpdate)
			if err != nil {
				return err
			}
			if n <= 1 {
				return ErrLastAdmin
			}
		}
		_, err := tx.Exec(`UPDATE users SET role = ? WHERE id = ?`, role, id)
		return err
	})
}
