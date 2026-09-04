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
// Options.DisableSecurityHeaders (FFF_SECURITY_HEADERS=off).
func securityHeaders(opts Options) func(http.Handler) http.Handler {
	csp := buildCSP(opts.TurnstileSiteKey != "")
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "same-origin")
			h.Set("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(), usb=()")
			h.Set("Content-Security-Policy", csp)
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			if requestIsHTTPS(r, opts.TrustProxy) {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// buildCSP assembles the policy. The SPA is same-origin with hashed assets, so
// default-src 'self' covers scripts/styles/fetch. 'unsafe-inline' stays on
// style-src because React writes inline style attributes. When Turnstile is
// configured, its widget host is allowed for scripts, frames and XHR.
func buildCSP(turnstile bool) string {
	script := "'self'"
	frame := "'none'"
	connect := "'self'"
	if turnstile {
		const ts = "https://challenges.cloudflare.com"
		script = "'self' " + ts
		frame = ts
		connect = "'self' " + ts
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
		"connect-src " + connect,
		"frame-src " + frame,
		"form-action 'self'",
	}, "; ")
}
