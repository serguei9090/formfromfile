package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/serguei9090/formfromfile/internal/auth"
	"github.com/serguei9090/formfromfile/internal/store"
)

type testEnv struct {
	srv  *httptest.Server
	jar  http.CookieJar // authed client
	anon *http.Client   // no cookies
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	svc := auth.NewService(st)
	srv := httptest.NewServer(Router(Options{Store: st, Auth: svc, AllowRegister: true}))
	t.Cleanup(srv.Close)

	jar, _ := cookiejar.New(nil)
	return &testEnv{srv: srv, jar: jar, anon: &http.Client{}}
}

func (e *testEnv) do(t *testing.T, client *http.Client, method, path string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rdr)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	_ = res.Body.Close()
	return res, out
}

// authed returns a client that has registered (first user = admin) and holds
// the session cookie.
func (e *testEnv) authed(t *testing.T) *http.Client {
	c := &http.Client{Jar: e.jar}
	res, out := e.do(t, c, "POST", "/api/auth/register",
		map[string]string{"email": "admin@example.com", "password": "correct-horse-1"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	return c
}

func TestSchemaLifecycleAndPublicShare(t *testing.T) {
	e := newEnv(t)
	owner := e.authed(t)

	// create
	res, out := e.do(t, owner, "POST", "/api/schemas", map[string]string{
		"name": "T", "kind": "toml", "body": "a = 1", "formJson": "{}",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	id := out["schema"].(map[string]any)["id"].(string)

	// publish → slug
	res, out = e.do(t, owner, "POST", "/api/schemas/"+id+"/publish", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("publish: %d %v", res.StatusCode, out)
	}
	slug := out["schema"].(map[string]any)["shareSlug"].(string)
	if slug == "" {
		t.Fatal("no slug after publish")
	}

	// public template — no auth, trimmed
	res, out = e.do(t, e.anon, "GET", "/api/public/templates/"+slug, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("public template: %d", res.StatusCode)
	}
	tpl := out["template"].(map[string]any)
	if _, leaked := tpl["userId"]; leaked {
		t.Error("public template leaked userId")
	}

	// anonymous submission
	res, _ = e.do(t, e.anon, "POST", "/api/public/templates/"+slug+"/submissions",
		map[string]string{"submitter": "Bob", "valuesJson": `{"a":2}`, "output": "a = 2"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("submission: %d", res.StatusCode)
	}

	// owner lists it
	res, out = e.do(t, owner, "GET", "/api/schemas/"+id+"/submissions", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list submissions: %d", res.StatusCode)
	}
	subs := out["submissions"].([]any)
	if len(subs) != 1 || subs[0].(map[string]any)["submitter"] != "Bob" {
		t.Fatalf("bad submissions %v", subs)
	}
	subID := subs[0].(map[string]any)["id"].(string)

	// delete it
	if res, _ := e.do(t, owner, "DELETE", "/api/submissions/"+subID, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("delete submission: %d", res.StatusCode)
	}
	res, out = e.do(t, owner, "GET", "/api/schemas/"+id+"/submissions", nil)
	if len(out["submissions"].([]any)) != 0 {
		t.Fatalf("submission not deleted: %v", out)
	}

	// unpublish → public 404
	e.do(t, owner, "POST", "/api/schemas/"+id+"/unpublish", nil)
	res, _ = e.do(t, e.anon, "GET", "/api/public/templates/"+slug, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("public after unpublish: %d, want 404", res.StatusCode)
	}
}

func TestPublicSubmissionRateLimited(t *testing.T) {
	e := newEnv(t)
	owner := e.authed(t)
	_, out := e.do(t, owner, "POST", "/api/schemas", map[string]string{
		"name": "T", "kind": "json", "body": "{}", "formJson": "{}",
	})
	id := out["schema"].(map[string]any)["id"].(string)
	_, out = e.do(t, owner, "POST", "/api/schemas/"+id+"/publish", nil)
	slug := out["schema"].(map[string]any)["shareSlug"].(string)

	got429 := false
	for i := 0; i < 25; i++ {
		res, _ := e.do(t, e.anon, "POST", "/api/public/templates/"+slug+"/submissions",
			map[string]string{"valuesJson": "{}", "output": "x"})
		if res.StatusCode == http.StatusTooManyRequests {
			got429 = true
			break
		}
	}
	if !got429 {
		t.Fatal("expected a 429 after the per-IP window filled")
	}
}

func TestAuthAndScopeGuards(t *testing.T) {
	e := newEnv(t)
	owner := e.authed(t)
	_, out := e.do(t, owner, "POST", "/api/schemas", map[string]string{
		"name": "mine", "kind": "json", "body": "{}", "formJson": "{}",
	})
	id := out["schema"].(map[string]any)["id"].(string)

	// unauthenticated → 401
	if res, _ := e.do(t, e.anon, "GET", "/api/schemas", nil); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("anon /api/schemas → %d, want 401", res.StatusCode)
	}

	// a second user cannot see the first user's schema
	jar2, _ := cookiejar.New(nil)
	other := &http.Client{Jar: jar2}
	e.do(t, other, "POST", "/api/auth/register",
		map[string]string{"email": "b@example.com", "password": "correct-horse-2"})
	if res, _ := e.do(t, other, "GET", "/api/schemas/"+id, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("cross-user GET → %d, want 404", res.StatusCode)
	}
	if res, _ := e.do(t, other, "POST", "/api/schemas/"+id+"/publish", nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("cross-user publish → %d, want 404", res.StatusCode)
	}

	// bad kind
	res, _ := e.do(t, owner, "POST", "/api/schemas", map[string]string{
		"name": "x", "kind": "yaml-ish", "body": "{}", "formJson": "{}",
	})
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("bad kind → %d, want 400", res.StatusCode)
	}

	// non-admin hitting an admin route → 403
	jar3, _ := cookiejar.New(nil)
	plain := &http.Client{Jar: jar3}
	e.do(t, plain, "POST", "/api/auth/register",
		map[string]string{"email": "c@example.com", "password": "correct-horse-3"})
	if res, _ := e.do(t, plain, "GET", "/api/admin/users", nil); res.StatusCode != http.StatusForbidden {
		t.Errorf("non-admin /api/admin/users → %d, want 403", res.StatusCode)
	}
}

func TestVersioningForkAndApproval(t *testing.T) {
	e := newEnv(t)
	owner := e.authed(t)

	_, out := e.do(t, owner, "POST", "/api/schemas", map[string]any{
		"name": "T", "kind": "yaml", "body": "a: 1", "formJson": "{}", "folder": "infra",
		"tags": []string{"prod"},
	})
	id := out["schema"].(map[string]any)["id"].(string)

	// folder filter (before any edit)
	_, fout := e.do(t, owner, "GET", "/api/schemas?folder=infra", nil)
	if len(fout["schemas"].([]any)) != 1 {
		t.Fatalf("folder filter: %v", fout)
	}
	_, fout = e.do(t, owner, "GET", "/api/schemas?folder=nope", nil)
	if len(fout["schemas"].([]any)) != 0 {
		t.Fatalf("folder filter miss: %v", fout)
	}

	// update -> new version with a note (carries folder forward)
	res, out := e.do(t, owner, "PUT", "/api/schemas/"+id, map[string]any{
		"name": "T", "kind": "yaml", "body": "a: 2", "formJson": "{}", "notes": "bumped a",
		"folder": "infra",
	})
	if res.StatusCode != http.StatusOK || out["schema"].(map[string]any)["currentVersion"].(float64) != 2 {
		t.Fatalf("update: %d %v", res.StatusCode, out)
	}

	_, out = e.do(t, owner, "GET", "/api/schemas/"+id+"/versions", nil)
	vs := out["versions"].([]any)
	if len(vs) != 2 || vs[0].(map[string]any)["notes"] != "bumped a" {
		t.Fatalf("versions: %v", vs)
	}

	// rollback to v1 -> creates v3 with v1's body
	res, out = e.do(t, owner, "POST", "/api/schemas/"+id+"/rollback/1", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("rollback: %d", res.StatusCode)
	}
	res, out = e.do(t, owner, "GET", "/api/schemas/"+id, nil)
	if out["schema"].(map[string]any)["body"] != "a: 1" {
		t.Fatalf("rollback body: %v", out["schema"])
	}

	// fork
	res, out = e.do(t, owner, "POST", "/api/schemas/"+id+"/fork", nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("fork: %d", res.StatusCode)
	}
	forkID := out["schema"].(map[string]any)["id"].(string)
	if forkID == id {
		t.Fatal("fork reused the id")
	}

	// approval gate: publish, turn on review, submit -> pending
	e.do(t, owner, "POST", "/api/schemas/"+id+"/publish", nil)
	e.do(t, owner, "POST", "/api/schemas/"+id+"/approval", map[string]bool{"requiresApproval": true})
	_, out = e.do(t, owner, "GET", "/api/schemas/"+id, nil)
	slug := out["schema"].(map[string]any)["shareSlug"].(string)

	e.do(t, e.anon, "POST", "/api/public/templates/"+slug+"/submissions",
		map[string]string{"valuesJson": "{}", "output": "x"})
	_, out = e.do(t, owner, "GET", "/api/schemas/"+id+"/submissions", nil)
	sub := out["submissions"].([]any)[0].(map[string]any)
	if sub["status"] != "pending" {
		t.Fatalf("gated submission status = %v, want pending", sub["status"])
	}
	subID := sub["id"].(string)
	res, out = e.do(t, owner, "POST", "/api/submissions/"+subID+"/review",
		map[string]any{"approved": true, "note": ""})
	if res.StatusCode != http.StatusOK || out["submission"].(map[string]any)["status"] != "approved" {
		t.Fatalf("review: %d %v", res.StatusCode, out)
	}
}

func TestHealthAndConfig(t *testing.T) {
	e := newEnv(t)
	res, out := e.do(t, e.anon, "GET", "/healthz", nil)
	if res.StatusCode != http.StatusOK || out["ok"] != true {
		t.Fatalf("healthz: %d %v", res.StatusCode, out)
	}
	_, out = e.do(t, e.anon, "GET", "/api/config", nil)
	if out["allowRegister"] != true {
		t.Fatalf("config: %v", out)
	}
}
