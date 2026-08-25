## 1. Config knob

- [x] 1.1 Add `stopAfterEmptyRounds` to `idlerConfigSchema` (`src/plugins/idler/config.ts`): `z.number().int().min(0).max(10).default(2)`; add the field to `IdlerConfig` (`types.ts`) with a doc comment stating 0 = disabled; add `stopAfterEmptyRounds: 2` to `DEFAULT_CONFIG`
- [x] 1.2 Extend `set_idler_config` (`tools/management.ts`): optional `stopAfterEmptyRounds` arg (int 0–10) patched like sibling knobs, described as "consecutive empty work fires before the night breaker trips; 0 disables"
- [x] 1.3 Extend `config.test.ts` and the management-tool tests: default 2, bounds rejection, patch round-trip

## 2. Breaker semantics (`src/plugins/idler/breaker.ts`)

- [x] 2.1 Add `evaluateBreaker(config, state, now)` → `{ tripped, consecutiveEmpty, threshold } | undefined` (undefined when `stopAfterEmptyRounds` is 0; never tripped on a stale `windowKey`)
- [x] 2.2 Add `recordAsyncTriggered(sdk, window, asyncKey)` — set-semantics add to `pendingAsync`, no counter change; make `recordEmptyFire` freeze (no increment, no reset) while `pendingAsync` is non-empty
- [x] 2.3 Extend `recordProductive` to also clear `pendingAsync`
- [x] 2.4 Extend `breaker.test.ts`: trip evaluation (at/below threshold, disabled, stale window), async-key dedup, freeze-while-pending, productive clear, rollover clears `pendingAsync`

## 3. Tool wiring

- [x] 3.1 Extend `record_fire_outcome` (`tools/fireOutcome.ts`): `outcome: "empty" | "async-triggered"` + optional `asyncKey`, rejected as an error when `asyncKey` is missing with `"async-triggered"` or supplied with `"empty"`
- [x] 3.2 Surface `nightBreaker` in the `list_top_ideas` result (`tools/ideas.ts`): load config + breaker state at call time, include the field only when enabled
- [x] 3.3 Hook `upsert_idea` (`tools/ideas.ts`): reset `consecutiveEmpty` when the call creates a new open unit or sets `freshInput: true`; no reset on `blocked`, `open: false`, or `ignore` writes
- [x] 3.4 Extend `tools/tools.test.ts` for all three: outcome-arg validation, `nightBreaker` presence/absence/trip states, upsert lift matrix (new-open resets, freshInput resets, parked/close/ignore do not)

## 4. Prompt and behavior topic

- [x] 4.1 Update `buildWorkPrompt` (`prompts/work.ts`): step 1 gains "if `nightBreaker.tripped`, end immediately via skip — no further tool calls"; the async-trigger step records `outcome: "async-triggered"` with the PR key instead of an empty outcome
- [x] 4.2 Update `BEHAVIOR_INSTRUCTION` (`instructions.ts`): breaker rules — tripped means stop instantly; posting a trigger is async-pending, not empty; never record empty after a trigger post
- [x] 4.3 Update `prompts/work.test.ts` / `instructions.test.ts`: assert the tripped early-exit wording and the async-triggered recording rule

## 5. Verification

- [x] 5.1 `npx tsc --noEmit`, `npx oxlint` and `npx oxfmt` on touched files, `npm test`
- [x] 5.2 `openspec validate idler-night-circuit-breaker --strict`
