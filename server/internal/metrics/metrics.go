// Package metrics is a tiny hand-rolled Prometheus text exposition. It covers
// what FormFromFile needs — a few labelled counters, one request-duration
// histogram, and some scrape-time gauges — without pulling the full
// client_golang dependency tree. Everything is safe for concurrent use.
package metrics

import (
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

// DefaultBuckets are the histogram upper bounds (seconds).
var DefaultBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

// counterVec is a set of counters keyed by an ordered label-value tuple.
type counterVec struct {
	name, help string
	labels     []string
	mu         sync.Mutex
	vals       map[string]*uint64
}

func newCounterVec(name, help string, labels ...string) *counterVec {
	return &counterVec{name: name, help: help, labels: labels, vals: map[string]*uint64{}}
}

func (c *counterVec) Inc(labelValues ...string) { c.Add(1, labelValues...) }

func (c *counterVec) Add(n uint64, labelValues ...string) {
	if len(labelValues) != len(c.labels) {
		return
	}
	key := strings.Join(labelValues, "\x00")
	c.mu.Lock()
	p := c.vals[key]
	if p == nil {
		var v uint64
		p = &v
		c.vals[key] = p
	}
	c.mu.Unlock()
	atomic.AddUint64(p, n)
}

func (c *counterVec) write(w io.Writer) {
	fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n", c.name, c.help, c.name)
	c.mu.Lock()
	keys := make([]string, 0, len(c.vals))
	for k := range c.vals {
		keys = append(keys, k)
	}
	c.mu.Unlock()
	sort.Strings(keys)
	for _, k := range keys {
		parts := strings.Split(k, "\x00")
		lbl := make([]string, len(c.labels))
		for i, name := range c.labels {
			lbl[i] = fmt.Sprintf("%s=%q", name, parts[i])
		}
		c.mu.Lock()
		v := atomic.LoadUint64(c.vals[k])
		c.mu.Unlock()
		fmt.Fprintf(w, "%s{%s} %d\n", c.name, strings.Join(lbl, ","), v)
	}
}

// histogram is a single (unlabelled) latency histogram.
type histogram struct {
	name, help string
	buckets    []float64
	counts     []uint64
	sum        atomic.Uint64 // float64 bits
	total      atomic.Uint64
}

func newHistogram(name, help string, buckets []float64) *histogram {
	return &histogram{name: name, help: help, buckets: buckets, counts: make([]uint64, len(buckets))}
}

func (h *histogram) Observe(v float64) {
	h.total.Add(1)
	for {
		old := h.sum.Load()
		nw := math.Float64frombits(old) + v
		if h.sum.CompareAndSwap(old, math.Float64bits(nw)) {
			break
		}
	}
	for i, ub := range h.buckets {
		if v <= ub {
			atomic.AddUint64(&h.counts[i], 1)
		}
	}
}

func (h *histogram) write(w io.Writer) {
	fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s histogram\n", h.name, h.help, h.name)
	var cum uint64
	for i, ub := range h.buckets {
		cum += atomic.LoadUint64(&h.counts[i])
		fmt.Fprintf(w, "%s_bucket{le=%q} %d\n", h.name, strconv.FormatFloat(ub, 'g', -1, 64), cum)
	}
	total := h.total.Load()
	fmt.Fprintf(w, "%s_bucket{le=\"+Inf\"} %d\n", h.name, total)
	fmt.Fprintf(w, "%s_sum %s\n", h.name, strconv.FormatFloat(math.Float64frombits(h.sum.Load()), 'g', -1, 64))
	fmt.Fprintf(w, "%s_count %d\n", h.name, total)
}

// gaugeFunc is a value sampled at scrape time.
type gaugeFunc struct {
	name, help string
	fn         func() float64
}

// Registry holds the process's metrics.
type Registry struct {
	counters []*counterVec
	hists    []*histogram
	gauges   []gaugeFunc
}

// The one registry the app uses.
var (
	R = &Registry{}

	HTTPRequests = R.counterVec("fff_http_requests_total", "HTTP requests by method, route and status.", "method", "route", "status")
	HTTPDuration = R.histogram("fff_http_request_duration_seconds", "HTTP request latency in seconds.", DefaultBuckets)
	Webhooks     = R.counterVec("fff_webhook_deliveries_total", "Webhook delivery attempts by result (ok|fail).", "result")
	AIRequests   = R.counterVec("fff_ai_requests_total", "AI assist calls by operation and result (ok|error).", "op", "result")
)

func (r *Registry) counterVec(name, help string, labels ...string) *counterVec {
	c := newCounterVec(name, help, labels...)
	r.counters = append(r.counters, c)
	return c
}

func (r *Registry) histogram(name, help string, buckets []float64) *histogram {
	h := newHistogram(name, help, buckets)
	r.hists = append(r.hists, h)
	return h
}

// Gauge registers a scrape-time sampled value. Call during startup.
func (r *Registry) Gauge(name, help string, fn func() float64) {
	r.gauges = append(r.gauges, gaugeFunc{name: name, help: help, fn: fn})
}

// WriteText emits the Prometheus text exposition format.
func (r *Registry) WriteText(w io.Writer) {
	for _, c := range r.counters {
		c.write(w)
	}
	for _, h := range r.hists {
		h.write(w)
	}
	for _, g := range r.gauges {
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s gauge\n%s %s\n",
			g.name, g.help, g.name, g.name, strconv.FormatFloat(g.fn(), 'g', -1, 64))
	}
}
