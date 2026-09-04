package httpapi

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
)

// getConfig is the public bootstrap endpoint the SPA reads on load. It reflects
// the effective (settings-aware) config so a toggle takes effect with no
// restart.
func (h *handlers) getConfig(w http.ResponseWriter, _ *http.Request) {
	c := h.cfg()
	writeJSON(w, http.StatusOK, map[string]any{
		"allowRegister":    c.AllowRegister,
		"turnstileSiteKey": c.TurnstileSiteKey,
	})
}

// settingsView is the admin payload: the raw overrides, the resolved values,
// and where each resolved value comes from.
func (h *handlers) getSettings(w http.ResponseWriter, _ *http.Request) {
	stored, err := h.opts.Store.AllSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "read settings")
		return
	}
	c := h.cfg()

	// mask secrets — report only whether one is set
	raw := map[string]any{}
	for k, v := range stored {
		if secretSettingKeys[k] {
			raw[k] = boolStr(v != "")
			continue
		}
		raw[k] = v
	}

	effective := map[string]any{
		setAllowRegister:          c.AllowRegister,
		setTurnstileSiteKey:       c.TurnstileSiteKey,
		setTurnstileSecret:        c.TurnstileSecret != "", // masked
		setWebhookAllowPrivate:    c.WebhookAllowPrivate,
		setAIBeta:                 c.AIBeta,
		setSubmissionCapDefault:   c.SubmissionCapDefault,
		setSubmissionCooldownSecs: c.SubmissionCooldown,
		setSubmissionGlobalDaily:  c.SubmissionGlobalMax,
		setRetentionDaysDefault:   c.RetentionDaysDefault,
	}

	// "override" = a settings row is in force; "base" = the value Router() was
	// started with (its env var or built-in default).
	sources := map[string]string{}
	for _, k := range settingKeys {
		if hasKey(stored, k) {
			sources[k] = "override"
		} else {
			sources[k] = "base"
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"settings":  raw,
		"effective": effective,
		"sources":   sources,
		"aiHasKey":  h.opts.AI != nil && h.opts.AI.HasKey(),
	})
}

// putSettings upserts (value given) or clears (value null / "") settings.
func (h *handlers) putSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]*string
	if err := decode(w, r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	uid := currentUser(r).ID
	changed := []string{}

	for k, vp := range body {
		if !slices.Contains(settingKeys, k) {
			writeErr(w, http.StatusBadRequest, "unknown setting: "+k)
			return
		}
		if vp == nil || strings.TrimSpace(*vp) == "" {
			if err := h.opts.Store.DeleteSetting(k); err != nil {
				writeErr(w, http.StatusInternalServerError, "write setting")
				return
			}
			changed = append(changed, k+"=(reset)")
			continue
		}
		v := strings.TrimSpace(*vp)
		if boolSettingKeys[k] {
			v = boolStr(truthySetting(v))
		}
		if intSettingKeys[k] {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 {
				writeErr(w, http.StatusBadRequest, k+" must be a non-negative integer")
				return
			}
			v = strconv.Itoa(n)
		}
		if err := h.opts.Store.SetSetting(k, v, uid); err != nil {
			writeErr(w, http.StatusInternalServerError, "write setting")
			return
		}
		if secretSettingKeys[k] {
			changed = append(changed, k+"=(set)")
		} else {
			changed = append(changed, k+"="+v)
		}
	}

	h.invalidateCfg()
	h.audit(r, "settings.update", "", strings.Join(changed, ", "))
	h.getSettings(w, r)
}

func hasKey(m map[string]string, k string) bool { _, ok := m[k]; return ok }

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
