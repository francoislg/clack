## 1. Extend `list_top_ideas` read surface

- [x] 1.1 Add a `sort_by` arg to `createListTopIdeasTool` (`src/plugins/idler/tools/ideas.ts`): zod enum `["priority", "coldest"]`, optional, default `"priority"`; describe both orderings.
- [x] 1.2 Sort open units by the chosen order — `"priority"` keeps the existing `b.slot.priority - a.slot.priority` (descending); `"coldest"` sorts by `entry.updatedAt` ascending — then apply the existing `limit` slice.
- [x] 1.3 Add `updatedAt` (from `entry.updatedAt`), `staleAfter` (from `entry.staleAfter`, optional — omit when the entry has none), and computed `overdue` (`staleAfter?.date != null && staleAfter.date < now`, where `now = new Date().toISOString()`) to each returned unit. Keep all existing output fields.

## 2. Concierge sync instruction

- [x] 2.1 In `src/plugins/idler/prompts/sync.ts`, replace the vague "recompute priority for every open unit" step with a bounded coldest-rotation step: call `list_top_ideas` with `sort_by: "coldest"` and an explicit small `limit` (e.g. 5–10 per fire); for each returned unit re-verify against its references and decide — `overdue` / no fresh activity past cursor → park via `upsert_idea` `blocked: true` (stays open, leaves the work window); fresh activity → `freshInput: true` (raise); otherwise refresh `whereWeAre`.
- [x] 2.2 State that parking never closes/deletes the unit and that a parked unit auto-resurfaces when `freshInput` is next detected; a unit with genuine fresh input is never parked.
- [x] 2.3 Keep the existing CLOSE-RESOLVED and discovery steps intact; only the recompute step changes.

## 3. Tests

- [x] 3.1 In `src/plugins/idler/tools/tools.test.ts`, add a case: `sort_by: "coldest"` returns units ordered by ascending `updatedAt` (seed units with distinct `updatedAt`).
- [x] 3.2 Add a case asserting `list_top_ideas` output carries `updatedAt`, `staleAfter`, and a correct `overdue` boolean (past `staleAfter.date` → `true`; absent / future → `false`).
- [x] 3.3 Assert the default (no `sort_by`) still sorts by `priority` descending — guard against regressing the work fire's selection order.
- [x] 3.4 Add a rotation case (spec scenario "Re-verification rotates a unit to the back"): seed units with distinct `updatedAt`, call `list_top_ideas` `sort_by: "coldest"`, `upsert_idea` the first-returned unit (bumping its `updatedAt`), then re-call and assert a different unit is now first.
- [x] 3.5 Park-mechanism case (the testable half of the R3 "parks stale units" requirement): `upsert_idea` a workable unit and a `blocked: true` unit, then assert the blocked unit's priority sorts below the workable one (falls outside a small-`limit` `sort_by: "priority"` window). The concierge's park-vs-raise-vs-refresh *decision* is prompt-driven (validated by sync-prompt review in task 2, not an automated test — the project does not run the LLM in tests).

## 4. Verify

- [x] 4.1 `npx tsc` type-checks clean; `npx oxlint src/plugins/idler` and `npx oxfmt --check src/plugins/idler` pass.
- [x] 4.2 `npm test` green; `openspec validate idler-stale-unit-parking --strict` passes.
