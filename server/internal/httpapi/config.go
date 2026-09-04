package httpapi

import (
	"strconv"
	"strings"
	"time"
)

// Runtime setting keys. A row in the `settings` table under one of these
// overrides the matching Options field / env var. Missing row → the value
// passed to Router() (which itself came from an env var or a built-in default).
const (
	setAllowRegister        = "allow_register"
	setTurnstileSiteKey     = "turnstile_site_key"
	setTurnstileSecret      = "turnstile_secret"
	setWebhookAllowPrivate  = "webhook_allow_private"
	setAIBeta               = "ai_beta"
	setSubmissionCapDefault = "submission_cap_default"
)

// settingKeys is the allow-list the PUT handler validates against.
var settingKeys = []string{
	setAllowRegister, setTurnstileSiteKey, setTurnstileSecret,
	setWebhookAllowPrivate, setAIBeta, setSubmissionCapDefault,
}

// boolSettingKeys / intSettingKeys drive type validation on write.
var boolSettingKeys = map[string]bool{
	setAllowRegister: true, setWebhookAllowPrivate: true, setAIBeta: true,
}
var intSettingKeys = map[string]bool{setSubmissionCapDefault: true}

// secretSettingKeys never leave the server in a readable form.
var secretSettingKeys = map[string]bool{setTurnstileSecret: true}

// effConfig is the resolved configuration for one moment: DB override › env ›
// default, already merged.
type effConfig struct {
	AllowRegister        bool
	TurnstileSiteKey     string
	TurnstileSecret      string
	WebhookAllowPrivate  bool
	AIBeta               bool
	SubmissionCapDefault int
}

// cfg returns the effective config, recomputed at most every 5s (or on the
// next call after invalidateCfg). It also keeps the AI service's enabled flag
// in sync with the resolved value.
func (h *handlers) cfg() effConfig {
	h.cfgMu.Lock()
	defer h.cfgMu.Unlock()
	if !h.cfgAt.IsZero() && time.Since(h.cfgAt) < 5*time.Second {
		return h.cfgVal
	}

	c := effConfig{
		AllowRegister:       h.opts.AllowRegister,
		TurnstileSiteKey:    h.opts.TurnstileSiteKey,
		TurnstileSecret:     h.opts.TurnstileSecret,
		WebhookAllowPrivate: h.opts.WebhookAllowPrivate,
		AIBeta:              h.opts.AI != nil && h.opts.AI.Enabled(),
	}
	if h.opts.Store != nil {
		if m, err := h.opts.Store.AllSettings(); err == nil {
			applySettings(&c, m)
		}
	}
	if h.opts.AI != nil {
		h.opts.AI.SetEnabled(c.AIBeta)
		c.AIBeta = h.opts.AI.Enabled() // clamp: no key → still off
	}

	h.cfgVal, h.cfgAt = c, time.Now()
	return c
}

// invalidateCfg forces the next cfg() call to recompute (call after a write).
func (h *handlers) invalidateCfg() {
	h.cfgMu.Lock()
	h.cfgAt = time.Time{}
	h.cfgMu.Unlock()
}

func applySettings(c *effConfig, m map[string]string) {
	if v, ok := m[setAllowRegister]; ok {
		c.AllowRegister = truthySetting(v)
	}
	if v, ok := m[setTurnstileSiteKey]; ok {
		c.TurnstileSiteKey = v
	}
	if v, ok := m[setTurnstileSecret]; ok {
		c.TurnstileSecret = v
	}
	if v, ok := m[setWebhookAllowPrivate]; ok {
		c.WebhookAllowPrivate = truthySetting(v)
	}
	if v, ok := m[setAIBeta]; ok {
		c.AIBeta = truthySetting(v)
	}
	if v, ok := m[setSubmissionCapDefault]; ok {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			c.SubmissionCapDefault = n
		}
	}
}

func truthySetting(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// aiEnabled resolves the settings layer, then reports whether AI is on.
func (h *handlers) aiEnabled() bool {
	h.cfg()
	return h.opts.AI != nil && h.opts.AI.Enabled()
}
