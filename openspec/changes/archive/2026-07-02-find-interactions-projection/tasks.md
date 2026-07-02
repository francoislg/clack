## 1. Tool schema + projection (`src/tools/query/findRecentInteractions.ts`)

- [x] 1.1 Replace the `include_usage` boolean param with `include: z.array(z.enum(["entries", "usage"])).optional().default(["entries"])`; update the `.describe()` text to explain the projection (name the sections you want; usage-only is bounded and the way to tally spend). Treat empty/absent `include` as `["entries"]`.
- [x] 1.2 Change the tool handler to return a projected object: build `entries` only when `"entries"` is requested, and include `totalUsage` only when `"usage"` is requested. Return `{ entries }`, `{ totalUsage }`, or `{ entries, totalUsage }` accordingly (always an object).
- [x] 1.3 When `"entries"` is NOT requested, skip the `paginated.map(summarize)` entry-building work entirely so no large `firstQuestion`/`latestAssistantText` values are emitted; keep the full-set `totalUsage` aggregation path (it already runs pre-pagination) untouched.
- [x] 1.4 Update the tool description string to state that the result is an object projected to the requested `include` sections.

## 2. Idler summary prompt (`src/plugins/idler/prompts/summary.ts`)

- [x] 2.1 Change the spend-tally step to call `find_recent_interactions` with `include: ["usage"]` instead of `include_usage: true`; keep `channel`, `trigger_type: "scheduled"`, and `since`, and keep reading `totalUsage` from the returned object.

## 3. Tests

- [x] 3.1 Update `src/tools/query/findRecentInteractions.test.ts`: replace `include_usage` cases with `include` cases — assert `["usage"]` returns `{ totalUsage }` and NO `entries`; `["entries"]` (and default) returns `{ entries }` and NO `totalUsage`; `["entries","usage"]` returns both; empty matched set with `"usage"` returns a zero `totalUsage`; usage-less sessions contribute zero.
- [x] 3.2 Add/adjust a test asserting the usage-only path does not build entry summaries (e.g. the returned object has no `entries` key even when sessions match), guarding the bounded-payload guarantee.
- [x] 3.3 Update `src/plugins/idler/prompts/summary.test.ts`: assert the prompt instructs `include: ["usage"]` (drop the `include_usage` assertion) and still references `totalUsage`; also assert the prompt retains its "omit the spend line ONLY if the call failed" graceful-degradation wording, so rewording the spend step can't silently drop it.

## 4. Verify

- [x] 4.1 Run `npx tsc` (type-check), `npx oxlint` on the changed files, and `npm test` for the two affected suites; fix any fallout.
- [x] 4.2 Confirm the `clack-tools` spec needs no delta: its "find_recent_interactions Tool Registration" requirement only registers the tool in the query set and is agnostic to the tool's parameters, so the `include` change does not affect it. (Only `find-recent-interactions` and `idler-plugin` carry behavior deltas.)
