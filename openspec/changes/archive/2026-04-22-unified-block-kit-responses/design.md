## Context

Today's `submit_response` accepts `sections: [{title, body}]` and renders each as a single mrkdwn section block with `*title*\n` prepended. The delivery mechanism beneath it — `streamer.stop({ markdownText, blocks })` and the `chat.postMessage({ blocks })` fallback — already accepts the full Slack Block Kit array type (`(KnownBlock | Block)[]`). The ceiling on rich output is entirely at the tool-schema layer, not at the delivery layer.

The same ceiling applies to `post_to` actions (carrying `content: string`). Scheduled cron-job runs do not have a separate payload shape — they store a `prompt: string` in `data/state/cron-jobs.json` that becomes the input to a Claude run, and that Claude run delivers via `submit_response` like every other trigger. So lifting the submit_response ceiling automatically lifts it for scheduled runs too.

This change lifts the ceiling by letting Claude produce real Slack Block Kit blocks directly, centralizing the schema, validation, and markdown-conversion responsibilities in one module consumed by every Claude-authored outbound surface (`submit_response` and `post_to`).

## Goals / Non-Goals

**Goals:**
- Let Claude produce real Slack Block Kit output using `divider`, `header`, `section`, `context`, `image`, `actions` blocks.
- Validate every block at the `submit_response` boundary with friendly, actionable error messages so Claude can correct and retry before a Slack post attempt.
- Unify the response shape across every Claude-authored outbound surface (`submit_response` and `post_to`) through a single central module — no caller rolls its own block construction or validation. Scheduled cron-job runs inherit the new capability via `submit_response` (they produce responses through it like every other trigger) with no scheduled-side schema change.
- Migrate in-flight cron-job prompt text that references response formatting, automatically, in the background.

**Non-Goals:**
- Supporting non-message Block Kit types (`input`, `file`, `rich_text`, `video`, modal views). These require different API surfaces (`views.open`, etc.) or carry too much subtype complexity.
- Letting plugin authors or admins construct arbitrary Block Kit outside the curated subset.
- Auto-rendering sections with dividers/headers without Claude's involvement (rejected — see Decision 1).
- Backwards compatibility for the old `sections` / `content: string` fields. Clean cutover.
- Allowing Claude to call Slack's Block Kit Builder or produce complex nested rich_text trees.

## Decisions

### Decision 1: Claude authors blocks directly, Clack validates — not auto-rendering from semantic hints

Two approaches were considered:

- **Semantic hints** — keep `sections: [{title, body}]`, have Clack auto-insert dividers between sections, promote titles to `header` blocks, accept a `footer` field for context. Small schema, minimal Claude instruction changes, Clack decides layout.
- **Direct block authoring** — Claude produces a `blocks: Block[]` array itself using the real Slack Block Kit shape. Larger schema, new instructions, Claude decides layout per response.

The user chose direct authoring. Reasoning: layout decisions that are good for *this* answer's shape (when to group vs. split, when context blocks add signal vs. noise, when a fields block beats prose) are judgment calls that belong to the response author. Auto-rendering forces one layout on all responses; direct authoring lets Claude match structure to content.

The tradeoff is real: Claude spends more tokens per response, and instruction design matters much more (needs explicit restraint guidance to prevent over-structuring). Accepted because the quality ceiling is dramatically higher.

### Decision 2: Authentic Slack Block Kit schema, curated subset — not a Clack dialect

Two schema approaches were considered:

- **Clack dialect** — simplified types (`{type: "header", text: "..."}`) translated to real Slack blocks at the boundary. Shorter for Claude to write, friendlier error messages.
- **Real Slack Block Kit** — Claude writes `{type: "header", text: {type: "plain_text", text: "..."}}` verbatim. More tokens, authentic, transferable.

The user chose authentic Slack Block Kit. Reasoning: flexibility. When Slack adds a block type or we want to expand the curated set, there's no dialect-to-Slack translator to update — just expand the allowlist. Claude's training data already contains Slack Block Kit examples, so it can lean on that directly. No drift between "what Claude thinks it's writing" and "what Slack renders."

