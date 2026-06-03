## Why

Trivia config validation in `src/plugins/trivia/core/configParsers/` has **two parallel layers** for the same shapes:

- **zod schemas** (`seasonFormatSlotZod`, `seasonFormatZod`, `slotOverridesZod`, the axis `*Zod`) — used as MCP tool-arg schemas (the SDK requires zod at the tool boundary).
- **hand-rolled `Result<T>` validators** (`validateFormat`, `validateSlotConfig`, `validateSlotOverrides`, `validateAnswersFormatMap`, …) — used by the `parseTriviaGames` workspace-config parser (which is entirely `Result`-based, not zod) AND by the tools *after* zod for the deeper semantics zod's thin schemas skip (trim, dedup, weight maps non-negative & ≥1 positive, labeled `'field.path' must…` errors).

The shape rules are therefore stated twice, and a field can drift between the zod schema and the validator. Discovered while adding `slotOverrides` in `unify-trivia-cascade-resolution`, where the dual layer had to be extended again. The `Result<T>` type is itself declared twice (`configParsers/axes.ts` and `domain/seasonFormat.ts` as `ValidateResult<T>`).

This is **Change 1 of a sequenced "config validation onto zod" sweep** (trivia → main config/MCP → persisted-state loaders). It collapses the trivia dual-layer AND introduces the `zodErrorToResult` helper, designed against the hardest consumer (the labeled `'field.path' must…` contract Claude sees through MCP tools).

> **Boundary note:** Plugin Hard Rule #1 (`src/plugins/CLAUDE.md`) forbids plugin code from importing bot core. The helper therefore lives as a **shared SDK-layer leaf module** — `src/plugins/zodResult.ts`, importing only `zod`. It is NOT defined inside `sdk.ts`: a value import of that heavy barrel from trivia's config core cycles (`sdk → slack/app → registry → trivia → configBridge → … → axes` mid-init). A dependency-free leaf beside `sdk.ts` is cycle-safe and shared by both plugins (trivia now) AND bot core (the downstream changes), so there is exactly ONE definition — no per-plugin or per-change duplication.

## What Changes

- Add `src/plugins/zodResult.ts` (shared SDK-layer leaf) exporting `Result<T>` and `zodErrorToResult(error, fieldLabel)` — `zodErrorToResult` formats a `ZodError`'s `issues` into the `{ ok: false; error: string }` shape with `fieldLabel.a.b[n]`-style paths. Trivia imports it directly; the boundary is documented in `src/plugins/CLAUDE.md`.
- Express the per-slot / format / axis-map validation as **rich zod schemas** (`.refine()` for weight-positivity, `.transform()` for trim/dedup, custom error messages for the labeled paths), so shape + semantics live in ONE schema per concept.
- Convert `parseTriviaGames` (and the season/workspace parse paths) to `.safeParse()` against those schemas, running failures through `zodErrorToResult`, instead of calling the hand-rolled validators.
- Retire `validateFormat` / `validateSlotConfig` / `validateSlotOverrides` / the `validate*Map` helpers and the duplicate `Result<T>`/`ValidateResult<T>` declarations once nothing calls them.
- Preserve the existing labeled error-message contract (tests assert exact strings) — gated by a characterization test snapshotting today's accept/reject + error strings BEFORE the migration.

## Capabilities

### Modified Capabilities

- `trivia-games`, `trivia-seasons`: config validation is schema-driven; observable accept/reject behavior and error messages are preserved.

## Impact

- Code: new `src/plugins/zodResult.ts` (shared leaf); `core/configParsers/axes.ts` + new `core/configParsers/axisCheckers.ts` (axis validators reimplemented as zod-backed adapters); `domain/seasonFormat.ts`. The `validate*` signatures are preserved, so the tools and the lenient file-load parser consume the collapsed layer unchanged.
- Tests: every `*.test.ts` asserting validator error strings must still pass (or be updated in lockstep); new characterization test added first.
- Risk: error-message parity is the main hazard — the characterization test gates the migration. zod `.optional()` infers `T | undefined`; verify inferred tool-arg types still match handler expectations (`exactOptionalPropertyTypes` is NOT enabled, so the concern is limited to `strictNullChecks`).
- Out of scope for `unify-trivia-cascade-resolution` (which kept the dual-layer pattern deliberately); this is the dedicated cleanup. Downstream changes (main config/MCP, persisted-state loaders, sessions.ts) are separate proposals that REUSE the shared `src/plugins/zodResult.ts` leaf introduced here rather than each defining their own.
- Scope note: this change collapses the AXIS validators (the genuine dual-layer — weight maps, ranges, enums, hint, choices) onto zod. `format.ts`'s slot/format orchestration and the `normalize*` string helpers stay thin and delegate axis validation to the collapsed layer; they were never a parallel rich-zod layer.
