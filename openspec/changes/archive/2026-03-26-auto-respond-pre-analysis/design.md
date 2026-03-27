## Context

Auto-respond rules currently use static matching: channel membership, user/bot filters, and keywords. Every matched message immediately triggers a full Claude response via `processMessage()`. There's no way to apply semantic filtering — e.g., "only respond if this looks like an actionable error, not a routine status update."

The codebase already uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) for all Claude interactions. The SDK supports lightweight single-turn calls with `tools: []` and `maxTurns: 1`, as demonstrated in `src/claude/testMcp.ts`.

## Goals / Non-Goals

**Goals:**
- Allow admins to define a semantic filter (natural language context) per auto-respond rule
- Evaluate the filter with a cheap, fast Claude Haiku call before committing to a full response
- Fail-closed: if pre-analysis fails or says no, skip the message silently
- Keep the UI simple: a single optional text field in the existing Edit Rule modal

**Non-Goals:**
- Per-rule model selection for pre-analysis (hardcoded to Haiku)
- Caching or deduplication of pre-analysis results
- Exposing pre-analysis decisions in Slack (invisible step)
- Structured output or confidence scores — binary yes/no only

## Decisions

### Use Agent SDK with minimal config (not direct Messages API)

The Agent SDK can be used in a lightweight mode: `tools: []`, no `mcpServers`, `maxTurns: 1`, `model: "haiku"`. This avoids adding `@anthropic-ai/sdk` as a new dependency. The overhead of the agent loop is negligible for a single-turn, tool-free call.

**Alternative considered**: Direct Anthropic Messages API (`@anthropic-ai/sdk`). Simpler API surface, but adds a new dependency and a second way to call Claude in the codebase.

### Pre-analysis prompt design

The system prompt instructs Haiku to evaluate whether Clack should respond, given the admin-provided context. The user prompt contains the message text. Haiku responds with a single word: "yes" or "no". We parse the first word of the response, defaulting to "no" on ambiguity.

### Config shape: optional string field (presence = enabled)

`preAnalysisContext?: string` on `AutoRespondRule`. If set and non-empty, pre-analysis is enabled. If absent or empty, the rule behaves as before. This avoids a nested object or separate toggle, keeping config and UI simple.

**Alternative considered**: `preAnalysis: { enabled: boolean; context: string }` with a toggle in the modal. More explicit, but Slack modals don't support conditional field visibility natively — would require `views.update` on checkbox change. Not worth the complexity for one field.

### Fail-closed on error

If the Haiku call throws (network error, timeout, rate limit), the message is skipped. This prevents runaway costs from retries and avoids responding to messages the admin wanted filtered. For alerting use cases where missing a response is critical, admins can simply not enable pre-analysis on that rule.

### Debug-level logging

Pre-analysis decisions are logged at debug level with: rule ID, channel, verdict, and reasoning excerpt. This avoids log bloat in production while remaining available for troubleshooting.

## Risks / Trade-offs

- **Added latency**: Haiku round-trip (~1-3s) before every response on rules with pre-analysis. → Acceptable for the use case; alerts don't need sub-second response times.
- **Added cost**: One Haiku call per matched message. → Haiku is cheap; far cheaper than a wasted full Opus/Sonnet response on irrelevant messages.
- **Fail-closed may miss messages**: Network issues cause silent skips. → Admins who need guaranteed responses should not enable pre-analysis. Debug logs surface these cases.
- **Prompt sensitivity**: The quality of filtering depends on how well the admin writes the context string. → No mitigation needed; admins already write `extraContext` for the same rules.
