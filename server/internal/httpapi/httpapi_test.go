package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/serguei9090/formfromfile/internal/auth"
	"github.com/serguei9090/formfromfile/internal/store"
	"github.com/serguei9090/formfromfile/internal/webhook"
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
	srv := httptest.NewServer(Router(Options{
		Store: st, Auth: svc, AllowRegister: true, WebhookAllowPrivate: true,
	}))
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
	_, out = e.do(t, owner, "GET", "/api/schemas/"+id+"/submissions", nil)
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

	// a second user (a filler — new sign-ups get the 'user' role)
	jar2, _ := cookiejar.New(nil)
	other := &http.Client{Jar: jar2}
	_, ou := e.do(t, other, "POST", "/api/auth/register",
		map[string]string{"email": "b@example.com", "password": "correct-horse-2"})
	if res, _ := e.do(t, other, "GET", "/api/schemas/"+id, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("cross-user GET → %d, want 404", res.StatusCode)
	}
	// a filler can't publish anything → 403 before ownership is even checked
	if res, _ := e.do(t, other, "POST", "/api/schemas/"+id+"/publish", nil); res.StatusCode != http.StatusForbidden {
		t.Errorf("filler publish → %d, want 403", res.StatusCode)
	}
	// promote to author, now it's a cross-user 404
	otherID := ou["user"].(map[string]any)["id"].(string)
	e.do(t, owner, "POST", "/api/admin/users/"+otherID+"/role", map[string]string{"role": "author"})
	if res, _ := e.do(t, other, "POST", "/api/schemas/"+id+"/publish", nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("cross-user author publish → %d, want 404", res.StatusCode)
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
	res, _ = e.do(t, owner, "POST", "/api/schemas/"+id+"/rollback/1", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("rollback: %d", res.StatusCode)
	}
	_, out = e.do(t, owner, "GET", "/api/schemas/"+id, nil)
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

func TestWebhookCommentsAndZip(t *testing.T) {
	e := newEnv(t)
	owner := e.authed(t)

	// a webhook receiver
	var got webhook.Payload
	var sig string
	recv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sig = r.Header.Get("X-FFF-Signature")
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(200)
	}))
	defer recv.Close()

	_, out := e.do(t, owner, "POST", "/api/schemas", map[string]any{
		"name": "T", "kind": "json", "body": "{}", "formJson": "{}",
	})
	id := out["schema"].(map[string]any)["id"].(string)
	e.do(t, owner, "POST", "/api/schemas/"+id+"/webhooks",
		map[string]any{"url": recv.URL, "events": []string{"submission.created"}})
	e.do(t, owner, "POST", "/api/schemas/"+id+"/publish", nil)
	_, out = e.do(t, owner, "GET", "/api/schemas/"+id, nil)
	slug := out["schema"].(map[string]any)["shareSlug"].(string)

	e.do(t, e.anon, "POST", "/api/public/templates/"+slug+"/submissions",
		map[string]string{"submitter": "Ann", "valuesJson": `{"a":1}`, "output": "a=1"})

	// webhook fires in a goroutine
	for i := 0; i < 40 && got.Event == ""; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if got.Event != "submission.created" || got.Output != "a=1" {
		t.Fatalf("webhook payload: %+v", got)
	}
	if !strings.HasPrefix(sig, "sha256=") {
		t.Fatalf("missing HMAC signature: %q", sig)
	}

	// comment thread
	_, out = e.do(t, owner, "GET", "/api/schemas/"+id+"/submissions", nil)
	subID := out["submissions"].([]any)[0].(map[string]any)["id"].(string)
	if res, _ := e.do(t, owner, "POST", "/api/submissions/"+subID+"/comments",
		map[string]string{"body": "looks good"}); res.StatusCode != http.StatusCreated {
		t.Fatalf("add comment: %d", res.StatusCode)
	}
	_, out = e.do(t, owner, "GET", "/api/submissions/"+subID+"/comments", nil)
	if len(out["comments"].([]any)) != 1 {
		t.Fatalf("comments: %v", out)
	}

	// zip export
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/schemas/"+id+"/submissions.zip", nil)
	c := &http.Client{Jar: e.jar}
	res, err := c.Do(req)
	if err != nil || res.StatusCode != 200 || res.Header.Get("Content-Type") != "application/zip" {
		t.Fatalf("zip: %v %d", err, res.StatusCode)
	}
	_ = res.Body.Close()
}

