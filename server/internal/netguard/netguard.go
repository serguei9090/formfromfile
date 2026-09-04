// Package netguard blocks outbound requests to addresses a server should never
// call on a user's behalf — loopback, private ranges, link-local (incl. the
// cloud metadata endpoint), and non-HTTPS. Used by the async-validation proxy
// and by webhook delivery.
package netguard

import (
	"net"
	"net/url"
	"strings"
)

// SafeOutboundURL reports whether `raw` is an https URL whose host resolves
// only to public unicast addresses. DNS is resolved here; callers that keep a
// connection open should re-check on redirect / reconnect (rebinding).
func SafeOutboundURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return false
	}
	host := u.Hostname()
	if host == "" || strings.EqualFold(host, "localhost") {
		return false
	}
	// a literal IP skips DNS
	if ip := net.ParseIP(host); ip != nil {
		return publicUnicast(ip)
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return false
	}
	for _, ip := range ips {
		if !publicUnicast(ip) {
			return false
		}
	}
	return true
}

func publicUnicast(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return false
	}
	// ULA fc00::/7 is covered by IsPrivate on modern Go; 100.64/10 (CGNAT) isn't.
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
		return false
	}
	return true
}
