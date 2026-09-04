package metrics

import (
	"strings"
	"testing"
)

func TestRegistryText(t *testing.T) {
	r := &Registry{}
	c := r.counterVec("t_requests_total", "help", "code")
	c.Inc("200")
	c.Inc("200")
	c.Inc("500")

	h := r.histogram("t_seconds", "help", []float64{0.1, 1})
	h.Observe(0.05)
	h.Observe(2)

	r.Gauge("t_gauge", "help", func() float64 { return 42 })

	var b strings.Builder
	r.WriteText(&b)
	out := b.String()

	for _, want := range []string{
		`t_requests_total{code="200"} 2`,
		`t_requests_total{code="500"} 1`,
		`t_seconds_bucket{le="0.1"} 1`,
		`t_seconds_bucket{le="+Inf"} 2`,
		`t_seconds_count 2`,
		"t_seconds_sum 2.05",
		"# TYPE t_gauge gauge",
		"t_gauge 42",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

func TestCounterVecArityMismatchIgnored(t *testing.T) {
	r := &Registry{}
	c := r.counterVec("x_total", "h", "a", "b")
	c.Inc("only-one") // wrong arity → no-op, must not panic
	var b strings.Builder
	r.WriteText(&b)
	if strings.Contains(b.String(), "only-one") {
		t.Fatal("bad-arity sample was recorded")
	}
}
