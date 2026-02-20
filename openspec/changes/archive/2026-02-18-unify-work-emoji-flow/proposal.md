## Why

The `:clack-work:` emoji flow uses a legacy code path that predates the MCP tool migration. It calls Claude with no tools and an XML-based system prompt, parses the response with regex, and bypasses the entire structured tool pipeline. This path is now broken (`Failed to parse plan response: no plan found`) because the Agent SDK's result event overwrites the streaming text that contained the XML tags. Meanwhile, the `:clack:` flow already has everything needed for change requests via `propose_change` + `auto: true`.

## What Changes

- Route `:clack-work:` reactions through `processMessage()` (same as `:clack:`) instead of the separate `handleChangeReaction()` path
- Add a `workMode` signal to `processMessage` that tells Claude "this is a work request — propose a change and auto-execute it"
- Pass `workMode` through to `askClaude` so it can inject a work-mode hint into the prompt
- For non-dev users reacting with `:clack-work:`, fall back to the standard `:clack:` Q&A flow (no error, just treat it as a regular query)
- Remove the dead code: `handleChangeReaction()`, `generateChangePlan()`, `PLAN_GENERATION_PROMPT`, and the XML parsing logic

## Capabilities

### New Capabilities

_(none — this unifies existing capabilities rather than introducing new ones)_

### Modified Capabilities

- `slack-reaction-trigger`: Add work-mode reaction routing — `:clack-work:` goes through `processMessage` with a `workMode` flag, falls back to standard Q&A for non-devs
- `changes-workflow`: Update "Explicit change request via reaction" scenario to reflect the unified flow (no separate plan generation step, Claude uses `propose_change` with `auto: true`)

## Impact

- `src/slack/handlers/newQuery.ts`: Replace `handleChangeReaction` branch with `processMessage({ workMode: true })` call, add role fallback logic
- `src/slack/handlers/core.ts`: Accept and propagate `workMode` param, pass to `askClaude`
- `src/claude.ts`: Accept `workMode` option, inject hint into the user prompt or system context
- `src/changes/execution.ts`: Remove `generateChangePlan()`, `PLAN_GENERATION_PROMPT`, and XML parsing code (dead code after this change)
