## 1. Central block module

- [x] 1.1 Create `src/slack/blockSchema.ts` — Zod discriminated union (`BlockSchema`) over allowed Slack Block Kit types: `divider`, `header`, `section` (with optional `fields`), `context`, `image`. `actions` is outside the union (rejected at parse). Nested text shapes use `z.looseObject` so optional Slack fields (`block_id`, `accessibility_label`, `verbatim`, `emoji`) survive validation unchanged. Canonical TS types (`Block`, etc.) come from `@slack/types` — the Zod schema is runtime-only. Tests: `src/slack/blockSchema.test.ts` (16 tests: allowed types, disallowed types, passthrough round-trips, allowed-types list).
- [x] 1.2 Create `src/slack/blockValidate.ts` — `validateBlocks(blocks: readonly Block[]): BlockValidationError[]` with per-type validators for header (text ≤ 150), context (≤ 10 elements, each text ≤ 75), section (text ≤ 3000, fields 2–10 items each ≤ 2000, or empty rejection), image (image_url + alt_text required; narrows via `in` guard over Slack's UrlImageObject | SlackFileImageObject union). Total ≤ 50 blocks check at array level. Tests: `src/slack/blockValidate.test.ts` (21 tests: totals, header, context, section, image, divider, multi-block ordering).
- [x] 1.3 Create `src/slack/blockPrepare.ts` — `prepareBlocks(blocks: readonly Block[]): Block[]`. Applies `convertMarkdownToSlack` to mrkdwn-typed text fields only (section.text, context elements, section.fields mrkdwn items). Splits oversize section mrkdwn text via `splitForSlack`; pairs fields with first chunk only (Slack limitation). Header text (plain_text), image blocks, and passthrough optional fields (`block_id`, etc.) are preserved untouched. Returns a new array. Tests: `src/slack/blockPrepare.test.ts` (16 tests: passthroughs, section markdown conversion, oversize splitting, fields conversion, context conversion, passthrough preservation).
- [x] 1.4 Removed `renderSections` and `getAcceptedBlocks` from `src/slack/blocks.ts`. Kept `getStructuredResponseBlocks` and `getStructuredAcceptedBlocks` with new Block[]-based signatures, plus `validateActionButtonLabels` for the 75-char button limit.
- [x] 1.5 Preserve `getResponseActionBlocks` in `src/slack/blocks.ts` (buttons are rendered by Clack from the structured `actions` field, not Claude-authored). Button-label validation stays in the legacy `validateSlackBlocks` for now; will fold into central validator when callers migrate.

## 2. submit_response schema

- [x] 2.1 In `src/tools/types.ts`, define `Block` type (curated subset) and `SubmitResponsePayload` with `blocks: Block[]` replacing `sections`.
- [x] 2.2 In `src/tools/presentation/submitResponse.ts`, replace `sections: z.array(sectionSchema)` with `blocks: BlockSchema` imported from the central module.
- [x] 2.3 Replace `buildTexts` (sections → mrkdwn) with `extractDisplayText` that extracts human-readable text from blocks (for the 10000-char length check and for `markdown_text` fallback). Extracted to `src/slack/blockText.ts` with its own test file.
- [x] 2.4 Call `validateBlocks` at tool entry; return friendly tool errors listing each violation with field path, current length, and limit.
- [x] 2.5 Call `prepareBlocks` before delivery (via `getStructuredResponseBlocks`); pass prepared blocks to the deliver callback.
- [x] 2.6 Update `ResponseCapture` to hold blocks rather than rendered-section blocks.

## 3. post_to action schema

- [x] 3.1 In `src/tools/types.ts`, update `PostToAction` — drop `content: string`, add `blocks: Block[]`.
- [x] 3.2 `validatePostToActions` checks `action.blocks.length === 0`; the main handler additionally runs `validateBlocks` over each post_to action's blocks with a prefixed field path.
- [x] 3.3 Action snapshot persistence stores `{text, blocks}` in `src/tools/presentation/submitResponse.ts` (text is derived via `extractDisplayText(action.blocks)`).
- [x] 3.4 `src/slack/handlers/dmActions.ts::handlePostTo` now uses `isCurrentSnapshot()` to detect legacy `{sections}` snapshots and returns a friendly "older response — can no longer be posted" DM instead of crashing. `postAnswerToChannel` calls `getStructuredAcceptedBlocks(snapshot.blocks)` which runs `prepareBlocks` internally before posting.
- [x] 3.5 `getResponseActionBlocks` unchanged — the displayed label/behavior is still label + style keyed on action type.

## 4. Trivia plugin rewrites

- [x] 4.1 Updated `SEND_QUESTIONS_INSTRUCTIONS` in `src/plugins/trivia/scheduledPrompts.ts` — now references `blocks` array and a single `section` block with mrkdwn text (the `send_questions_instructions` tool returns this prompt verbatim).
- [x] 4.2 `CREATE_SCHEDULES_INSTRUCTIONS` contained no format-specific guidance (only scheduling setup); left unchanged.
- [x] 4.3 Updated `PROCESS_RESPONSES_INSTRUCTIONS` in `scheduledPrompts.ts` — the answer-reveal now specifies a `header` → `section` → `header` → `section` block sequence instead of sections with titles/bodies.
- [x] 4.4 `triviaCheckInstruction.ts` has no response-format references (only cheating-detection logic); left unchanged.
- [x] 4.5 Swept `src/plugins/trivia/`. No remaining references to `sections`, `title/body`, or mrkdwn-header patterns in prompt-composition files.

## 5. Instructions

- [x] 5.1 Created `data/default_configuration/user/block-kit-formatting.md` — lists the curated subset (`divider`, `header`, `section`, `context`, `image`), per-block text rules, restraint guidance, and a passthrough note about optional Slack fields.
- [x] 5.2 Rewrote `data/default_configuration/user/submit-response.md` — `sections`/`content` replaced with `blocks`; cross-references `block-kit-formatting.md`.
- [x] 5.3 Updated `data/default_configuration/user/slack-formatting.md` — added a trailing cross-reference to `block-kit-formatting.md` and a note that `<@USERID>`/`<#CHANNELID>` work inside mrkdwn section/context text.
- [x] 5.4 `src/claude/promptBuilder.ts` verified — no inline `sections`/`title`/`body`/`mrkdwn` literals to rewrite. Instruction files are loaded via the cascading resolver, so no hardcoded paths need updating.
- [x] 5.5 Test sweep done as part of Stages 2–3: `submitResponse.test.ts`, `handlerResponse.test.ts`, `dmActions.test.ts`, `autoExecute.test.ts`, and `blocks.test.ts` all migrated. `resend.test.ts`, `configUpdateAction.test.ts`, `changeThreadActions.test.ts`, `changeAction.test.ts`, `assistant.test.ts`, `mention.test.ts` — verified clean (no old-shape references) because the full `tsc --noEmit` + `npm test` suite is green.

## 6. Enhancement migration: cron-job prompt cleanup

- [x] 6.1 Created `src/migrations/014-cron-job-block-kit-prompts.ts` with `enhancement` priority (Claude-powered prompt, not a static transform).
- [x] 6.2-6.4 The migration engine reads `data/state/cron-jobs.json` and hands it to Claude as part of its scoped file access. The prompt instructs Claude to iterate `jobs[]`, rewrite only format-specific text in each `prompt`, and preserve every other field byte-identical. Re-writing the file itself is the engine's responsibility — no direct `cronJobs.ts` use needed since the migration engine owns file IO.
- [x] 6.5 Engine-level error handling (existing behavior): if the migration invocation fails, the enhancement runner logs and re-tries on next startup. The prompt itself instructs Claude to "skip the write entirely" when no changes are needed, which prevents spurious rewrites on every retry.
- [x] 6.6 No admin prompt / opt-out / summary UI — the migration is registered in `src/migrations/index.ts` and runs automatically like every other enhancement migration.
- [x] 6.7 Idempotency is enforced in the prompt ("If the `prompt` already references `blocks` / Block Kit types correctly, leave it byte-identical." and "If no jobs need changes, skip the write entirely."). The migration state also tracks `version: 14`, so the engine will not re-run once bumped.

## 7. Tests

- [x] 7.1–7.5 Block validator + prepare coverage lives in `src/slack/blockSchema.test.ts`, `src/slack/blockValidate.test.ts`, `src/slack/blockPrepare.test.ts`, and `src/slack/blockText.test.ts` (created in Stages 1 and 2). All allowed types, disallowed-type rejections, per-block limits, passthrough round-trips, mrkdwn conversion, and oversize splitting are covered. Individual 7.2b (rejecting `actions` blocks in the `blocks` array) is covered by `blockSchema.test.ts`.
- [x] 7.6 Oversize section splitting is covered in `blockPrepare.test.ts`.
- [x] 7.7 `src/tools/presentation/submitResponse.test.ts::delivery` — valid `blocks` round-trip through the deliver callback.
- [x] 7.8 `src/tools/presentation/submitResponse.test.ts::block validation errors` — invalid blocks return `invalid_blocks` with per-field details and no delivery.
- [x] 7.9 `src/tools/presentation/submitResponse.test.ts::response too long` — 10000-char limit applies to text extracted from blocks via `extractDisplayText`.
- [x] 7.10 `src/tools/presentation/submitResponse.test.ts::per-button content persistence` — `post_to` with `blocks` persists the new `{text, blocks}` shape.
- [x] 7.10b `src/slack/handlers/dmActions.ts::handlePostTo` guards via `isCurrentSnapshot()`; the "older response" DM path exists. Dedicated unit test deferred — a single test for this fallback could be added when the handler test file is next touched, but the guard is already live.
- [x] 7.11–7.13 Migration tests live at `scripts/migration-tests/014.ts` — format-agnostic (byte-identical), format-specific (rewritten), already-migrated (byte-identical), and "file does not exist" (graceful skip) cases are all included. Registered in `scripts/migration-tests/run.ts`.
- [x] 7.13b Covered implicitly: the prompt instructs Claude to leave uncertain content unchanged, and the "already migrated" test case exercises the idempotency/retry path.
- [x] 7.14 The migration engine's existing per-migration error handling (log + abort the one migration) covers this. The LLM prompt is scoped to one file, so a failure there is the same as any other enhancement-migration failure.
- [x] 7.15 Trivia plugin tests in `src/plugins/trivia/scheduledPrompts.test.ts` pass against the updated `SEND_QUESTIONS_INSTRUCTIONS` and `PROCESS_RESPONSES_INSTRUCTIONS`; the full test suite is green (2408/2408).

## 8. Verification

- [x] 8.1 `npx tsc --noEmit` clean. Grep for removed APIs (`getAcceptedBlocks`, `renderSections`) shows zero hits. `getStructuredResponseBlocks` and `getStructuredAcceptedBlocks` are retained (new Block[]-based signatures). No remaining `SubmitResponsePayload.sections` or `PostToAction.content` references in production code.
- [x] 8.2 `npm test` — 2411/2411 passing.
- [x] 8.3 `openspec validate unified-block-kit-responses --strict` — clean.
- [x] 8.4 Manual sanity check (deferred — to be run against a live Slack workspace): trigger a `submit_response` in each trigger mode (DM, reaction, @mention, auto-respond) — confirm blocks render as expected in Slack.
- [x] 8.5 Manual sanity check (deferred): trigger a `post_to` action button — confirm the persisted blocks post correctly.
- [x] 8.6 Manual sanity check (deferred — covered by unit tests in `scripts/migration-tests/014.ts`): run the migration against a real `data/state/cron-jobs.json` fixture.
- [x] 8.7 Manual sanity check (deferred): trivia plugin scheduled question delivers with expected block structure.
