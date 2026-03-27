## Why

Auto-respond rules currently use static matching (channel + user filter + keywords). This means every matched message triggers a full Claude response — even when the message isn't actually relevant. For example, a rule watching an alerts channel for a specific bot will respond to every message from that bot, even routine status updates. A lightweight pre-analysis step lets admins define semantic criteria (e.g., "only answer if this is an error requiring investigation") so Clack can skip irrelevant messages before committing to a full response.

## What Changes

- Add an optional `preAnalysisContext` field to auto-respond rules. When set, a lightweight Claude Haiku call evaluates the message against the provided context before proceeding with the full response.
- The pre-analysis is a single-turn, tool-free Agent SDK call (`tools: []`, `maxTurns: 1`, model `haiku`) that returns a yes/no decision.
- If pre-analysis returns "no" or fails (network error, timeout, etc.), the message is silently skipped (fail-closed).
- Pre-analysis decisions are logged at debug level.
- The Home Tab "Edit Rule" modal gets an optional "Pre-analysis context" text input field (always visible, presence = enabled).

## Capabilities

### New Capabilities
- `auto-respond-pre-analysis`: Lightweight Claude-based semantic filtering step for auto-respond rules, evaluated after static matching and before full response.

### Modified Capabilities
- `auto-respond`: Add optional `preAnalysisContext` field to rule schema and rule matching flow.

## Impact

- **Code**: `src/autoRespond.ts` (rule type + persistence), `src/slack/handlers/autoRespond.ts` (pre-analysis call before processMessage), `src/slack/homeTab.ts` (modal field), `src/slack/handlers/homeTab.ts` (form handling)
- **Dependencies**: No new dependencies — uses existing `@anthropic-ai/claude-agent-sdk`
- **Cost**: Each pre-analysis call costs a Haiku invocation. Only runs when `preAnalysisContext` is set on a rule.
- **Latency**: Adds Haiku round-trip (~1-3s) before full response for rules with pre-analysis enabled.