The verbosity tax is accepted. Validation errors still speak friendly language — our validator phrases errors in Claude-useful terms ("header text too long, limit is 150 chars, got 200") rather than Slack's raw rejections.

**Curated subset:** `divider`, `header`, `section` (with or without `fields`), `context`, `image`. Anything else rejects with a validator error listing allowed types. This keeps the validator scope bounded and excludes block types that aren't meaningful in a message context (e.g., `input` requires a modal).

**`actions` blocks are NOT in the Claude-authored subset.** Action buttons are driven by the structured `actions: Action[]` field on `submit_response`; Clack (in `getResponseActionBlocks`) renders them into Slack `actions` blocks and appends them to the delivered message. Having Claude emit `actions` blocks directly in the `blocks` array would duplicate or conflict with the structured path, so the validator rejects `actions` blocks in `blocks` with a pointer to the structured field.

**Passthrough on optional fields.** The curated-type allowlist constrains *block types*, not *fields within a type*. Optional Slack Block Kit fields (`block_id`, `confirm` dialogs on buttons, `accessibility_label`, and future additions Slack ships) pass through the validator unchanged. Zod schemas for each allowed block use `.passthrough()` so unknown-but-well-formed fields survive. This is consistent with the "authentic Slack Block Kit" direction — we don't want to be a gatekeeper on every field Slack adds, and we don't want to reject useful accessibility/UX features Claude learns about from Slack's docs.

### Decision 3: Centralized block module — single source of truth

Every outbound surface that takes block input consumes the same module (`src/slack/blocks.ts`). That module exports:

- `BlockSchema` — the Zod schema for the curated block union. Imported by every tool's Zod schema.
- `validateBlocks(blocks)` — returns `BlockValidationError[]`, checked at every tool boundary before delivery.
- `prepareBlocks(blocks)` — applies internal markdown-to-Slack-mrkdwn conversion on text fields, splits oversize section text at 3000 chars, returns Slack-shape blocks ready for posting.

Callers are thin: they call `validate`, return errors as tool errors on failure; call `prepare`, hand the result to the delivery function. No caller reimplements validation or text preparation. This is the "ONE way" guarantee: anywhere Claude-authored blocks enter the system, the same rules apply.

**Alternative considered:** per-caller validation. Rejected — would drift across surfaces, duplicate logic, and make future schema changes a multi-file hunt.

### Decision 4: Clean break on `sections` and `content`

`submit_response` drops `sections` entirely; callers get `blocks` as the only way to express response content. `post_to` actions drop `content: string`; they get `blocks: Block[]`. No dual-mode transition period.

Rationale: a sections-and-blocks coexistence would require Claude to pick between them (and pick correctly) every response, which the user explicitly rejected ("there must be ONE way"). It would also mean two rendering paths to test and maintain.

**Mitigation for in-flight snapshots:** the action snapshot store (per-button `post_to` payloads) currently holds `{text, sections}`. On deploy, existing snapshots become unparseable. Cost is acceptable — snapshots are ephemeral (survives only until the user clicks or the session expires). The deploy coordination note: snapshots created pre-deploy and clicked post-deploy will surface as "expired" errors. Documented in release notes.

### Decision 5: Migration is fully automatic, Claude-powered, enhancement priority

Cron-job prompts are stored at `data/state/cron-jobs.json` as `jobs[].prompt: string` entries (trivia daily questions, cron-scheduled reminders, ad-hoc recurring prompts). A non-trivial subset reference response formatting ("respond with a title and a brief summary section", "use bullet points for each item", "format as a table"). Those references will continue to produce valid responses after the change (Claude can still emit section blocks with lists), but the guidance is outdated and may miss block-type opportunities.

The migration:

1. Runs in **enhancement** priority (background, not blocking startup) — no one waits for it.
2. Is **fully automatic** — no admin prompt, no opt-out.
3. Iterates every `CronJob` in `data/state/cron-jobs.json`.
4. Invokes the migration engine (`src/migrations/engine.ts`, Claude-powered) with instructions scoped to the `prompt` field: "If this prompt references response formatting, structure, layout, or specific markdown patterns, rewrite the format guidance (only) to reference the new blocks API. Otherwise, leave untouched."
5. Writes only modified jobs back to disk, preserving every other `CronJob` field.
6. On per-job failure (engine timeout, parse failure), logs the `id` and continues. Retries on next startup's enhancement phase.

