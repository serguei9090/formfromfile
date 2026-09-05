package main

import "testing"

func TestResolveDBTarget(t *testing.T) {
	// default: the SQLite path
	t.Setenv("FFF_DATABASE_URL", "")
	t.Setenv("FFF_DB_HOST", "")
	if got := resolveDBTarget("/data/x.db"); got != "/data/x.db" {
		t.Fatalf("default: %q", got)
	}

	// explicit URL wins
	t.Setenv("FFF_DATABASE_URL", "postgres://u:p@h:5432/d?sslmode=require")
	if got := resolveDBTarget("/data/x.db"); got != "postgres://u:p@h:5432/d?sslmode=require" {
		t.Fatalf("url: %q", got)
	}
	t.Setenv("FFF_DATABASE_URL", "")

	// discrete vars → assembled, password percent-escaped
	t.Setenv("FFF_DB_HOST", "db.internal")
	t.Setenv("FFF_DB_PORT", "5433")
	t.Setenv("FFF_DB_NAME", "fff")
	t.Setenv("FFF_DB_USER", "fff_app")
	t.Setenv("FFF_DB_PASSWORD", "p@ss/w:rd#1")
	t.Setenv("FFF_DB_SSLMODE", "verify-full")
	got := resolveDBTarget("/data/x.db")
	want := "postgres://fff_app:p%40ss%2Fw%3Ard%231@db.internal:5433/fff?sslmode=verify-full"
	if got != want {
		t.Fatalf("assembled:\n got  %q\n want %q", got, want)
	}

	// defaults: port 5432, sslmode require, db name formfromfile, no user
	for _, k := range []string{"FFF_DB_PORT", "FFF_DB_NAME", "FFF_DB_USER", "FFF_DB_PASSWORD", "FFF_DB_SSLMODE"} {
		t.Setenv(k, "")
	}
	if got := resolveDBTarget("/data/x.db"); got != "postgres://db.internal:5432/formfromfile?sslmode=require" {
		t.Fatalf("defaults: %q", got)
	}
}
