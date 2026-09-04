package netguard

import "testing"

func TestSafeOutboundURL(t *testing.T) {
	bad := []string{
		"http://example.com",             // not https
		"https://localhost/x",            // loopback name
		"https://127.0.0.1/x",            // loopback ip
		"https://10.0.0.5/x",             // private
		"https://192.168.1.1/x",          // private
		"https://169.254.169.254/latest", // link-local (cloud metadata)
		"https://100.64.0.1/x",           // CGNAT
		"https://[::1]/x",                // ipv6 loopback
		"not a url",
		"",
	}
	for _, u := range bad {
		if SafeOutboundURL(u) {
			t.Errorf("SafeOutboundURL(%q) = true, want false", u)
		}
	}

	// a well-known public host — resolves in CI
	if !SafeOutboundURL("https://cloudflare.com/") {
		t.Error("SafeOutboundURL(cloudflare.com) = false, want true")
	}
	// a public literal
	if !SafeOutboundURL("https://1.1.1.1/") {
		t.Error("SafeOutboundURL(1.1.1.1) = false, want true")
	}
}
