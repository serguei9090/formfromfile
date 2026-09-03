// Package ai wraps the Anthropic API for FormFromFile's optional AI-assist
// features. Every entry point is a single Messages call that asks for JSON and
// parses it; there is no tool use and no code execution. The service is a
// no-op (returns ErrDisabled) unless FFF_ANTHROPIC_API_KEY is set.
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// ErrDisabled is returned by every method when no API key is configured.
var ErrDisabled = errors.New("ai features are not configured")

// Service is the interface the HTTP layer depends on (a fake stands in for it
// in tests).
type Service interface {
	Enabled() bool
	SuggestMeta(ctx context.Context, schemaJSON, sampleValuesJSON string) (json.RawMessage, error)
	ExplainDiff(ctx context.Context, format, before, after string) (string, error)
	SchemaFromPrompt(ctx context.Context, description, format string) (body, kind string, err error)
	FillAssist(ctx context.Context, schemaJSON, metaJSON, instruction string) (json.RawMessage, error)
}

type client struct {
	api   anthropic.Client
	model anthropic.Model
	on    bool
}

// New reads FFF_ANTHROPIC_API_KEY / FFF_AI_MODEL. A disabled service is still
// safe to call — every method returns ErrDisabled.
func New() Service {
	key := os.Getenv("FFF_ANTHROPIC_API_KEY")
	if key == "" {
		return &client{}
	}
	model := anthropic.Model(os.Getenv("FFF_AI_MODEL"))
	if model == "" {
		model = anthropic.ModelClaudeSonnet5
	}
	return &client{
		api:   anthropic.NewClient(option.WithAPIKey(key)),
		model: model,
		on:    true,
	}
}

func (c *client) Enabled() bool { return c.on }

// ask sends one user message and returns the assistant's text.
func (c *client) ask(ctx context.Context, system, user string, maxTokens int64) (string, error) {
	if !c.on {
		return "", ErrDisabled
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	msg, err := c.api.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     c.model,
		MaxTokens: maxTokens,
		System:    []anthropic.TextBlockParam{{Text: system}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(user)),
		},
	})
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, block := range msg.Content {
		if block.Type == "text" {
			b.WriteString(block.Text)
		}
	}
	return b.String(), nil
}

// jsonBlock pulls the first balanced {...} out of a model reply.
func jsonBlock(s string) (json.RawMessage, error) {
	start := strings.IndexByte(s, '{')
	if start < 0 {
		return nil, fmt.Errorf("no JSON object in reply")
	}
	depth := 0
	for i := start; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				raw := json.RawMessage(s[start : i+1])
				if !json.Valid(raw) {
					return nil, fmt.Errorf("invalid JSON in reply")
				}
				return raw, nil
			}
		}
	}
	return nil, fmt.Errorf("unterminated JSON in reply")
}

const metaSystem = `You help configure a form builder. Given a config file's detected schema (a
tree of fields with types) and a sample of its values, propose author metadata.
Reply with ONLY a JSON object mapping dotted field paths to
{ "label"?: string, "help"?: string, "preset"?: one of
["ipv4","ipv4-or-hostname","hostname","port","email","toolname","slug","integer","decimal","nonempty"],
"required"?: bool, "editable"?: bool (set false for secrets/passwords/keys) }.
Only include paths that need a change. No prose.`

func (c *client) SuggestMeta(ctx context.Context, schemaJSON, sampleValuesJSON string) (json.RawMessage, error) {
	out, err := c.ask(ctx, metaSystem,
		"Schema:\n"+schemaJSON+"\n\nSample values:\n"+sampleValuesJSON, 4096)
	if err != nil {
		return nil, err
	}
	return jsonBlock(out)
}

const diffSystem = `You review config-file changes. Given the original and edited values, write a
short plain-English summary (2-4 sentences). Flag anything risky (disabled
security, opened ports, credentials) with a leading "⚠ ". No JSON, no preamble.`

func (c *client) ExplainDiff(ctx context.Context, format, before, after string) (string, error) {
	return c.ask(ctx, diffSystem,
		fmt.Sprintf("Format: %s\n\n--- before ---\n%s\n\n--- after ---\n%s", format, before, after), 1024)
}

const schemaSystem = `You generate a starter config file from a description. Reply with ONLY a JSON
object { "kind": one of ["xml","yaml","json","toml","ini","dotenv"], "body":
the file contents as a string }. Keep it small and realistic. No prose.`

func (c *client) SchemaFromPrompt(ctx context.Context, description, format string) (string, string, error) {
	hint := ""
	if format != "" {
		hint = " Prefer format: " + format + "."
	}
	out, err := c.ask(ctx, schemaSystem, description+hint, 4096)
	if err != nil {
		return "", "", err
	}
	raw, err := jsonBlock(out)
	if err != nil {
		return "", "", err
	}
	var v struct{ Kind, Body string }
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", "", err
	}
	return v.Body, v.Kind, nil
}

const fillSystem = `You pre-fill a form from a plain-English instruction. Given the form's schema
and metadata and the user's instruction, reply with ONLY a JSON object of
values (nested to match the schema). Only include fields the instruction
implies. No prose.`

func (c *client) FillAssist(ctx context.Context, schemaJSON, metaJSON, instruction string) (json.RawMessage, error) {
	out, err := c.ask(ctx, fillSystem,
		"Schema:\n"+schemaJSON+"\n\nMeta:\n"+metaJSON+"\n\nInstruction:\n"+instruction, 4096)
	if err != nil {
		return nil, err
	}
	return jsonBlock(out)
}
