package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// verifyTurnstile checks a Cloudflare Turnstile token against the siteverify
// endpoint. Turnstile is free (unlimited) and does not require proxying the
// site through Cloudflare — only a site key + secret from the Turnstile
// dashboard. It's active only when FFF_TURNSTILE_SECRET is set.
func verifyTurnstile(ctx context.Context, secret, token, remoteIP string) bool {
	if token == "" {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	form := url.Values{"secret": {secret}, "response": {token}}
	if host, _, ok := strings.Cut(remoteIP, ":"); ok {
		form.Set("remoteip", host)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		strings.NewReader(form.Encode()))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var out struct {
		Success bool `json:"success"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out.Success
}
