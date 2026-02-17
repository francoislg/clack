## Why

The `submit_response` MCP tool currently captures the structured payload in memory and returns success without any validation. When the handler later renders Slack blocks from this payload, the Slack API can reject them with `invalid_blocks` (e.g., section text exceeding 3000 chars after markdown conversion). At that point Claude has already finished — the response is silently lost with no recovery path.

## What Changes

- **Local block validation in `submit_response`**: Before capturing the payload, render the Slack blocks and validate them against known Slack Block Kit constraints (section text length, button label length, block count). Return actionable errors to Claude so it can fix and retry within the same query.
- **Handler-level retry on `invalid_blocks`**: Wrap the Slack posting call in a try/catch. If blocks are rejected despite passing local validation, inject the error as a refinement and re-invoke `askClaude()` (with a retry limit) so Claude can fix and resubmit.
- **Graceful fallback**: If retries are exhausted, fall back to posting the plain text answer instead of losing the message entirely.

## Capabilities

### New Capabilities

_(none — this extends existing capabilities)_

### Modified Capabilities

- `clack-tool-response`: Add validation requirements to the `submit_response` tool — local block constraint checking with error feedback to Claude.
- `error-reporting`: Add block validation retry behavior — handler catches `invalid_blocks`, re-invokes Claude with error context, falls back to plain text on exhaustion.

## Impact

- `src/tools/presentation/submitResponse.ts` — add block rendering + validation before capture
- `src/slack/blocks.ts` — may need to extract validation logic or expose rendering for the tool
- `src/slack/handlers/core.ts` — try/catch around block posting, retry loop with askClaude
- `src/slack/handlers/handlerResponse.ts` — same try/catch pattern for button handler responses
- `src/claude.ts` — no changes expected (validation is contained in the tool layer)
