package store

import (
	"testing"
)

func TestPublishUnpublishAndSlugLookup(t *testing.T) {
	st := newTestStore(t)
	sc, err := st.CreateSchema("u1", Schema{Name: "T", Kind: "xml", Body: "<a/>", FormJSON: "{}"})
	if err != nil {
		t.Fatal(err)
	}
	if sc.Visibility != "private" {
		t.Fatalf("new schema visibility = %q", sc.Visibility)
	}

	pub, err := st.PublishSchema("u1", sc.ID)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if pub.Visibility != "shared" || pub.ShareSlug == nil || *pub.ShareSlug == "" || pub.PublishedAt == nil {
		t.Fatalf("bad publish result %+v", pub)
	}
	slug := *pub.ShareSlug

	got, err := st.SchemaBySlug(slug)
	if err != nil || got.ID != sc.ID {
		t.Fatalf("by slug: %v %+v", err, got)
	}

	// another user cannot publish it
	if _, err := st.PublishSchema("u2", sc.ID); err != ErrNotFound {
		t.Errorf("cross-user publish → %v", err)
	}

	if _, err := st.UnpublishSchema("u1", sc.ID); err != nil {
		t.Fatalf("unpublish: %v", err)
	}
	if _, err := st.SchemaBySlug(slug); err != ErrNotFound {
		t.Errorf("slug after unpublish → %v, want ErrNotFound", err)
	}

	// re-publish reuses the same slug
	re, err := st.PublishSchema("u1", sc.ID)
	if err != nil || re.ShareSlug == nil || *re.ShareSlug != slug {
		t.Fatalf("re-publish changed slug: %v %+v", err, re)
	}
}

func TestSubmissionsScoped(t *testing.T) {
	st := newTestStore(t)
	sc, _ := st.CreateSchema("u1", Schema{Name: "T", Kind: "xml", Body: "<a/>", FormJSON: "{}"})

	anon, err := st.CreateSubmission(Submission{
		TemplateID: sc.ID, Submitter: "Alice", ValuesJSON: `{"a":1}`, Output: "<a>1</a>",
	}, "")
	if err != nil {
		t.Fatalf("create anon: %v", err)
	}
	if anon.FilledBy != nil {
		t.Errorf("anon submission has filledBy %v", *anon.FilledBy)
	}
	if _, err := st.CreateSubmission(Submission{TemplateID: sc.ID, Output: "x"}, "u2"); err != nil {
		t.Fatalf("create attributed: %v", err)
	}

	list, err := st.ListSubmissions("u1", sc.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("list: %v (%d)", err, len(list))
	}
	if list[0].Output != "" {
		t.Errorf("list should omit output blob, got %q", list[0].Output)
	}

	// non-owner can't list or read
	if _, err := st.ListSubmissions("u2", sc.ID); err != ErrNotFound {
		t.Errorf("cross-user list → %v", err)
	}
	if _, err := st.GetSubmission("u2", anon.ID); err != ErrNotFound {
		t.Errorf("cross-user get → %v", err)
	}

	full, err := st.GetSubmission("u1", anon.ID)
	if err != nil || full.Output != "<a>1</a>" || full.Submitter != "Alice" {
		t.Fatalf("owner get: %v %+v", err, full)
	}
}
