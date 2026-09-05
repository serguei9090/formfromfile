package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/serguei9090/formfromfile/internal/auth"
	"github.com/serguei9090/formfromfile/internal/store"
)

// runUserCLI implements `formfromfile user <add|ls|passwd|rm> ...` — account
// management straight against the SQLite file, no HTTP and no admin session.
// It exists for recovery (lost the only admin's password, or no server
// running) and scripted provisioning. It needs filesystem access to the DB
// file, which is already the same trust level as shell access to the host
// running the server.
func runUserCLI(args []string) {
	if len(args) == 0 {
		userUsage()
		os.Exit(2)
	}
	sub, rest := args[0], args[1:]
	switch sub {
	case "add":
		cmdUserAdd(rest)
	case "ls", "list":
		cmdUserList(rest)
	case "passwd":
		cmdUserPasswd(rest)
	case "rm", "remove":
		cmdUserRemove(rest)
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n\n", sub)
		userUsage()
		os.Exit(2)
	}
}

func userUsage() {
	fmt.Fprint(os.Stderr, `usage: formfromfile user <command> [flags] <email>

Commands:
  user add     [--password P] [--role admin|author|user] [--db D] <email>
  user ls      [--db D]
  user passwd  --password P [--db D] <email>
  user rm      --yes [--db D] <email>

Flags must come before the email argument (Go's flag package stops parsing
at the first non-flag token).

All commands operate directly on the SQLite file — no server needs to be
running, and no admin session is required. --db defaults to $FFF_DB or
"formfromfile.db", same as the server itself.
`)
}

func openStoreFlag(fs *flag.FlagSet) *store.Store {
	dbPath := fs.Lookup("db").Value.String()
	st, err := store.Open(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open db %s: %v\n", dbPath, err)
		os.Exit(1)
	}
	return st
}

func cmdUserAdd(args []string) {
	fs := flag.NewFlagSet("user add", flag.ExitOnError)
	fs.String("db", envOr("FFF_DB", "formfromfile.db"), "SQLite database path")
	password := fs.String("password", "", "password (blank = generate one and print it once)")
	role := fs.String("role", "user", "admin | author | user")
	_ = fs.Parse(args)
	if fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: formfromfile user add [--password P] [--role admin|author|user] [--db D] <email>")
		os.Exit(2)
	}
	email := fs.Arg(0)

	st := openStoreFlag(fs)
	defer st.Close()
	svc := auth.NewService(st)

	u, generated, err := svc.CreateUser(email, *password, auth.Role(*role))
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	fmt.Printf("created %s (%s, role=%s)\n", u.Email, u.ID, u.Role)
	if generated != "" {
		fmt.Printf("generated password: %s\n", generated)
	}
}

func cmdUserList(args []string) {
	fs := flag.NewFlagSet("user ls", flag.ExitOnError)
	fs.String("db", envOr("FFF_DB", "formfromfile.db"), "SQLite database path")
	_ = fs.Parse(args)

	st := openStoreFlag(fs)
	defer st.Close()
	svc := auth.NewService(st)

	users, err := svc.ListUsers()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	for _, u := range users {
		status := "active"
		if u.Disabled {
			status = "disabled"
		}
		fmt.Printf("%s  %-30s  %-6s  %s\n", u.ID, u.Email, u.Role, status)
	}
}

func cmdUserPasswd(args []string) {
	fs := flag.NewFlagSet("user passwd", flag.ExitOnError)
	fs.String("db", envOr("FFF_DB", "formfromfile.db"), "SQLite database path")
	password := fs.String("password", "", "new password (required, min 10 chars)")
	_ = fs.Parse(args)
	if fs.NArg() != 1 || *password == "" {
		fmt.Fprintln(os.Stderr, "usage: formfromfile user passwd --password P [--db D] <email>")
		os.Exit(2)
	}
	email := fs.Arg(0)

	st := openStoreFlag(fs)
	defer st.Close()
	svc := auth.NewService(st)

	id, err := findUserIDByEmail(svc, email)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	if err := svc.ResetPassword(id, *password); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	fmt.Printf("password reset for %s (sessions revoked)\n", email)
}

func cmdUserRemove(args []string) {
	fs := flag.NewFlagSet("user rm", flag.ExitOnError)
	fs.String("db", envOr("FFF_DB", "formfromfile.db"), "SQLite database path")
	yes := fs.Bool("yes", false, "skip confirmation")
	_ = fs.Parse(args)
	if fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: formfromfile user rm --yes [--db D] <email>")
		os.Exit(2)
	}
	email := fs.Arg(0)

	st := openStoreFlag(fs)
	defer st.Close()
	svc := auth.NewService(st)

	id, err := findUserIDByEmail(svc, email)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	if !*yes {
		fmt.Printf("this permanently deletes %s and all their templates/submissions.\nre-run with --yes to confirm.\n", email)
		os.Exit(1)
	}
	if err := st.EraseUser(id); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	fmt.Printf("deleted %s\n", email)
}

func findUserIDByEmail(svc *auth.Service, email string) (string, error) {
	users, err := svc.ListUsers()
	if err != nil {
		return "", err
	}
	email = strings.ToLower(strings.TrimSpace(email))
	for _, u := range users {
		if strings.ToLower(u.Email) == email {
			return u.ID, nil
		}
	}
	return "", errors.New("no such user: " + email)
}
