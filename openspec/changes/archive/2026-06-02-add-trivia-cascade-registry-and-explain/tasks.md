## 1. Characterization safety net (land first)

- [x] 1.1 Add characterization tests snapshotting resolution outcomes across a config matrix (seasons on/off, format present/absent, overrides at slot/season/game/workspace) for BOTH consumers: `get_ideas` (generation axes) and `post_questions` (`liveAnswersVisible`, `revealResponses`) — capture value + tier per axis
- [x] 1.2 Add characterization tests snapshotting `list_games` `axisOverrides` + `workspaceDefaults` for the same matrix. Capture the current `promptMedium` gap as a baseline assertion via `it.todo`/`it.skip` (or a snapshot with a `// gap: list_games omits promptMedium — flips green at 6.2` comment); it becomes a passing acceptance test after task 6
- [x] 1.3 Run `npm test` and confirm the new snapshots pass against current code

## 2. CascadeAxes definition + registry (additive, inert)

- [x] 2.1 Create `core/cascadeAxes.ts` with the `CascadeAxes` interface. 13 members (per design D1, "resolves through the per-question slot/season cascade"): weighted (`answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`), flat (`hint`, `judgeLeniency`), string (`instructions`, `additionalInstructions`), post-time (`liveAnswersVisible`, `revealResponses`). Deliberately EXCLUDE: structural-special `format`/`categories`/`theme`, `allTimeRow` (game+workspace only), `choices` (workspace-only), and identity fields — leave them on the individual tier types
- [x] 2.2 Define `AxisDef`, `CascadeKind`, `CascadeContext`, `CascadeTier`, `CascadeResolution` types in `core/cascadeAxes.ts`
- [x] 2.3 Declare `AXIS_REGISTRY` with `satisfies Record<keyof CascadeAxes, AxisDef>`; populate `kind` + `default` for every axis in 2.1's set (defaults copied verbatim from existing `DEFAULT_*` constants — e.g. `DEFAULT_PROMPT_MEDIUM_WEIGHTS`, hint `{ mode: "none" }`, judgeLeniency `"strict-with-typos"`)
- [x] 2.4 Mark `difficulty`, `difficultyRatio`, and `additionalInstructions` as `kind: "custom"` with a `customResolve` pointer (the first two are answersFormat-keyed; `additionalInstructions` is cumulative across tiers)
- [x] 2.5 Unit test: registry default for each axis equals its legacy `DEFAULT_*` constant
- [x] 2.6 Unit test: deliberately add a temp axis to a local `CascadeAxes` copy and assert `tsc` would reject a missing registry entry (or document via a `// @ts-expect-error` fixture)

## 3. Generic resolver

- [x] 3.1 Create `domain/resolveCascade.ts` implementing first-wins walk over `slot → season → game → workspace → default`, returning `{ value, tier, ladder }`
- [x] 3.2 Route `custom` axes through their `customResolve`, returning the same `{ value, tier, ladder }` shape. `difficulty` per-field merge and `additionalInstructions` cumulative concat both report `tier: "merged"` when spanning >1 tier (ladder records the supplying tier per field / per segment). `difficulty`/`difficultyRatio` resolution is per-`answersFormat`
- [x] 3.3 Unit tests for `resolveCascade`: slot/season/game/workspace/default precedence, ladder correctness, custom-axis path

## 4. Tier types extend CascadeAxes

- [x] 4.1 Make `TriviaGame`, `SeasonEntry`, `SeasonFormatSlot`, `TriviaConfig` extend `CascadeAxes` in `core/configTypes.ts`; remove now-duplicated axis field declarations
- [x] 4.2 Run `npx tsc` to zero errors and confirm the load-bearing `AXIS_REGISTRY satisfies Record<keyof CascadeAxes, AxisDef>` constraint holds before proceeding to §5 (expected minimal fallout — fields already match)

## 5. Repoint the two production consumers (hot paths)

- [x] 5.1 Build a `CascadeContext` in `get_ideas` from the already-loaded `currentSeasonEntry`, resolved slot, `gameEntry`, `config`
- [x] 5.2 Replace the inline `resolveX()` calls in `get_ideas` with `resolveCascade(key, ctx).value`, keeping thin shims for the resolvers other in-plugin modules still import (e.g. `saveQuestion` imports `resolveJudgeLeniency`) — internal callers only; the plugin boundary means no external consumers exist
- [x] 5.3 Repoint `post_questions` (`postQuestions.ts:333,339`) to `resolveCascade("liveAnswersVisible", ctx)` / `resolveCascade("revealResponses", ctx)` — the existing `core/*Resolver.ts` param object is already the `CascadeContext` shape, so build the ctx and swap the calls
- [x] 5.4 Run the §1.1 characterization tests for BOTH consumers — outcomes MUST be byte-for-byte identical
- [x] 5.5 Keep difficulty/difficultyRatio/additionalInstructions behavior identical (custom resolvers), verified by characterization tests