func TestOpsCapAuditAndBranding(t *testing.T) {
	e := newEnv(t)
	owner := e.authed(t)

	_, out := e.do(t, owner, "POST", "/api/schemas", map[string]any{
		"name": "T", "kind": "json", "body": "{}", "formJson": "{}",
	})
	id := out["schema"].(map[string]any)["id"].(string)
	e.do(t, owner, "POST", "/api/schemas/"+id+"/publish", nil)
	e.do(t, owner, "POST", "/api/schemas/"+id+"/ops",
		map[string]any{"submissionCap": 1, "brand": `{"accent":"#123456"}`})
	_, out = e.do(t, owner, "GET", "/api/schemas/"+id, nil)
	slug := out["schema"].(map[string]any)["shareSlug"].(string)

	// public view exposes the brand + bumps view_count
	_, pt := e.do(t, e.anon, "GET", "/api/public/templates/"+slug, nil)
	if pt["template"].(map[string]any)["brand"] != `{"accent":"#123456"}` {
		t.Fatalf("brand not exposed: %v", pt)
	}

	// first submission ok, second blocked by the cap
	if res, _ := e.do(t, e.anon, "POST", "/api/public/templates/"+slug+"/submissions",
		map[string]string{"valuesJson": "{}", "output": "x"}); res.StatusCode != http.StatusCreated {
		t.Fatalf("first submission: %d", res.StatusCode)
	}
	if res, _ := e.do(t, e.anon, "POST", "/api/public/templates/"+slug+"/submissions",
		map[string]string{"valuesJson": "{}", "output": "x"}); res.StatusCode != http.StatusForbidden {
		t.Fatalf("capped submission: %d, want 403", res.StatusCode)
	}

	// audit recorded publish + ops
	_, out = e.do(t, owner, "GET", "/api/admin/audit", nil)
	actions := map[string]bool{}
	for _, a := range out["entries"].([]any) {
		actions[a.(map[string]any)["action"].(string)] = true
	}
	if !actions["template.publish"] || !actions["template.ops"] {
		t.Fatalf("audit missing entries: %v", actions)
	}
}

func TestSubmissionCooldownAndDailyCeiling(t *testing.T) {
	// freeze + advance a fake clock; reset the process-global guards
	base := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	now := base
	clock = func() time.Time { return now }
	submitCooldown = &slugCooldown{last: map[string]time.Time{}}
	submitDaily = &dailyCeiling{}
	t.Cleanup(func() {
		clock = time.Now
		submitCooldown = &slugCooldown{last: map[string]time.Time{}}
		submitDaily = &dailyCeiling{}
	})

	e := newEnv(t)
	owner := e.authed(t)
	_, out := e.do(t, owner, "POST", "/api/schemas", map[string]any{
		"name": "T", "kind": "json", "body": "{}", "formJson": "{}",
	})
	id := out["schema"].(map[string]any)["id"].(string)
	e.do(t, owner, "POST", "/api/schemas/"+id+"/publish", nil)
	_, out = e.do(t, owner, "GET", "/api/schemas/"+id, nil)
	slug := out["schema"].(map[string]any)["shareSlug"].(string)

	e.do(t, owner, "PUT", "/api/admin/settings", map[string]any{
		"submission_cooldown_seconds": "30",
		"submission_global_daily_max": "2",
	})

	submit := func() int {
		res, _ := e.do(t, e.anon, "POST", "/api/public/templates/"+slug+"/submissions",
			map[string]string{"valuesJson": "{}", "output": "x"})
		return res.StatusCode
	}

	if got := submit(); got != http.StatusCreated {
		t.Fatalf("1st submit: %d", got)
	}
	if got := submit(); got != http.StatusTooManyRequests {
		t.Fatalf("2nd submit (within cooldown): %d, want 429", got)
	}
	now = now.Add(31 * time.Second)
	if got := submit(); got != http.StatusCreated {
		t.Fatalf("3rd submit (cooldown elapsed): %d", got)
	}
	// daily ceiling = 2 now hit
	now = now.Add(31 * time.Second)
	if got := submit(); got != http.StatusTooManyRequests {
		t.Fatalf("4th submit (daily ceiling): %d, want 429", got)
	}
	// next UTC day → counter resets
	now = base.Add(24 * time.Hour)
	if got := submit(); got != http.StatusCreated {
		t.Fatalf("submit next day: %d", got)
	}
}

