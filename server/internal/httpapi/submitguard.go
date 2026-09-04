package httpapi

import (
	"sync"
	"time"
)

// clock is overridable in tests.
var clock = time.Now

// slugCooldown enforces a minimum gap between accepted submissions to one
// public form. check() is a peek; record() commits, called only after the
// submission is stored.
type slugCooldown struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func (s *slugCooldown) check(slug string, cd time.Duration) (ok bool, retryAfter time.Duration) {
	if cd <= 0 {
		return true, 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.last[slug]; ok {
		if wait := cd - clock().Sub(t); wait > 0 {
			return false, wait
		}
	}
	return true, 0
}

func (s *slugCooldown) record(slug string) {
	s.mu.Lock()
	s.last[slug] = clock()
	s.mu.Unlock()
}

// dailyCeiling caps accepted public submissions process-wide per UTC day.
type dailyCeiling struct {
	mu  sync.Mutex
	day string
	n   int
}

func (d *dailyCeiling) today() string { return clock().UTC().Format("2006-01-02") }

func (d *dailyCeiling) check(max int) bool {
	if max <= 0 {
		return true
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.day != d.today() {
		return true // new day, counter about to reset on record()
	}
	return d.n < max
}

func (d *dailyCeiling) record() {
	d.mu.Lock()
	if t := d.today(); d.day != t {
		d.day, d.n = t, 0
	}
	d.n++
	d.mu.Unlock()
}

var (
	submitCooldown = &slugCooldown{last: map[string]time.Time{}}
	submitDaily    = &dailyCeiling{}
)
