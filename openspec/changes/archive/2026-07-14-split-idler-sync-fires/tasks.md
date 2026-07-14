# Tasks — split-idler-sync-fires

## 1. Heuristic: anchor-hour math

- [x] 1.1 Add `anchorHour(w: IdlerWindow, explicit: boolean)` (or equivalent) to `src/plugins/idler/heuristic.ts`: `(start - 1) mod 24` for a derived complement window, `(end - 1) mod 24` for an explicit sync window
- [x] 1.2 Add a deep-cron builder producing `45 <anchor> * * <days>` for both window shapes
- [x] 1.3 Add a light-cron builder: existing `thinHours(hours, syncEveryHours, anchor)` set MINUS the anchor hour; returns `null` when the remaining set is empty (single-hour sync window) or no days are set
- [x] 1.4 Unit tests in `heuristic.test.ts`: anchor for 18→6 complement is 17; light hours for 18→6 @ every-2h are `7,9,11,13,15`; explicit window anchor is its last hour; wrapped complement (interior work window) anchors chronologically; single-hour window yields null light cron; light ∪ deep equals the previous thinned schedule

## 2. Prompts: split light / deep

- [x] 2.1 Extract the shared triage fragments from `buildSyncPrompt` (allowlist header, recall-page classify-then-take steps, `get_archived` enrichment + `upsert_idea` keying rules) so both prompts compose them without drift
- [x] 2.2 Add `buildSyncLightPrompt(config)`: memory triage only; explicit early-exit instruction (`skip_response` immediately when classification yields no candidates, framed as the expected outcome); NO fetch-instructions interpolation; no PR probes / coldest rotation / discovery
- [x] 2.3 Add `buildSyncDeepPrompt(config, fetchInstructions)`: full maintenance pass with all four steps — (a) quick-fetch + close-resolved tracked units, (b) coldest-unit re-verification, stale parking, and priority recompute (per idler-ideas-ledger), (c) memory triage (shared fragment from 2.1), (d) external discovery covering ALL enabled sources (changed from the round-robin "do ONE source per fire")
- [x] 2.4 Prompt tests: light prompt contains the early-exit (`skip_response`) contract, carries no fetch-instructions content, and uses the shared triage keying; deep prompt covers all four maintenance steps — quick-fetch+close-resolved, coldest rotation/park/recompute, memory triage, and all-sources discovery (assert it scans every enabled source, not one) — and shares the triage keying with light

## 3. Reconcile: two sync specs

- [x] 3.1 In `src/plugins/idler/index.ts`, reconcile the deep spec under the existing `sync` specKey (anchor-hour cron, deep prompt) and a new `sync-light` spec (light cron, light prompt); skip the light spec when its cron builder returns null
- [x] 3.2 Both sync specs stay channelless with `submitResponseMode: "skipped"` and `attachedTopics: [TOPIC]`; work and summary specs untouched
- [x] 3.3 `plugin.test.ts`: reconcile produces 4 specs for an operational config (light, deep, work, summary); deep spec has specKey `sync` and light spec has specKey `sync-light`, both channelless (no `channel`) with `submitResponseMode: "skipped"` and `attachedTopics: [TOPIC]`; deep cron is anchor-hour-only; light cron excludes the anchor and honors `syncEveryHours`; single-hour sync window produces 3 specs (no light)

## 4. Instructions & docs

- [x] 4.1 Review `src/plugins/idler/instructions.ts` (behavior topic) for wording that assumes a single sync shape; adjust references to "the sync fire" where tier matters (coldest rotation, close-resolved → deep)
- [x] 4.2 Update the `set_idler_work_hours` / `set_idler_sync_hours` tool descriptions in `tools/management.ts` to describe the light/deep split
- [x] 4.3 Update the CLAUDE.md idler section: four cron tasks, light/deep sync semantics, `syncEveryHours` scope (light only)

## 5. Verification

- [x] 5.1 Run `npx vitest run src/plugins/idler/`, `npx tsc --noEmit`, `npx oxlint` + `npx oxfmt` on touched files
- [x] 5.2 Validate the change with `openspec validate split-idler-sync-fires --strict`