func TestGDPRExportAndErase(t *testing.T) {
	e := newEnv(t)
	admin := e.authed(t) // u1 = admin

	// a second account to act on
	fjar, _ := cookiejar.New(nil)
	filler := &http.Client{Jar: fjar}
	_, out := e.do(t, filler, "POST", "/api/auth/register",
		map[string]string{"email": "victim@example.com", "password": "correct-horse-9"})
	uid := out["user"].(map[string]any)["id"].(string)

	// non-admin can't export
	if res, _ := e.do(t, filler, "GET", "/api/admin/users/"+uid+"/export", nil); res.StatusCode != http.StatusForbidden {
		t.Fatalf("filler export: want 403, got %d", res.StatusCode)
	}

	// admin export returns the account + an attachment header
	res, _ := e.do(t, admin, "GET", "/api/admin/users/"+uid+"/export", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("admin export: %d", res.StatusCode)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.Contains(cd, "attachment") {
		t.Fatalf("no attachment header: %q", cd)
	}

	// erase needs the confirm token
	if res, _ := e.do(t, admin, "POST", "/api/admin/users/"+uid+"/erase", map[string]string{}); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("erase without confirm: want 400, got %d", res.StatusCode)
	}
	if res, _ := e.do(t, admin, "POST", "/api/admin/users/"+uid+"/erase",
		map[string]string{"confirm": "ERASE"}); res.StatusCode != http.StatusOK {
		t.Fatalf("erase: %d", res.StatusCode)
	}
	// gone
	if res, _ := e.do(t, admin, "GET", "/api/admin/users/"+uid+"/export", nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("export after erase: want 404, got %d", res.StatusCode)
	}
	// admin can't erase self
	selfID := ""
	_, ul := e.do(t, admin, "GET", "/api/admin/users", nil)
	for _, u := range ul["users"].([]any) {
		um := u.(map[string]any)
		if um["email"] == "admin@example.com" {
			selfID = um["id"].(string)
		}
	}
	if res, _ := e.do(t, admin, "POST", "/api/admin/users/"+selfID+"/erase",
		map[string]string{"confirm": "ERASE"}); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("erase self: want 400, got %d", res.StatusCode)
	}

	// the ops were logged
	_, dl := e.do(t, admin, "GET", "/api/admin/data-ops", nil)
	acts := map[string]bool{}
	for _, o := range dl["entries"].([]any) {
		acts[o.(map[string]any)["action"].(string)] = true
	}
	if !acts["user.export"] || !acts["user.erase"] {
		t.Fatalf("data-ops missing entries: %v", acts)
	}
}

func TestAIDisabledWithoutKey(t *testing.T) {
	e := newEnv(t) // Router built with no AI service
	owner := e.authed(t)

	res, out := e.do(t, owner, "GET", "/api/ai/status", nil)
	if res.StatusCode != http.StatusOK || out["enabled"] != false {
		t.Fatalf("ai status: %d %v", res.StatusCode, out)
	}
	res, _ = e.do(t, owner, "POST", "/api/ai/suggest-meta", map[string]string{"schema": "{}", "values": "{}"})
	if res.StatusCode != http.StatusNotImplemented {
		t.Fatalf("suggest-meta without key → %d, want 501", res.StatusCode)
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

func TestSecurityHeaders(t *testing.T) {
	e := newEnv(t)
	res, _ := e.do(t, e.anon, "GET", "/healthz", nil)
	if got := res.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("nosniff: %q", got)
	}
	if got := res.Header.Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("frame-options: %q", got)
	}
	csp := res.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "default-src 'self'") || !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Fatalf("csp baseline missing: %q", csp)
	}
	if strings.Contains(csp, "challenges.cloudflare.com") {
		t.Fatalf("csp should not allow turnstile host when unconfigured: %q", csp)
	}
	// httptest is plain HTTP → no HSTS
	if got := res.Header.Get("Strict-Transport-Security"); got != "" {
		t.Fatalf("HSTS on plain HTTP: %q", got)
	}
}

