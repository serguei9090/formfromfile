package httpapi

import (
	"net/http"
	"strings"
)

// requestIsHTTPS reports whether the original client request used TLS. Direct
// TLS shows on r.TLS; behind a proxy that terminates TLS we can only trust
// X-Forwarded-Proto when the operator has asserted the proxy overwrites it
// (Options.TrustProxy).
func requestIsHTTPS(r *http.Request, trustProxy bool) bool {
	if r.TLS != nil {
		return true
	}
	if trustProxy && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		return true
	}
	return false
}

// securityHeaders sets a conservative baseline on every response: no MIME
// sniffing, no framing, a tight referrer policy, a locked-down Permissions
// policy, and a Content-Security-Policy tuned for the self-hosted SPA. HSTS is
// added only when the request arrived over TLS. Disabled by
// Options.DisableSecurityHeaders (FFF_SECURITY_HEADERS=off). The CSP is
// recomputed per request so a Turnstile key added from the admin settings
// panel takes effect without a restart.
func (h *handlers) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hdr := w.Header()
		hdr.Set("X-Content-Type-Options", "nosniff")
		hdr.Set("X-Frame-Options", "DENY")
		hdr.Set("Referrer-Policy", "same-origin")
		hdr.Set("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(), usb=()")

		fbAuthDomain := ""
		coop := "same-origin"
		if h.opts.Firebase != nil {
			fbAuthDomain = h.opts.FirebaseAuthDomain
			// signInWithPopup relays the result back via window.opener from a
			// cross-origin popup; strict same-origin COOP severs that link and
			// silently breaks the flow. same-origin-allow-popups is Firebase's
			// own documented fix — still isolates from unrelated cross-origin
			// openers, just not ones this page itself opened.
			coop = "same-origin-allow-popups"
		}
		hdr.Set("Content-Security-Policy", buildCSP(h.cfg().TurnstileSiteKey != "", fbAuthDomain))
		hdr.Set("Cross-Origin-Opener-Policy", coop)
		if requestIsHTTPS(r, h.opts.TrustProxy) {
			hdr.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

// buildCSP assembles the policy. The SPA is same-origin with hashed assets, so
// default-src 'self' covers scripts/styles/fetch. 'unsafe-inline' stays on
// style-src because React writes inline style attributes. When Turnstile is
// configured, its widget host is allowed for scripts, frames and XHR. When
// Firebase sign-in is configured, Google's identity APIs are allowed for XHR
// (the SDK calls identitytoolkit/securetoken directly) and the project's
// authDomain is allowed to frame (the popup handshake's OAuth-helper page).
func buildCSP(turnstile bool, firebaseAuthDomain string) string {
	script := "'self'"
	var frames []string
	connect := []string{"'self'"}

	if turnstile {
		const ts = "https://challenges.cloudflare.com"
		script += " " + ts
		frames = append(frames, ts)
		connect = append(connect, ts)
	}
	if firebaseAuthDomain != "" {
		frames = append(frames, "https://"+firebaseAuthDomain)
		connect = append(connect, "https://*.googleapis.com", "https://securetoken.google.com")
	}
	frame := "'none'"
	if len(frames) > 0 {
		frame = strings.Join(frames, " ")
	}

	return strings.Join([]string{
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"img-src 'self' data:",
		"font-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"script-src " + script,
		"connect-src " + strings.Join(connect, " "),
		"frame-src " + frame,
		"form-action 'self'",
	}, "; ")
}
