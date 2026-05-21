## ADDED Requirements

### Requirement: Plugin SDK Single-Turn Claude Call

The Clack plugin SDK SHALL expose `sdk.askClaude(opts)` allowing a plugin to invoke a single-turn Claude API call (Anthropic SDK's `messages.create`) without instantiating its own Anthropic client or managing credentials. `opts` SHALL accept at minimum: `model: string` (a Claude model id, e.g. `"claude-haiku-4-5-20251001"`), `system?: string`, `messages: Array<{ role: "user" | "assistant"; content: string }>`, `max_tokens: number`, and OPTIONAL `temperature: number`. The SDK SHALL return the first content block of the response as `{ text: string; stopReason: string; usage: { inputTokens: number; outputTokens: number } }`. The credential SHALL be the same `ANTHROPIC_API_KEY` already used by the Claude Agent SDK; no new env var is introduced.

#### Scenario: Plugin invokes a single-turn Claude call

- **WHEN** a plugin calls `sdk.askClaude({ model: "claude-haiku-4-5-20251001", messages: [{ role: "user", content: "Hello" }], max_tokens: 100 })`
- **THEN** the SDK invokes the Anthropic SDK's `messages.create` with the supplied parameters using the existing `ANTHROPIC_API_KEY`
- **AND** returns the response's first content block as `{ text, stopReason, usage }`

#### Scenario: Missing credential surfaces a clear error

- **WHEN** `sdk.askClaude` is called and `ANTHROPIC_API_KEY` is not configured
- **THEN** the SDK throws an error indicating the API key is missing
- **AND** does not silently return an empty response

#### Scenario: Errors from the Anthropic API are propagated

- **WHEN** the underlying Anthropic SDK rejects (e.g. rate limit, invalid model)
- **THEN** the error is re-thrown unchanged
- **AND** the caller can inspect the error type and retry / fall back as appropriate