func TestSecurityHeadersCSPWithTurnstile(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	srv := httptest.NewServer(Router(Options{
		Store: st, Auth: auth.NewService(st), AllowRegister: true,
		TurnstileSiteKey: "1x00000000000000000000AA", TurnstileSecret: "secret",
	}))
	t.Cleanup(srv.Close)

	res, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	csp := res.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self' https://challenges.cloudflare.com") {
		t.Fatalf("turnstile host not in script-src: %q", csp)
	}
	if !strings.Contains(csp, "frame-src https://challenges.cloudflare.com") {
		t.Fatalf("turnstile host not in frame-src: %q", csp)
	}
}

func TestAdminCreateUser(t *testing.T) {
	e := newEnv(t)
	admin := e.authed(t)

	// non-admin can't create users
	fjar, _ := cookiejar.New(nil)
	filler := &http.Client{Jar: fjar}
	e.do(t, filler, "POST", "/api/auth/register",
		map[string]string{"email": "filler@example.com", "password": "correct-horse-2"})
	if res, _ := e.do(t, filler, "POST", "/api/admin/users",
		map[string]string{"email": "x@example.com"}); res.StatusCode != http.StatusForbidden {
		t.Fatalf("filler create user: want 403, got %d", res.StatusCode)
	}

	// admin creates a user with no password → one is generated
	res, out := e.do(t, admin, "POST", "/api/admin/users",
		map[string]string{"email": "new@example.com", "role": "author"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create user: %d %v", res.StatusCode, out)
	}
	u := out["user"].(map[string]any)
	if u["role"] != "author" || u["email"] != "new@example.com" {
		t.Fatalf("created user: %v", u)
	}
	gen, _ := out["generatedPassword"].(string)
	if len(gen) < 10 {
		t.Fatalf("generatedPassword missing/short: %q", gen)
	}

	// the generated password actually logs in
	njar, _ := cookiejar.New(nil)
	newClient := &http.Client{Jar: njar}
	if res, out := e.do(t, newClient, "POST", "/api/auth/login",
		map[string]string{"email": "new@example.com", "password": gen}); res.StatusCode != http.StatusOK {
		t.Fatalf("login with generated password: %d %v", res.StatusCode, out)
	}

	// explicit password → no generatedPassword in the response
	_, out2 := e.do(t, admin, "POST", "/api/admin/users",
		map[string]string{"email": "explicit@example.com", "password": "correct-horse-9", "role": "user"})
	if _, ok := out2["generatedPassword"]; ok {
		t.Fatalf("unexpected generatedPassword: %v", out2)
	}

	// duplicate email → 409
	if res, _ := e.do(t, admin, "POST", "/api/admin/users",
		map[string]string{"email": "new@example.com"}); res.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate email: want 409, got %d", res.StatusCode)
	}
}

func TestMetricsEndpoint(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	srv := httptest.NewServer(Router(Options{
		Store: st, Auth: auth.NewService(st), AllowRegister: true,
		MetricsToken: "sekret",
	}))
	t.Cleanup(srv.Close)

	// no token → 401
	res, _ := http.Get(srv.URL + "/metrics")
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no-token /metrics: want 401, got %d", res.StatusCode)
	}
	_ = res.Body.Close()

	// wrong token → 401
	req, _ := http.NewRequest("GET", srv.URL+"/metrics", nil)
	req.Header.Set("Authorization", "Bearer nope")
	res, _ = http.DefaultClient.Do(req)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad-token /metrics: want 401, got %d", res.StatusCode)
	}
	_ = res.Body.Close()

	// right token → 200 + exposition
	req, _ = http.NewRequest("GET", srv.URL+"/metrics", nil)
	req.Header.Set("Authorization", "Bearer sekret")
	res, _ = http.DefaultClient.Do(req)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("good-token /metrics: %d", res.StatusCode)
	}
	body := make([]byte, 4096)
	n, _ := res.Body.Read(body)
	_ = res.Body.Close()
	if !strings.Contains(string(body[:n]), "fff_http_requests_total") {
		t.Fatalf("exposition missing http counter:\n%s", body[:n])
	}
}

