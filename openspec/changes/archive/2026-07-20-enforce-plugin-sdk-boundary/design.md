# Design — Enforce the Plugin SDK Boundary

## Context

`src/plugins/CLAUDE.md` declares hard rules: plugin code (`src/plugins/<name>/**`) must not import bot core. Nothing enforces them, and the SDK never exported the things every plugin needs, so three coping strategies coexist:

- **Trivia crosses the boundary**: ~30 tool files import `textResult`/`errorResult` from `src/tools/helpers.js`; `postQuestions.ts` imports `slack/blockSchema.js`, `slack/blockValidate.js`, `slack/messagePoster.js`, `slack/blocks.js`, and `src/logger.js`; `setRevealNarrative.ts` imports `BlockSchema`; 7 files (`answerTypes/*`, `renderPoints.ts`, `renderHint.ts`) type-import `SlackBlocks` from `src/slack/blocks.js`.
- **Casual-talk and idler duplicate**: each carries a local copy of `textResult` in its own `helpers.ts`.
- **Tests reach deepest**: 64 test files import `parseToolResult` from `src/tools/testHelpers.js`; 3 `*.integration.test.ts` files deliberately import core (`roles.js`, `mcp.js`, a migration) to test the plugin↔core seam.
- **Smaller plugins cross too, and today's legal leaf imports become violations**: giphy (and similar small plugins) import `textResult`/`errorResult` from `src/tools/helpers.js` at shallower relative depths, and ~11 plugin files import `zodResult.js` / `imageSearchResult.js` directly — permitted under the current "SDK-layer leaf" exception, but forbidden under one-surface (the façade becomes the only door). Both categories are swept in this change; task 2.6's full audit is the completeness backstop.

Files **directly in `src/plugins/`** are the SDK layer: the bridge (`sdk.ts`, `registry.ts`, `sdkMemory.ts`, `sdkUsers.ts`, `state.ts`) legitimately imports core; the leaves (`zodResult.ts`, `imageSearchResult.ts`) import only third-party. `sdk.ts` is import-time side-effect free (one top-level constant; everything else is declarations).

The repo already has two guard tests that structurally scan source (`testHelpers.guard.test.ts`, `cascadeSingleImplementation.test.ts`) and a lefthook pre-commit that runs the full test suite — so a guard test is an enforced gate, not advisory.

## Goals / Non-Goals

**Goals:**

- ONE import surface for plugins: `sdk.js` (plus `plugins-sdk/testHelpers.js` for tests). A plugin developer with `import ... from "../../sdk.js"` has every tool in hand.
- Statically enforce the boundary with an empty exception list — drift becomes a test failure, not a review catch.
- Single implementation for every shared helper (kill the casual-talk/idler duplicates).
- Zero runtime behavior change.

**Non-Goals:**