## 6. Repoint list_games via registry

- [x] 6.1 Project `axisOverrides` and `workspaceDefaults` by iterating `AXIS_REGISTRY` keys instead of the hand-list
- [x] 6.2 Confirm `promptMedium` now surfaces; flip the §1.2 pending assertion to passing
- [x] 6.3 Update the `list_games` tool DESCRIPTION to note axis coverage is registry-driven (English, VIA-CLAUDE)
- [x] 6.4 Add `listGames.promptMedium.test.ts` covering game-tier + workspace-tier surfacing

## 7. explain_cascade tool

- [x] 7.1 Create `tools/games/explainCascade.ts`: args `{ game, slot?, answersFormat? }`, validate game via `requireGame` (structured error on unknown game), resolve effective format + slot range (reuse get_ideas helpers). Return shape: with `slot` → one resolution set; no `slot` + format present → one set per slot; no `slot` + no format → single null-coordinate set
- [x] 7.2 Build `CascadeContext` (load season state, `findCurrentSeason`; season tier contributes `undefined` when `seasons.enabled` is false) and return per-axis `{ value, tier, ladder }` for every registry axis
- [x] 7.3 Implement the resolved `answersFormat` handling (design D4): optional `answersFormat` arg; render `difficulty`/`difficultyRatio` for every `answersFormat` by default, or the single supplied value when given
- [x] 7.4 Register `explain_cascade` on the always-on default server, gated to `member` (alongside `createListGamesTool` in `index.ts`); add its `label.*` i18n key
- [x] 7.5 Tests: slot-level resolution, game-level per-slot array (format present), game-level single set (no format), unknown-game error, slot-out-of-range error, seasons-disabled season tier, provenance matches `get_ideas`

## 8. Parser parity + cleanup

- [x] 8.1 Confirm no data migration is needed: config field names are unchanged (axes stay `promptMedium`, `hint`, … on game/season/workspace) — the refactor only relocates them into a shared base type. Verify existing `config.json` files parse unchanged; document "no migration required (backward-compatible, names unchanged)" in the change. Create a migration via `/create-migration` only if a parse incompatibility is found
- [~] 8.2 SUBSTITUTED — did NOT derive `TriviaAxisBag` from `CascadeAxes` (cosmetic). The runtime parity test (8.3) provides the actual config-accepts⇄registry guarantee, which is the point; the type-level derivation is unnecessary churn given the test.
- [x] 8.3 Add a structural parity test asserting the UNION of parser-accepted `CascadeAxes`-member keys (weighted bag + directly-parsed flat/string axes) equals `keyof CascadeAxes` (note: `allTimeRow` is parsed directly but is NOT a member, so it is excluded from the parity set)
- [ ] 8.4 DEFERRED (low-value cleanup). Only 4 first-wins resolvers are now fully unused (`resolvePromptMedium`, `resolveHintConfig`, `resolveLiveAnswersVisible`, `resolveRevealResponses`); the rest (`resolveAnswersFormat`, `resolveQuestionType`, `resolveFreeformAnswerShape`, `resolveContexts`, `resolveJudgeLeniency`, `resolveInstructions`) still have legit callers (saveQuestion / reveal / freeform handler). All legacy resolvers are pinned by the equivalence test (`resolveCascade.test.ts`) so they cannot drift from the walker. Full deletion would require repointing those remaining callers too — deferred as a follow-up; nothing is broken.
- [x] 8.5 Run `npx tsc`, `npx oxlint`, `npx oxfmt --check`, and full `npm test` — all green

## 9. Documentation

- [x] 9.1 Update `CLAUDE.md` trivia section: cascade now resolves through `CascadeAxes` + `AXIS_REGISTRY` + `resolveCascade`; document `explain_cascade`
- [x] 9.2 Update `.claude/skills/add-trivia-attribute/SKILL.md` to point new axes at `CascadeAxes` + `AXIS_REGISTRY` as the single touch-point (collapsing its multi-file per-axis checklist). Note: there is no `src/plugins/trivia/CLAUDE.md` today — top-level `CLAUDE.md` (9.1) and the skill are the docs to update; the skill lives outside the plugin tree so editing it does not cross the plugin boundary
