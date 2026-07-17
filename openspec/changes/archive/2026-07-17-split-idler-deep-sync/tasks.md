# Tasks — Split Idler Deep Sync

## 1. Scheduling (heuristic.ts)

- [x] 1.1 Add `buildDiscoverySyncCron(schedule, minuteField, stepHours)`: cron at `(anchor − stepHours) mod 24` when that hour is in the thinned sync hours and ≠ anchor; `null` otherwise
- [x] 1.2 Extend `buildLightSyncCron` to also exclude the discovery hour (when one exists), keeping light ∪ discovery ∪ anchor = thinned schedule
- [x] 1.3 `heuristic.test.ts`: discovery-hour cases (standard 18→6 window → hour 15; single-hour window → null; window where anchor−step wraps past midnight; cadence 1; fallback implies deep-only — a contiguous window with no eligible discovery hour has no light hours either)

## 2. Prompts (prompts/sync.ts)

- [x] 2.1 Extract shared `WARMUP_DIRECTIVE` (single batched ToolSearch message) and `RESULT_BUDGET_DIRECTIVES` (paged channel fetches, bounded Reads, targeted Grep, no offload-file reads) constants
- [x] 2.2 Split `buildSyncDeepPrompt` into `buildSyncMaintenancePrompt(config)` (quick-fetch/close-resolved + coldest rotation + memory triage; NO fetch-instructions, NO discovery) and `buildSyncDiscoveryPrompt(config, fetchInstructions)` (discovery only; get_archived enrichment, stable-id keying)
- [x] 2.3 Keep a combined builder (current deep content + new directives) for the fallback layout; compose the three deep-tier prompts from the shared directive constants (light keeps its own stricter budget — always-on toolbelt, nothing to warm up)
- [x] 2.4 `sync.test.ts`: maintenance prompt has no fetch-instructions/discovery text; discovery prompt has no triage/coldest/quick-fetch text; all deep-tier prompts contain both directives; combined fallback ≈ maintenance + discovery duties

## 3. Spec assembly (index.ts)

- [x] 3.1 In `reconcile()`, build the discovery cron; when non-null, reconcile three sync specs (`sync` = maintenance prompt, `sync-light`, `sync-discovery` = discovery prompt with fetch-instructions); when null, reconcile the current two-spec layout with the combined prompt
- [x] 3.2 `plugin.test.ts`: split layout (spec count, specKeys, prompts, ALL sync specs channelless + `submitResponseMode: "skipped"` + `attachedTopics: [TOPIC]`, light cron excluding both anchor and discovery hours); fallback layout structurally identical to pre-change (deep-only — no light or discovery spec, combined prompt carrying all pre-change duties incl. fetch-instructions; content differs only by the new D3 directives)

## 4. Verification

- [x] 4.1 Full suite (`npm test`), `npx tsc --noEmit`, `npx oxlint`, `npx oxfmt` green
- [x] 4.2 Sanity-measure the split prompts: maintenance prompt is 4.8k chars vs 29.7k for the combined prompt with a representative 24k-char fetch doc (−24.9k chars ≈ −6.2k tokens on the anchor fire's first turn). Post-deploy follow-up (ops, outside this change): confirm neither split fire compacts (peak cache-read < ~110k) and the ToolSearch warm-up is ≤2 calls
