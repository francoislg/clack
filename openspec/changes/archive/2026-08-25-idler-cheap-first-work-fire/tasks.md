## 1. Breaker state module

- [x] 1.1 Create `src/plugins/idler/breaker.ts`: graceful zod schema `{ windowKey, consecutiveEmpty, pendingAsync }` with zero-state fallback, `loadBreakerState(sdk)` / `saveBreakerState(sdk, state)` over `sdk.readFile`/`sdk.writeFile("breaker.json")`
- [x] 1.2 Add `windowKeyFor(window, now)` to `breaker.ts` — YYYY-MM-DD in the window's tz; overnight windows (`start > end`) key pre-`end` hours to the previous day
- [x] 1.3 Add `recordEmptyFire(sdk, window)` (windowKey compare → increment or rollover-to-1) and `recordProductive(sdk)` (reset `consecutiveEmpty` to 0)
- [x] 1.4 Create `src/plugins/idler/breaker.test.ts`: absent/corrupt file → zero state; same-window increment; rollover reset; overnight post-midnight windowKey; productive reset (canonical `createClackSdk` fake, `vi.useFakeTimers` for clock control)

## 2. Tool surface

- [x] 2.1 Add `record_fire_outcome` tool (`{ outcome: "empty" }`) in `src/plugins/idler/tools/fireOutcome.ts`; register always-on in `index.ts` beside the ledger tools (admin-gated, label "Recording idler fire outcome")
- [x] 2.2 Hook `record_activity` handler (`tools/activity.ts`): every kind except `parked` calls `recordProductive` after appending the entry
- [x] 2.3 Extend `tools/tools.test.ts`: `record_fire_outcome` increments; `record_activity` kind `pr_opened`/`failure` resets; kind `parked` leaves the counter untouched

## 3. Prompt and behavior-topic restructure

- [x] 3.1 Restructure `buildWorkPrompt` (`prompts/work.ts`): step 1 `list_top_ideas` with ledger-only freshness; step 2 empty path (`record_fire_outcome` then end via skip, no attach); remaining steps select → re-read selected unit only → lazy attach → act → `record_activity`; park-and-end rule for stale-on-re-read
- [x] 3.2 Update `BEHAVIOR_INSTRUCTION` (`instructions.ts`): cheap-first ordering (no attach before selection), park-and-end (no cascade to a second deep read), empty-outcome recording rule
- [x] 3.3 Update `prompts/work.test.ts` and `instructions.test.ts`: assert step order (`list_top_ideas` before any attach mention), the `record_fire_outcome` empty step, the skip contract, and the park-and-end rule

## 4. Verification

- [x] 4.1 `npx tsc --noEmit`, `npx oxlint` and `npx oxfmt` on touched files, `npm test`
- [x] 4.2 `openspec validate idler-cheap-first-work-fire --strict`