**Alternative considered:** admin-facing summary with opt-out per prompt. Rejected — scheduled prompts are numerous (many per workspace), admins don't want to review dozens of rewrites individually, and the migration is low-risk (format guidance only, not semantics).

### Decision 6: Instructions restraint guidance

Claude's default instinct with block authoring is to over-structure. Given freedom to emit headers and dividers, it will — for every paragraph, between every thought. Most of that is visual noise in a chat UI.

The new `block-kit-formatting.md` instruction file explicitly biases against chrome: "Default to a single `section` block. Only add structure when the content genuinely has structure." Followed by picker guidance for each block type, and examples of good-vs-bad picks ("don't use a `fields` block with one field — use a section").

Instruction length is accepted — 150–200 lines is a lot, but it's stable (doesn't rot as code changes) and the alternative (Claude freelancing block choices) produces worse output.

## Risks / Trade-offs

- **Risk:** Claude over-structures responses, producing noisy layouts with too many headers and dividers. **Mitigation:** explicit restraint guidance in instructions; examples emphasizing "single section is usually right"; optionally an admin-facing way to report "too chrome-heavy" for future tuning.
- **Risk:** Block Kit authoring adds meaningful token cost per response (verbose Slack JSON shape). **Mitigation:** the instruction file provides minimal-boilerplate patterns; most responses will be one section block, preserving the common-case cost.
- **Risk:** Validator drift from Slack's actual limits over time (e.g., Slack raises a limit). **Mitigation:** limits are constants in one module; easy to audit and update. Validator errors are caught pre-send, so a stale limit is a false rejection, not a silent bug.
- **Risk:** Migration mis-identifies a prompt as "format-specific" and rewrites semantics. **Mitigation:** migration prompt to Claude is narrowly scoped (format/layout only); tested against a suite of format-agnostic prompts that should stay untouched; idempotent (re-running leaves a once-migrated prompt unchanged).
- **Risk:** In-flight `post_to` snapshots at deploy time become unusable. **Mitigation:** snapshots are ephemeral; documented as release-note item; users can re-request the answer.
- **Trade-off:** A single central block module creates a chokepoint — any future outbound surface must consume it. Upside of that constraint is exactly the "ONE way" property we wanted. Accepted.
- **Trade-off:** Dropping `sections` breaks every existing test and instruction file that referenced them. The change scope grows, but coexistence was explicitly rejected. Accepted.

## Migration Plan

1. **Code migration** (one-shot at deploy): `sections` → `blocks` on `submit_response`, and `content: string` → `blocks: Block[]` on `post_to` actions. Done atomically in this change. No plugin SDK change — scheduled runs inherit via `submit_response`.
2. **Data migration** (background enhancement): iterate `data/state/cron-jobs.json` and rewrite `jobs[].prompt` entries that reference formatting. Driven by `src/migrations/` machinery with a new numbered migration created via `/create-migration`. Idempotent — safe to re-run.
3. **Snapshot invalidation** (acknowledged, not actively migrated): pre-deploy action snapshots are dropped on deserialize failure. Users with click-pending snapshots see an expired error.
4. **Instruction rollout:** new `block-kit-formatting.md` ships alongside code. `submit-response.md` rewritten to reference blocks. Trivia plugin's per-plugin instruction files rewritten in the same change.

## Open Questions

- Do we want a per-session `blocks` preview tool that lets Claude dry-run block validation without submitting? Could be useful for iterative authoring but adds tool surface; probably deferrable.
- If a future plugin wants to deliver a pre-canned (non-Claude-generated) Block Kit message — e.g., a webhook-driven alert that skips a Claude run entirely — we'd need an SDK-level delivery helper that consumes `src/slack/blocks.ts`. No such plugin exists today; deferring until a concrete use case appears.
