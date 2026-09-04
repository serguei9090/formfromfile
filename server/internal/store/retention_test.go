package store

import (
	"errors"
	"testing"
	"time"
)

func TestPurgeExpiredSubmissions(t *testing.T) {
	st := newTestStore(t)
	sc, _ := st.CreateSchema("u1", Schema{Name: "t", Kind: "json", Body: "{}", FormJSON: "{}"})

	mk := func(ageDays int) {
		s, err := st.CreateSubmission(Submission{TemplateID: sc.ID, ValuesJSON: "{}"}, "")
		if err != nil {
			t.Fatal(err)
		}
		old := time.Now().Add(-time.Duration(ageDays) * 24 * time.Hour).UnixMilli()
		_, _ = st.DB.Exec(`UPDATE submissions SET created_at = ? WHERE id = ?`, old, s.ID)
	}
	mk(1)
	mk(10)
	mk(40)

	// no window → nothing deleted
	if n, _ := st.PurgeExpiredSubmissions(0); n != 0 {
		t.Fatalf("purge with no window deleted %d", n)
	}

	// per-template window of 30d → the 40d row goes
	if _, err := st.SetTemplateOps("u1", sc.ID, 0, 30, ""); err != nil {
		t.Fatal(err)
	}
	if n, _ := st.PurgeExpiredSubmissions(0); n != 1 {
		t.Fatalf("per-template purge deleted %d, want 1", n)
	}

	// default window of 7d applies to templates with retention_days = 0 —
	// but this template has 30, so the 10d row survives
	if n, _ := st.PurgeExpiredSubmissions(7); n != 0 {
		t.Fatalf("default purge hit a per-template-windowed row: %d", n)
	}

	// clear the per-template window → default 7d now removes the 10d row
	if _, err := st.SetTemplateOps("u1", sc.ID, 0, 0, ""); err != nil {
		t.Fatal(err)
	}
	if n, _ := st.PurgeExpiredSubmissions(7); n != 1 {
		t.Fatalf("default purge deleted %d, want 1", n)
	}
	if st.SubmissionCount(sc.ID) != 1 {
		t.Fatalf("expected 1 submission left, got %d", st.SubmissionCount(sc.ID))
	}
}

func TestExportAndEraseUser(t *testing.T) {
	st := newTestStore(t)
	sc, _ := st.CreateSchema("u1", Schema{Name: "t", Kind: "json", Body: "{}", FormJSON: "{}"})
	_, _ = st.CreateSubmission(Submission{TemplateID: sc.ID, ValuesJSON: `{"x":1}`}, "u2")

	ex, err := st.ExportUser("u1")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if ex.User.Email != "a@b.com" || len(ex.Templates) != 1 || len(ex.OwnedSubs) != 1 {
		t.Fatalf("export shape: %+v", ex)
	}
	if f, err := st.ExportUser("u2"); err != nil || len(f.TheirFills) != 1 {
		t.Fatalf("u2 fills: %+v err=%v", f, err)
	}

	// erasing u1 cascades the template + its submission; u2's fill row is kept
	// but its filled_by is nulled
	if err := st.EraseUser("u1"); err != nil {
		t.Fatalf("erase: %v", err)
	}
	if _, err := st.ExportUser("u1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("u1 still present: %v", err)
	}
	var subs int
	_ = st.DB.QueryRow(`SELECT COUNT(*) FROM submissions`).Scan(&subs)
	if subs != 0 {
		t.Fatalf("submissions on erased user's template not cascaded: %d", subs)
	}
}

func TestEraseLastAdminRefused(t *testing.T) {
	st := newTestStore(t)
	_, _ = st.DB.Exec(`UPDATE users SET role = 'admin' WHERE id = 'u1'`)
	if err := st.EraseUser("u1"); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("erase last admin: want ErrLastAdmin, got %v", err)
	}
}
