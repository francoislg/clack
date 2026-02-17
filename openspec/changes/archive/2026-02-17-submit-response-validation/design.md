## Context

The `submit_response` MCP tool captures a structured payload (sections + actions) in memory. After Claude's query completes, the handler renders this payload into Slack Block Kit blocks and posts them. If Slack rejects the blocks (`invalid_blocks`), the message is lost — Claude has already finished and can't fix the issue.

The block rendering pipeline: `submit_response` captures payload → `getStructuredResponseBlocks()` renders Slack blocks (converts markdown to mrkdwn, splits long sections) → handler posts via Slack API.

## Goals / Non-Goals

**Goals:**
- Catch most block constraint violations in `submit_response` before Claude finishes, enabling in-query retry
- Catch remaining `invalid_blocks` errors at the handler level and re-invoke Claude to fix them
- Never silently lose a message — always deliver something to the user

**Non-Goals:**
- Perfectly replicating Slack's internal block validation (we validate known constraints only)
- Changing how `submit_response` captures payloads or how `askClaude()` returns results
- Adding a Slack block validation API (doesn't exist)

## Decisions

### D1: Validate rendered blocks, not raw input

**Decision**: Run the full rendering pipeline (`getStructuredResponseBlocks`) inside `submit_response` and validate the rendered output against Slack constraints.

**Rationale**: Validating raw sections/actions wouldn't catch issues introduced by markdown-to-mrkdwn conversion or text splitting. By rendering first, we validate what Slack will actually see.

**Alternative considered**: Validate raw text lengths with estimated overhead. Rejected because conversion can change lengths unpredictably (e.g., markdown links → mrkdwn links have different lengths).

### D2: Import block rendering into the tool layer

**Decision**: Import `getStructuredResponseBlocks` (and the validation function) from `src/slack/blocks.ts` into `src/tools/presentation/submitResponse.ts`.

**Rationale**: This creates a dependency from tools → slack, which currently doesn't exist. However, the alternative (duplicating rendering logic) is worse. The rendering must be identical to what the handler uses, otherwise validation is meaningless.

**Alternative considered**: Extract shared rendering into a neutral module (e.g., `src/rendering/`). Acceptable but over-engineered for one import — can refactor later if more cross-module rendering needs emerge.

### D3: Handler retry via refinement injection

**Decision**: When the handler catches `invalid_blocks`, inject the Slack error as a session refinement and call `askClaude()` again. Limit to 1 retry.

**Rationale**: The refinement mechanism already exists (`addRefinement`) and is how follow-up context is injected. Claude will see the error in conversation history and can fix its `submit_response` call. One retry is sufficient — if local validation passed but Slack still rejected, one fix attempt is reasonable.

**Alternative considered**: Re-run just the `submit_response` tool call without a full Claude query. Not possible — we don't control individual tool calls from outside the Agent SDK.

### D4: Plain text fallback after exhausted retries

**Decision**: If the retry also fails with `invalid_blocks`, post the response as plain text (the `answer` field from `ClaudeResponse`) with no blocks.

**Rationale**: Delivering a plain text answer is always better than losing the message entirely. The `answer` field contains the text content of sections concatenated, which is readable even without formatting.

### D5: Validation constraints to check

**Decision**: Validate these known Slack Block Kit limits:
- Section text: ≤ 3000 characters per section block
- Button label (plain_text): ≤ 75 characters
- Total blocks per message: ≤ 50
- Actions per actions block: ≤ 25 elements (already enforced by chunking at 5)

**Rationale**: These are the documented Slack limits most likely to be hit by Claude-generated content. Section text length is the primary failure mode observed in production.

## Risks / Trade-offs

- **[Incomplete validation]** → Local validation can't catch every reason Slack rejects blocks. Mitigated by the handler retry layer as a safety net.
- **[Rendering cost in tool]** → Running `getStructuredResponseBlocks` in `submit_response` duplicates rendering (once for validation, once for posting). Mitigated by caching: store the rendered blocks alongside the payload in `ResponseCapture` so the handler can reuse them.
- **[Retry latency]** → Handler retry means a full second `askClaude()` call (~10-30s). Acceptable because it's rare (only when local validation misses something) and better than message loss.
- **[tools → slack dependency]** → Introducing a cross-layer import. Low risk given this is a single-app codebase, not a multi-package monorepo.
