# Tasks — Enforce the Plugin SDK Boundary

## 1. New SDK-layer surface

- [x] 1.1 Create `src/plugins-sdk/toolResults.ts` (leaf): move `textResult`, `errorResult`, `MAX_TOOL_OUTPUT_CHARS` implementations from `src/tools/helpers.ts`; add `src/plugins-sdk/toolResults.test.ts` (envelope shape, error flag, byte-parity with prior behavior)
- [x] 1.2 Make `src/tools/helpers.ts` delegate (`export { ... } from "../plugins/toolResults.js"`) — zero changes at core call sites; keep any core-only helpers it exports in place
- [x] 1.3 Create `src/plugins-sdk/testHelpers.ts`: move `parseToolResult` + `toolResultText` implementations from `src/tools/testHelpers.ts` (fixing the `as unknown as` double-cast with a proper narrowing guard); make `src/tools/testHelpers.ts` delegate; add `createClackSdk` / `createMemorySurface` passthroughs for plugin tests
- [x] 1.4 Split `sdk.ts` per design D1b: implementation → `plugins-sdk/internal/factory.ts` (+ `plugins-sdk/internal/cron.ts` / `plugins-sdk/internal/messaging.ts` surface extractions following the `sdkUsers`/`sdkMemory` pattern); `sdk.ts` becomes import-time light (type-only imports); `registry.ts` imports the factory; SDK-layer tests (`sdk.test.ts`, `sdk.i18n.test.ts`) import the factory directly
- [x] 1.5 Add the façade export block to `sdk.ts`: `toolResults`, `zodErrorToResult` + `Result`, image-search result contract, `BlockSchema` + `ALLOWED_BLOCK_TYPES` + `type Block`, `validateBlocks` + `type BlockValidationError`, `postStructuredMessage` + `notificationText` (+ opts/result/client types), `type SlackBlocks`, cron persistence types (`CronJob`, `SkipDate`, `CreateCronJobParams`, `UpdateCronJobParams`) — original names and signatures preserved

## 2. Import sweep — plugins onto the façade

- [x] 2.1 Sweep `textResult`/`errorResult` imports from `src/tools/helpers.js` → the correct relative path to `src/plugins-sdk/sdk.js` per file depth, across ALL plugins (trivia, giphy, tenor-gif, image-search plugins); verify with `npx tsc`
- [x] 2.1b Sweep direct SDK-layer leaf imports (`zodResult.js`, `imageSearchResult.js`) in plugin files onto `sdk.js` — legal previously under the leaf exception, forbidden under one-surface
- [x] 2.2 Sweep the `SlackBlocks` type imports (`answerTypes/*`, `renderPoints.ts`, `renderHint.ts`) and `setRevealNarrative.ts`'s `BlockSchema` import onto `sdk.js`
- [x] 2.3 Rework `src/plugins/trivia/tools/questions/postQuestions.ts`: block tooling + `SlackBlocks` from `sdk.js`; replace the direct `src/logger.js` import with the `sdk.logger` in scope (widened the `Pick<ClackSdk, ...>` with `"logger"`)
- [x] 2.4 Delete duplicated `textResult`/`errorResult` modules `src/plugins/casual-talk/helpers.ts` and `src/plugins/idler/helpers.ts`; switch their 10 call-site files to the façade import (envelope moves from compact to pretty-printed JSON — parse-identical)
- [x] 2.5 Sweep plugin test files importing `parseToolResult` from `src/tools/testHelpers.js` → `plugins-sdk/testHelpers.js`; retarget `createClackSdk` test imports (plugin tests → `plugins-sdk/testHelpers.js`; mixed value/type imports split so types keep coming from `sdk.js`); rename `trivia/integration.gating.test.ts` → `trivia/gating.integration.test.ts` (it is a deliberate seam test — the escape-hatch suffix now says so)
- [x] 2.6 Pre-guard audit (full inventory, not a spot check): resolving scan over ALL of `src/plugins/*/` confirmed zero remaining escapes outside `*.integration.test.ts` (`CLEAN`)

## 3. Guard + docs

- [x] 3.1 Add `src/plugins-core/pluginBoundary.guard.test.ts`: per design D5 — walk plugin dirs, extract specifiers (static + export-from + dynamic import), resolve relatives, enforce the one-surface rule; integration-test exemption; prod-file ban on `plugins-sdk/testHelpers.js`; SDK-layer bridge/leaf discipline + stale-bridge-list assertion; empty exception list; actionable failure messages
- [x] 3.2 Update `src/plugins/CLAUDE.md`: one-surface rule in hard rules, guard test named as enforcement (dropped "a future lint/check may enforce"), sanctioned-façade exception to the no-re-export rule, "grow the façade" remedy
- [x] 3.3 Search root `CLAUDE.md` for stale references: `zodErrorToResult` note updated to the `plugins-sdk` path; `zod-inventory.md` row updated; no other references found
- [x] 3.4 Three-layer relocation (design D1c): create `src/plugins-sdk/` (surface top-level + `internal/` implementation) and `src/plugins-core/` (registry, state, guard); `src/plugins/` now holds only plugin dirs; resolution-based codemod rewrote all 200+ affected import specifiers; stale comments and docs updated
- [x] 3.5 Partial oxlint rule (design D6b): `no-restricted-imports` override on `src/plugins/**/*.ts` banning `**/plugins-sdk/internal/**` and `**/plugins-core/**`, ordered before the integration-test escape hatch; verified it fires with the boundary message

## 4. Verification

- [x] 4.1 `npm test` — full suite green (7446 passed, 0 failed), including the new guard and leaf tests
- [x] 4.2 `npx tsc --noEmit` clean; `npx oxlint` clean on `src/plugins` + delegating core helpers; `npx oxfmt` run on all new/heavily-edited files
- [x] 4.3 Grep audit: `export function textResult` has exactly one definition (`src/plugins-sdk/toolResults.ts`); resolving boundary scan reports `CLEAN`
- [x] 4.4 Run `graphify update .` to refresh the knowledge graph
- [x] 4.5 Phase-4 review fixes: negative-case guard tests (classification helpers exercised with synthetic specs), `plugins-sdk/testHelpers.test.ts`, `Pick`-narrowed deps on `createCronSurface`/`createMessagingSurface` (ISP, matching the users/memory pattern), root `CLAUDE.md` source-tree entries for the new layers, gemini-image `errorResult` → `plainErrorResult` (name no longer shadows the SDK helper with different envelope semantics)