func TestMetricsDisabledByDefault(t *testing.T) {
	e := newEnv(t)
	res, _ := e.do(t, e.anon, "GET", "/metrics", nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("/metrics without a token: want 404, got %d", res.StatusCode)
	}
}

func TestRuntimeSettings(t *testing.T) {
	e := newEnv(t)
	admin := e.authed(t) // first user

	// a second account so register-closed actually bites (bootstrap exemption)
	if res, out := e.do(t, e.anon, "POST", "/api/auth/register",
		map[string]string{"email": "u2@example.com", "password": "correct-horse-2"}); res.StatusCode != http.StatusCreated {
		t.Fatalf("second register: %d %v", res.StatusCode, out)
	}

	// non-admin cannot touch settings
	fjar, _ := cookiejar.New(nil)
	filler := &http.Client{Jar: fjar}
	e.do(t, filler, "POST", "/api/auth/register",
		map[string]string{"email": "filler@example.com", "password": "correct-horse-3"})
	if res, _ := e.do(t, filler, "PUT", "/api/admin/settings",
		map[string]any{setAllowRegister: "false"}); res.StatusCode != http.StatusForbidden {
		t.Fatalf("filler PUT settings: want 403, got %d", res.StatusCode)
	}

	// admin turns registration off
	if res, _ := e.do(t, admin, "PUT", "/api/admin/settings",
		map[string]any{setAllowRegister: "false"}); res.StatusCode != http.StatusOK {
		t.Fatalf("admin PUT settings: %d", res.StatusCode)
	}
	// cache TTL is 5s — invalidateCfg should make this immediate
	if res, out := e.do(t, e.anon, "POST", "/api/auth/register",
		map[string]string{"email": "u3@example.com", "password": "correct-horse-4"}); res.StatusCode != http.StatusForbidden {
		t.Fatalf("register after disable: want 403, got %d %v", res.StatusCode, out)
	}

	_, cfg := e.do(t, e.anon, "GET", "/api/config", nil)
	if cfg["allowRegister"] != false {
		t.Fatalf("/config allowRegister: %v", cfg["allowRegister"])
	}
	_, view := e.do(t, admin, "GET", "/api/admin/settings", nil)
	if src, _ := view["sources"].(map[string]any); src[setAllowRegister] != "override" {
		t.Fatalf("sources: %v", view["sources"])
	}

	// reset → registration works again
	e.do(t, admin, "PUT", "/api/admin/settings", map[string]any{setAllowRegister: nil})
	if res, _ := e.do(t, e.anon, "POST", "/api/auth/register",
		map[string]string{"email": "u4@example.com", "password": "correct-horse-5"}); res.StatusCode != http.StatusCreated {
		t.Fatalf("register after reset: %d", res.StatusCode)
	}
}

func TestRuntimeSettingsSecretMasked(t *testing.T) {
	e := newEnv(t)
	admin := e.authed(t)
	e.do(t, admin, "PUT", "/api/admin/settings", map[string]any{setTurnstileSecret: "super-secret"})
	_, view := e.do(t, admin, "GET", "/api/admin/settings", nil)
	raw, _ := view["settings"].(map[string]any)
	if raw[setTurnstileSecret] == "super-secret" {
		t.Fatal("turnstile secret leaked in settings response")
	}
	if raw[setTurnstileSecret] != "true" { // masked → "is set"
		t.Fatalf("masked secret: %v", raw[setTurnstileSecret])
	}
}

func TestSecurityHeadersDisabled(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	srv := httptest.NewServer(Router(Options{
		Store: st, Auth: auth.NewService(st), AllowRegister: true,
		DisableSecurityHeaders: true,
	}))
	t.Cleanup(srv.Close)

	res, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if got := res.Header.Get("Content-Security-Policy"); got != "" {
		t.Fatalf("CSP set despite DisableSecurityHeaders: %q", got)
	}
}
