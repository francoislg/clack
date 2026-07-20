# Enforce the Plugin SDK Boundary

## Why

The plugin hard rules (`src/plugins/CLAUDE.md`) say plugins must never import bot core, but nothing enforces them — and the tree has drifted three different ways around the same missing SDK surface: trivia crosses the boundary outright (~30 prod files import `textResult`/`errorResult` from `src/tools/helpers.js`; `postQuestions.ts` reaches for `slack/blockSchema`, `blockValidate`, `messagePoster`, and the core `logger`; 7 files type-import `SlackBlocks` from `src/slack/blocks.js`), casual-talk and idler each carry a drift-prone local copy of `textResult`, and 64 test files import `parseToolResult` from `src/tools/testHelpers.js`. The documented safety net is literally "code review and grep". This change makes `sdk.ts` the single surface plugins import from and makes the boundary statically enforced, so drift becomes impossible rather than review-dependent.

## What Changes

- **Three-layer restructure**: `src/plugins/` keeps ONLY plugin directories; a new `src/plugins-sdk/` holds the SDK (top-level surface files + `internal/` implementation); a new `src/plugins-core/` holds the plugin loader (`registry.ts`, `state.ts`) and the guard.
- **One-surface rule**: a file under `src/plugins/<name>/**` may import only (1) its own plugin's files, (2) top-level files of `src/plugins-sdk/` (usually the `sdk.js` façade; `testHelpers.js` from test files only; never `internal/**`), (3) npm packages, (4) node builtins. `*.integration.test.ts` files keep their existing cross-boundary escape hatch.
- **SDK façade grows to cover every legitimate need** (module-level exports on `sdk.ts`):
  - `textResult`, `errorResult`, `MAX_TOOL_OUTPUT_CHARS` — implementation moves to a new SDK-layer leaf `src/plugins-sdk/toolResults.ts`; core `src/tools/helpers.ts` consumes it too (single implementation).
  - Re-exports of the existing SDK-layer leaves: `zodErrorToResult` (from `zodResult.ts`) and the image-search result contract (from `imageSearchResult.ts`).
  - Block tooling re-exports: `BlockSchema`, `validateBlocks`, `postStructuredMessage`, `notificationText`, and the `SlackBlocks` / `Block` types.
- **New test surface** `src/plugins-sdk/testHelpers.ts` exporting `parseToolResult` (single implementation shared with `src/tools/testHelpers.ts`).
- **Sweep all plugin imports** to the new surface; delete the duplicated `textResult` copies in `casual-talk/helpers.ts` and `idler/helpers.ts`; switch `postQuestions.ts`'s direct `logger` import to `sdk.logger`.
- **Static guard test** (repo's established guard-test pattern) that resolves every import specifier under `src/plugins/<name>/**` and fails on any violation of the one-surface rule, with an empty exception list. Runs in `npm test` → enforced by the lefthook pre-commit hook.
- **Partial oxlint rule** (in-editor sugar, not the authority): a `no-restricted-imports` override on `src/plugins/**/*.ts` banning the two textually-unambiguous patterns `**/plugins-sdk/internal/**` and `**/plugins-core/**`.
- **Docs**: rewrite the `src/plugins/CLAUDE.md` hard-rules section around the one-sentence rule and replace "a future lint/check may enforce these rules" with a pointer at the guard test. Note the sanctioned-façade exception to the global no-re-export rule.

## Capabilities

### New Capabilities

- `plugin-sdk-boundary`: the one-surface import rule for plugin code, the SDK façade's module-export surface (tool results, block tooling, leaf re-exports), the test-helper surface, and the static guard that enforces it all.

### Modified Capabilities

<!-- none — clack-plugins' existing requirements (namespacing, contract, handles) are untouched; the new boundary/façade requirements live in the new capability spec -->

## Impact

- **New files**: `src/plugins-sdk/toolResults.ts`, `src/plugins-sdk/testHelpers.ts`, `src/plugins-core/pluginBoundary.guard.test.ts` (+ unit tests for the new leaf).
- **Modified**: `src/plugins/sdk.ts` → split and moved (`src/plugins-sdk/sdk.ts` light façade + `plugins-sdk/internal/` implementation), `src/tools/helpers.ts` + `src/tools/testHelpers.ts` (delegate to the SDK-layer implementations), ~37 plugin prod files (import sweep), ~64 plugin test files (import sweep), `src/plugins/casual-talk/helpers.ts` + `src/plugins/idler/helpers.ts` (drop duplicated envelope helpers), `src/plugins/trivia/tools/questions/postQuestions.ts` (sdk.logger + façade imports), `src/plugins/CLAUDE.md`.
- **No runtime behavior change** anywhere — every move is a re-home or re-export; the guard is test-only.
- **Risk**: plugin files that were previously core-free start (transitively) importing `sdk.ts`; `sdk.ts` is import-time side-effect free, but its own imports must stay inert — verified during the sweep (unit tests of swept files would fail loudly otherwise).
