package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/serguei9090/formfromfile/internal/ai"
	"github.com/serguei9090/formfromfile/internal/metrics"
)

// aiLimiter caps AI calls per user (they cost money).
var aiLimiter = &fixedWindow{hits: map[string][]int64{}, limit: 30, window: time.Hour}

func (h *handlers) aiStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"enabled": h.aiEnabled()})
}

// aiGate returns false (and writes the response) when AI is unavailable or the
// caller is over their hourly quota.
func (h *handlers) aiGate(w http.ResponseWriter, r *http.Request) bool {
	if !h.aiEnabled() {
		writeErr(w, http.StatusNotImplemented, "AI features are not configured")
		return false
	}
	if !aiLimiter.allow(currentUser(r).ID) {
		writeErr(w, http.StatusTooManyRequests, "AI request limit reached, try again later")
		return false
	}
	return true
}

func aiErr(w http.ResponseWriter, err error) {
	if errors.Is(err, ai.ErrDisabled) {
		writeErr(w, http.StatusNotImplemented, "AI features are not configured")
		return
	}
	writeErr(w, http.StatusBadGateway, "AI request failed: "+err.Error())
}

// aiDone records the outcome of one AI call for /metrics.
func aiDone(op string, err error) {
	result := "ok"
	if err != nil {
		result = "error"
	}
	metrics.AIRequests.Inc(op, result)
}

func (h *handlers) aiSuggestMeta(w http.ResponseWriter, r *http.Request) {
	if !h.aiGate(w, r) {
		return
	}
	var b struct {
		Schema string `json:"schema"`
		Values string `json:"values"`
	}
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	meta, err := h.opts.AI.SuggestMeta(r.Context(), b.Schema, b.Values)
	aiDone("suggest_meta", err)
	if err != nil {
		aiErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meta": json.RawMessage(meta)})
}

func (h *handlers) aiExplainDiff(w http.ResponseWriter, r *http.Request) {
	if !h.aiGate(w, r) {
		return
	}
	var b struct{ Format, Before, After string }
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	text, err := h.opts.AI.ExplainDiff(r.Context(), b.Format, b.Before, b.After)
	aiDone("explain_diff", err)
	if err != nil {
		aiErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"text": text})
}

func (h *handlers) aiSchemaFromPrompt(w http.ResponseWriter, r *http.Request) {
	if !h.aiGate(w, r) {
		return
	}
	var b struct{ Description, Format string }
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	body, kind, err := h.opts.AI.SchemaFromPrompt(r.Context(), b.Description, b.Format)
	aiDone("schema_from_prompt", err)
	if err != nil {
		aiErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"body": body, "kind": kind})
}

func (h *handlers) aiFillAssist(w http.ResponseWriter, r *http.Request) {
	if !h.aiGate(w, r) {
		return
	}
	var b struct {
		Schema      string `json:"schema"`
		Meta        string `json:"meta"`
		Instruction string `json:"instruction"`
	}
	if err := decode(w, r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	values, err := h.opts.AI.FillAssist(r.Context(), b.Schema, b.Meta, b.Instruction)
	aiDone("fill_assist", err)
	if err != nil {
		aiErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": json.RawMessage(values)})
}
