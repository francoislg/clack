## Why

Clack's outbound responses are structurally flat. `submit_response` accepts `sections: [{title, body}]` which render as a single `*bold*`-prefixed mrkdwn section per entry — no dividers, no real header blocks, no context footers, no side-by-side fields, no images. The delivery path (`streamer.stop({ blocks })`, `chat.postMessage({ blocks })`) already accepts the full Slack Block Kit array; we just don't let Claude produce one.

The result: answers that cover multiple distinct topics, cite sources, or compare values end up as walls of bold-text-plus-paragraph. Trivia questions and scheduled prompts hit the same ceiling — their response shape references "Block Kit formatting" in instructions but there's no schema for Claude to produce it.

This change lets Claude author real Slack Block Kit blocks directly, governed by a centralized schema and validated at the tool boundary, with a single unified API used across every Claude-authored outbound surface (`submit_response`, `post_to` actions, plugin-scheduled prompts).

## What Changes

- **BREAKING:** `submit_response` drops `sections`. Replaces with `blocks: Block[]` — a curated subset of Slack Block Kit (`divider`, `header`, `section`, `context`, `image`). Action buttons remain driven by the structured `actions` field on `submit_response`; Clack renders them into Slack `actions` blocks and appends to the delivered message. Claude does not author Slack `actions` blocks directly in the `blocks` array. The `message` conversational-preamble field is retained as a plain string.
- **BREAKING:** `post_to` actions drop `content: string`. Replaces with `blocks: Block[]` for the shareable payload.
- Scheduled cron-job prompts (stored in `data/state/cron-jobs.json` as `jobs[].prompt` text) are untouched at the data-shape level — they remain free-text instructions for Claude to run at fire time. Delivery for scheduled runs already goes through `submit_response`, so scheduled outputs automatically inherit the new `blocks` capability with no schema change on the scheduled side.
- Add a centralized `src/slack/blocks.ts` block module: one Zod schema (`BlockSchema`), one validator (`validateBlocks`) with friendly error messages, one preparer (`prepareBlocks`) that converts internal markdown in text fields to Slack mrkdwn and enforces per-block limits. Every outbound surface uses this module — no caller rolls its own.
- Extend validation to cover every curated block type at the `submit_response` boundary (header ≤ 150 chars, context elements ≤ 75 chars each / ≤ 10 elements, fields 2–10 items / each ≤ 2000 chars, image requires `alt_text`, section text ≤ 3000 chars, total ≤ 50 blocks). Validation failures return tool-level errors so Claude can correct and retry.
- Replace `sections` guidance in Claude instruction files with block-type guidance. New `block-kit-formatting.md` instruction file teaches each block type with examples and explicit restraint guidance ("default to a single `section` — add structure only when content genuinely has structure").
- Persist `post_to` button payloads as `{ blocks }` in the action snapshot store; drop existing in-flight snapshots on deploy (ephemeral).
- Add a fully-automatic enhancement migration that iterates `data/state/cron-jobs.json`, scans each `jobs[].prompt` for format-specific language ("respond with a title and a summary", "use bullet points", "format as a table", etc.), and rewrites format references to use the new block vocabulary. Format-agnostic prompts are left untouched. Idempotent.
- Update the trivia plugin instruction files (`src/plugins/trivia/sendQuestionsInstructions.ts`, `createSchedulesInstructions.ts`, `processResponsesInstructions.ts`, `triviaCheckInstruction.ts`, and any other prompt-composition file under `src/plugins/trivia/`) to reference the new blocks API.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `clack-tool-response`: `submit_response` gains a `blocks` array (curated Slack Block Kit) and loses `sections`. `post_to` actions carry `blocks` instead of `content`. Centralized validation enforces Slack's per-block limits before delivery. The validator preserves optional Slack Block Kit fields (e.g., `block_id`, `confirm`) on allowed block types via Zod passthrough.
- `scheduled-messages`: cron-job prompt text that references response formatting is migrated to reference block vocabulary. No schema change on the cron-job shape — scheduled runs deliver via `submit_response` like every other path, so they inherit the new `blocks` capability automatically.

## Impact

- **Code:** `src/slack/blocks.ts` (new central module), `src/tools/presentation/submitResponse.ts` (schema rewrite, validation), `src/tools/types.ts` (Block types, action payload types), `src/slack/handlers/handlerResponse.ts` (deliver path unchanged — already passes `blocks` through), `src/plugins/trivia/*` (instruction file rewrites), `src/claude/promptBuilder.ts` (instructions reference new schema).
- **Instructions:** new `data/default_configuration/user/block-kit-formatting.md`, rewrites to `submit-response.md`, `slack-formatting.md` adjustments to cross-reference block types.
- **Data migration:** new enhancement migration in `src/migrations/` iterates `data/state/cron-jobs.json` and rewrites `jobs[].prompt` text where formatting references exist. Action snapshots on disk are dropped (ephemeral); worktree-sessions and Q&A sessions are unaffected.
- **Tests:** `src/slack/blocks.test.ts` (block schema, validation per type, passthrough of extras), `src/tools/presentation/submitResponse.test.ts` (blocks round-trip, validation errors, post_to with blocks), migration tests.
- **Breaking change coordination:** all outbound surfaces change in the same deploy. Any in-flight action snapshots (pre-deploy `post_to` buttons) stop working — documented in release notes.