- No changes to what the SDK *does* — no new capabilities, only surface (re-exports + relocations).
- The oxlint rule is deliberately PARTIAL (see D6b). `no-restricted-imports` matches specifier text, not resolution, so it cannot express "resolves outside your plugin dir" at arbitrary depths (and name-based bans would false-positive on plugin-internal dirs like trivia's own `tools/` and `reveal/slack.js`); the resolving guard test is the authority.
- Not restructuring `src/tools/` or `src/slack/` — core keeps its layout; only the shared leaves move.
- Not converting the 3 integration tests — cross-boundary imports are their purpose.

## Decisions

### D1: `sdk.ts` is a façade — module exports for pure things, instance members for stateful things

The rule "everything comes from the SDK" has two access styles, both already established:

- **Instance members** (`sdk.logger`, `sdk.t`, `sdk.readFile`, …) for anything scoped to the plugin or requiring runtime state. Nothing new is needed here — every stateful need in the violation inventory already has an instance member (`sdk.logger` replaces the direct `logger` import; `sdk.getSlackClient()` already sources the Slack client for posting).
- **Module exports** (`import { textResult, type SlackBlocks } from "../../sdk.js"`) for pure functions and types. `sdk.ts` re-exports them from implementation files; plugins never learn where the implementation lives.

Alternative considered: new instance members for block tooling (`sdk.validateBlocks(...)`). Rejected — `validateBlocks` and `BlockSchema` are pure, and `postStructuredMessage(client, opts)` already takes the client as an explicit argument (postQuestions feeds it `sdk.getSlackClient()`). Wrapping pure functions as instance members adds fake statefulness and complicates the canonical `FakeSdk`.

### D1b: Light façade via factory extraction (discovered during implementation)

Every pre-change plugin import of `sdk.js` was **type-only**; the sweep introduces the first *value* imports. `sdk.ts` originally carried both the type contract AND `createClackSdk` with its heavy core imports (`slack/app`, `sessions`, `config`, …) — value-importing that from plugin code would have entered the module cycle already documented on `ClackSdkDeps.executeCronJob` (`sdk → cronScheduler → handlers/core → tools/server → lifecycle → registry → plugin`), and would load the whole core graph into every plugin unit test.

Resolution: split the file. `sdk.ts` keeps the types and the façade exports and becomes **import-time light** (only `import type` + pure modules — safe to value-import from anywhere in a plugin). The implementation moves to a factory module (bridge), with the cron and messaging method groups extracted to their own surface modules following the existing users/memory surface pattern (file-size discipline). Core (`registry.ts`) imports the factory directly; plugin tests get `createClackSdk` via the test surface. This also retires the old rationale against value-importing the SDK ("the sdk.ts barrel is too heavy") — the façade is now the cheap, safe door.

### D1c: Three sibling layers — `plugins/`, `plugins-sdk/`, `plugins-core/` (user-directed)

Rather than SDK files living flat beside the plugin folders, the layers get their own directories, which makes the boundary *geometric*:

- `src/plugins/` — ONLY plugin directories (guard-asserted). Escaping your plugin dir is legal only if you land in `plugins-sdk/`.
- `src/plugins-sdk/` — the SDK. Top-level files ARE the plugin-importable surface: `sdk.ts` (façade — one-stop import), `testHelpers.ts` (test-only), and the leaf modules (`toolResults.ts`, `zodResult.ts`, `imageSearchResult.ts` — directly importable too, folder-as-surface). `plugins-sdk/internal/` (`factory.ts`, `cron.ts`, `messaging.ts`, `users.ts`, `memory.ts` + the SDK's own tests) is the implementation and is never plugin-importable.
- `src/plugins-core/` — the core-facing plugin loader (`registry.ts`, `state.ts`) and the boundary guard. Neither plugin- nor SDK-code; plugins never touch it.

This relaxes D2's façade-FILE-only rule to a surface-FOLDER rule (leaves importable directly), while `sdk.ts` remains the recommended one-stop door.

### D6b: Partial oxlint rule as in-editor sugar (user-directed)

The folder names make two violation classes textually unambiguous — no plugin can have a `plugins-sdk/internal` or `plugins-core` path segment in its own tree — so a `no-restricted-imports` override scoped to `src/plugins/**/*.ts` bans exactly those two specifier patterns, with messages pointing at the guard and the grow-the-surface remedy. Ordered BEFORE the `*.integration.test.ts` override so the escape hatch still wins for seam tests. Everything else stays guard-only (see Non-Goals).

### D2: Sanctioned re-export point — the one exception to the no-barrel rule

The repo's global rule bans convenience re-exports. The SDK façade is the deliberate exception: the boundary IS the re-export point, and re-exporting there is the mechanism that makes the one-surface rule possible — not a convenience. `src/plugins/CLAUDE.md` states this explicitly so the exception can't creep elsewhere.

The façade surface added to `sdk.ts`:

| Export | Implementation home | Notes |
| --- | --- | --- |
| `textResult`, `errorResult`, `MAX_TOOL_OUTPUT_CHARS` | NEW leaf `src/plugins-sdk/toolResults.ts` | moved out of `src/tools/helpers.ts` |
| `zodErrorToResult` | `src/plugins-sdk/zodResult.ts` (existing) | re-export |
| image-search result contract (schema + types) | `src/plugins-sdk/imageSearchResult.ts` (existing) | re-export |
| `BlockSchema`, `ALLOWED_BLOCK_TYPES`, `type Block` | `src/slack/blockSchema.ts` | re-export |
| `validateBlocks` (+ its error type) | `src/slack/blockValidate.ts` | re-export |
| `postStructuredMessage`, `notificationText` (+ opts/result/client types) | `src/slack/messagePoster.ts` | re-export |
| `type SlackBlocks` | `src/slack/blocks.ts` | type re-export |
| `type CronJob`, `type SkipDate`, `type CreateCronJobParams`, `type UpdateCronJobParams` | `src/cronJobs.ts` | type re-exports (plugin tests type their fake cron deps with these) |

### D3: Relocate, don't fork — core consumes the SDK-layer leaves

`textResult`/`errorResult`/`MAX_TOOL_OUTPUT_CHARS` move to `src/plugins-sdk/toolResults.ts` (a leaf: zero imports from `src/`). `src/tools/helpers.ts` becomes a delegating module (`export { ... } from "../plugins/toolResults.js"`) so its ~dozens of core call sites are untouched. The dependency arrow core → SDK-layer-leaf is fine; only plugins → core is forbidden. Same pattern for `parseToolResult`: implementation moves to `src/plugins-sdk/testHelpers.ts`, `src/tools/testHelpers.ts` delegates.

Alternative considered: leave implementations in `src/tools/` and have `sdk.ts` re-export from there. Rejected — it would make the SDK façade depend on core *for plugin-facing primitives*, and a future core refactor could silently drag plugin-visible types around. The leaf placement makes "this is plugin-facing" structural. (The block tooling stays in `src/slack/` because it is genuinely Slack-core functionality that plugins borrow, not a plugin primitive; if that coupling ever bites, moving it behind the façade later is invisible to plugins — that's the point of the façade.)

### D4: Test surface is a sibling file, not part of `sdk.ts`

Test-only affordances would pollute the prod façade and invite prod use. `src/plugins-sdk/testHelpers.ts` is the one extra surface, importable **only from test files** (`*.test.ts`). The guard enforces the direction: prod plugin files importing `plugins-sdk/testHelpers.js` fail the guard. It carries `parseToolResult` + `toolResultText` (implementations moved here; `src/tools/testHelpers.ts` delegates) and passthroughs of `createClackSdk` / `createMemorySurface` from the factory layer — plugin tests that construct a real SDK over a temp dir go through this door, since `createClackSdk` no longer lives on `sdk.ts` (D1b).

Also considered: folding into trivia's `testHelpers.fakeSdk.ts`. Rejected — `parseToolResult` is plugin-agnostic; the fakeSdk is trivia-local.

### D5: The guard — resolve, don't pattern-match

New `src/plugins-core/pluginBoundary.guard.test.ts` (vitest, repo guard-test style):

1. Walk every `*.ts` under `src/plugins/<name>/**` (each first-level *directory* of `src/plugins/` is a plugin; files directly in `src/plugins/` are the SDK layer and exempt from this rule — see rule 3).
2. Extract every import/export-from/dynamic-import specifier; skip non-relative specifiers (packages + `node:` builtins are allowed).
3. Resolve each relative specifier against the importing file. Allowed targets: (a) inside the importing file's own plugin directory; (b) any TOP-LEVEL file of `src/plugins-sdk/` (folder-as-surface, per D1c), with `testHelpers.js` allowed **iff** the importer is a `*.test.ts` file. Everything else — core, another plugin's directory, `plugins-sdk/internal/**`, `plugins-core/**` — fails.
4. `*.integration.test.ts` files are exempt entirely (the repo's existing integration escape hatch; their job is crossing the seam).
5. Companion assertions cover the layout itself: `src/plugins/` must contain only plugin directories (plus `CLAUDE.md`); the declared leaf modules (`toolResults.ts`, `zodResult.ts`, `imageSearchResult.ts`) must import nothing from `src/` — leaves stay leaves, so they can never form import cycles — and must exist (stale-list detection). Everything else in `plugins-sdk/` (internal implementation, testHelpers, the SDK's own tests) is bridge code, core-facing by definition.
6. Failure messages name the offending file, the resolved target, and the fix ("import it from `sdk.js`; if the SDK doesn't export it, grow the façade — see src/plugins/CLAUDE.md").

Exception list: **empty**, and the guard has no mechanism for per-file exemptions beyond the two structural ones above (integration tests, bridge list). Regex-based specifier extraction (not a TS parser) matches the two existing guard tests' approach and is sufficient: imports are statically written in this codebase (enforced by ESM + NodeNext).

### D6: Sweep order — surface first, then imports, then guard

The guard lands **last** in the same change, after the tree is clean. No grandfathering, no temporary allowlist: a guard with holes codifies the leak. The sweep is mechanical (import-line rewrites; public names are unchanged) except `postQuestions.ts`, which additionally swaps the module-level `logger` for the `sdk.logger` it already receives.

## Risks / Trade-offs

- **[Import-graph weight]** Plugin files that were core-free (e.g. `renderPoints.ts`) start value-importing `sdk.js`. → Resolved structurally by D1b: post-split `sdk.ts` carries no core value imports at all, so value-importing it costs a few pure modules (zod schemas, envelope helpers), not the core graph. Verified by the full-suite run.
- **[Envelope formatting change]** casual-talk and idler's local `textResult` emitted compact JSON; the canonical implementation pretty-prints (`null, 2`). Unifying changes their tool-result whitespace. → Parse-identical JSON; Claude-facing only; all tests pass. Accepted as the cost of one implementation.
- **[Façade drift]** `sdk.ts` re-export block could rot (export removed while plugins still need it). → TypeScript catches removals at compile time (`npx tsc`); the guard prevents the workaround (importing from the implementation instead).
- **[Type-only coupling]** Re-exported types (`SlackBlocks`, `Block`) still couple plugin contracts to core shapes. → Accepted: the coupling exists either way (plugins render Slack blocks); the façade makes it visible and re-routable in one place.
- **[Guard false negatives]** Regex specifier extraction misses exotic forms (computed dynamic imports). → Accepted: the codebase has none; ESM static imports are the norm and the lint bans creative alternatives. The guard also scans generated `.js`? No — `.ts` sources only, matching how code enters the repo.
- **[Bigger `sdk.ts`]** The façade adds a re-export block to an already-large file. → Kept to a clearly-commented block of pure re-exports; implementations stay in their own files.

## Migration Plan

Single change, no data migration, no deploy steps beyond normal build:

1. Create `toolResults.ts` + `plugins-sdk/testHelpers.ts`; make `src/tools/helpers.ts` / `src/tools/testHelpers.ts` delegate.
2. Split `sdk.ts` per D1b (`plugins-sdk/internal/factory.ts` + `plugins-sdk/internal/cron.ts` + `plugins-sdk/internal/messaging.ts`; `registry.ts` → factory) and add the façade export block to the now-light `sdk.ts`.
3. Sweep plugin imports (prod → `sdk.js`, tests → `plugins-sdk/testHelpers.js`); delete duplicated helpers in casual-talk/idler (updating their internal call sites); fix `postQuestions.ts` logging; rename `trivia/integration.gating.test.ts` → `trivia/gating.integration.test.ts` so the seam test carries the escape-hatch suffix it was already using in spirit.
4. Land the guard test; update `src/plugins/CLAUDE.md`.
5. Full verification (`npm test`, `npx tsc`, oxlint/oxfmt). Rollback = revert the commit (no persisted-state implications).

## Open Questions

- None blocking. If the sweep surfaces an import the façade doesn't cover (something missed by the inventory), the resolution rule is already decided: add it to the façade (module export if pure, instance member if stateful) — never an exception in the guard.
