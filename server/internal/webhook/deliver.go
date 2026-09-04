// Package webhook fires template webhooks on submission events.
package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/serguei9090/formfromfile/internal/netguard"
)

var client = &http.Client{Timeout: 10 * time.Second}

// Target is one configured endpoint.
type Target struct {
	ID     string
	URL    string
	Secret string
	Events []string
}

// Payload is the JSON body POSTed to each endpoint.
type Payload struct {
	Event      string `json:"event"`
	TemplateID string `json:"templateId"`
	Submission any    `json:"submission"`
	Output     string `json:"output"`
}

// URLAllowed reports whether a webhook target URL may be configured. Public
// deployments keep `allowPrivate` false (block loopback / RFC1918 / metadata);
// an internal deployment can set FFF_WEBHOOK_ALLOW_PRIVATE=true to POST to a
// LAN CI server over plain http.
func URLAllowed(raw string, allowPrivate bool) bool {
	if allowPrivate {
		return raw != ""
	}
	return netguard.SafeOutboundURL(raw)
}

// Fire delivers `event` to every target that subscribes to it, in a background
// goroutine. `log(webhookID, code, attempts, errMsg)` records each result.
// Targets that fail the guard at delivery time (DNS rebinding) are skipped.
func Fire(targets []Target, templateID, event string, submission any, output string,
	allowPrivate bool, log func(webhookID string, code, attempts int, errMsg string)) {
	go func() {
		body, _ := json.Marshal(Payload{
			Event: event, TemplateID: templateID, Submission: submission, Output: output,
		})
		for _, t := range targets {
			if !subscribed(t.Events, event) {
				continue
			}
			if !URLAllowed(t.URL, allowPrivate) {
				log(t.ID, 0, 0, "blocked: target resolves to a private/loopback address")
				continue
			}
			code, attempts, errMsg := deliver(t, body)
			log(t.ID, code, attempts, errMsg)
		}
	}()
}

func subscribed(events []string, event string) bool {
	for _, e := range events {
		if e == event {
			return true
		}
	}
	return false
}

func deliver(t Target, body []byte) (code, attempts int, errMsg string) {
	mac := hmac.New(sha256.New, []byte(t.Secret))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))

	for attempts = 1; attempts <= 3; attempts++ {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, t.URL, bytes.NewReader(body))
		if err != nil {
			return 0, attempts, err.Error()
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-FFF-Signature", "sha256="+sig)
		res, err := client.Do(req)
		if err != nil {
			errMsg = err.Error()
		} else {
			_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 2048))
			_ = res.Body.Close()
			code = res.StatusCode
			if code < 300 {
				return code, attempts, ""
			}
			errMsg = res.Status
		}
		time.Sleep(time.Duration(attempts) * time.Second)
	}
	return code, attempts - 1, errMsg
}
