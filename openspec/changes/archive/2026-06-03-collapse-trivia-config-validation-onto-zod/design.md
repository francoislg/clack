## Context

Trivia config validation runs two parallel layers over the same shapes (see proposal). The zod layer (`configParsers/axes.ts` ~574–700, `format.ts` ~305–350) is intentionally thin — it only checks structure and allowed keys. The hand-rolled `Result<T>` layer (`axes.ts` ~30–489, `format.ts` ~51–294) owns every semantic rule: trim + reject-empty for strings, dedup-preserving-order for `categories`, weight maps non-negative + ≥1 strictly positive, `[min,max]` range tuples (1–10, min≤max), and the labeled `'field.path' must …` error strings.

Two consumers depend on the `Result<T>` layer:

- **File-load path** (lenient): `parseTriviaConfigObject` → `parseTriviaGames` → `parseTriviaGame` → `parseTriviaAxisBag` + `validateFormat`/`validateSlotConfig`/`normalize*`. Accumulates `ParseIssue[]`, logs warnings, drops bad fields but keeps the game.
- **Tool path** (strict): `upsert_game` / `upsert_season` run zod (structural) then call the same `validate*` functions and `errorResult(issues.join("; "))` on any failure.

The `Result<T>` type is declared twice (`configParsers/axes.ts:31`, `domain/seasonFormat.ts:21` as `ValidateResult<T>`).

This is Change 1 of a sequenced sweep. It must produce a shared, core-located helper that Changes 2–4 (main config/MCP, persisted-state loaders, sessions.ts) reuse — so the helper is designed here against the hardest consumer, the Claude-facing labeled-path contract.

## Goals / Non-Goals

**Goals:**

- One rich zod schema per concept = single source of truth for shape AND semantics.
- A core `src/zodResult.ts` exporting `zodErrorToResult(error, fieldLabel)` + the canonical `Result<T>` type, importable by core and plugins alike.
- Both consumers (file-load lenient, tool strict) converge on `schema.safeParse()` → `zodErrorToResult`.
- Byte-for-byte preservation of the existing accept/reject behavior and error strings, proven by a characterization test written first.
- Delete the hand-rolled `validate*` functions and the duplicate `Result<T>`/`ValidateResult<T>` once unreferenced.

**Non-Goals:**

- Changing any observable validation behavior, message wording, or which fields are accepted/dropped.
- Migrating main config, MCP, or persisted-state loaders — those are downstream changes that only depend on `src/zodResult.ts` existing.
- Reworking the cascade registry (`AXIS_REGISTRY`), the resolution path, or `buildCascadeContext`.
- Touching `sessions.ts` legacy synthesis (deferred to its own gated change).

## Decisions

### Decision 1: Helper is a shared SDK-layer LEAF module (`src/plugins/zodResult.ts`)

Three locations were tried; only the third works:

1. **Core `src/zodResult.ts` imported by trivia** — rejected: Plugin Hard Rule #1 forbids trivia importing bot core.
2. **A value export of `src/plugins/sdk.ts`** — rejected at implementation time: a *value* import of the heavy `sdk.ts` barrel from trivia's deeply-loaded config core forms a runtime cycle (`axes → sdk → slack/app → registry → trivia/index → configBridge → games → format → axes`, still initializing → `answersFormatZod` reads as `undefined`). Existing trivia code only ever imports `sdk.ts` **type-only** (erased) for exactly this reason; `zodErrorToResult` is a value and can't be type-only.
3. **A dependency-free leaf beside `sdk.ts` (`src/plugins/zodResult.ts`)** — chosen. It imports only `zod`, so it cannot participate in a cycle. It is part of the SDK surface (documented as an allowed import in `src/plugins/CLAUDE.md`), so plugins import it directly; and bot core already depends on the SDK layer (`registry.ts`), so the downstream core changes import the SAME module. ONE definition, shared by plugins and core — no duplication.

- **`Result<T> = { ok: true; value: T } | { ok: false; error: string }`** — exported from the leaf; trivia's `configParsers/axes.ts` `Result<T>` and `domain/seasonFormat.ts` `ValidateResult<T>` are both replaced by an import of it.
- **`zodErrorToResult(error, fieldLabel)`** — maps `error.issues` to one joined string whose paths read `fieldLabel.a.b[0]`, matching today's hand-built labels.
- **Named exports, not an `sdkZodTypes` object** — `Result` is a type (can't live in a runtime object) and named exports tree-shake.

### Decision 2: Semantics move INTO zod, via `superRefine` for byte-exact parity

The original plan was declarative `.refine(allNonNeg && anyPositive, msg)` etc. **Verified during implementation (task 1):** the hand-rolled validators emit a SINGLE, value-interpolated, short-circuited error — `must be a non-negative integer (got 1.5)`, `contains unknown key 'bogus' (allowed: boolean, choice, freeform)`, `min (5) must be <= max (3)`. Reproducing these byte-for-byte (the parity gate) means a chain of independent `.refine`s won't do — zod collects ALL issues, and `.refine` messages can't easily interpolate the offending value or the allowed-key list at the right path. So each weight-map / range / config schema carries a **`superRefine`** (zod v4 `.check`) that mirrors the validator's imperative order and pushes exactly one `ctx.addIssue({ path, message })` per failure mode:

- Weight maps → `superRefine`: unknown-key (path `[]`) → per-key non-negative-integer (path `[key]`, message embeds `JSON.stringify(value)`) → all-zero (path `[]`), then `.transform` to fill missing keys to 0.
- String axes (`instructions`, `theme`, `label`, `additionalInstructions`) → `.transform(s => s.trim())` + `.refine(len>0, msg)` (single rule, value-free message — `.refine` suffices here).
- `categories` → `.transform(dedupePreservingOrder)` + `.refine(a => a.length > 0, msg)`.
- `difficulty` ranges → `superRefine` reproducing `[min,max]` tuple shape, per-index `[0]`/`[1]` range messages, and the `min <= max` cross-field message.
- `slotOverrides` → `z.record(z.string().regex(/^\d+$/), slotSchema)` where `slotSchema` carries all the above.
- The per-rule MESSAGE (everything after the quoted path) lives on the schema; the PATH prefix (`format.questions[0].…`) is applied by `zodErrorToResult(err, fieldLabel)` from `issue.path`. Same split as today (per-rule message + caller-supplied prefix).

**Consequence for sequencing:** because enriching a schema makes the tool-arg boundary reject earlier (before the handler/validator runs), a schema's enrichment, its tool's switch to `safeParse` + `zodErrorToResult`, and the matching validator's deletion must land **together per concept** — not "enrich in place while the old validators still run after zod." The characterization test is re-run after each concept's cutover.

### Decision 3: Characterization test is written and committed FIRST

Before any schema work, snapshot the current validators' behavior: a table of representative inputs (valid + each rejection mode) × expected `{ ok, error }`. This test imports the OLD `validate*` functions. After migration it is re-pointed at the new schema path and must still pass unchanged — that is the parity proof. Existing `*.test.ts` files asserting exact strings stay as a second guard.

### Decision 4: Sequence within the change

1. Characterization test (over current validators).
2. `src/zodResult.ts` + rich schemas, built ALONGSIDE the existing validators (no behavior change, nothing deleted).
3. Migrate tool arg paths: drop the post-zod `validate*` calls; arg schema now fully validates.
4. Migrate `parseTriviaGames` / season / workspace parse paths to `.safeParse()` + `zodErrorToResult`.
5. Delete dead `validate*` / `normalize*` / duplicate `Result` types; fold their unit tests into schema tests.
6. Green gate: `tsc` / `oxlint` / `oxfmt` / `npm test` + characterization test.

## Risks / Trade-offs

- **Error-message parity drift** → Characterization test (Decision 3) written first; existing string-asserting tests retained.
- **zod v4 `.trim()`/`.transform()` message ordering differs from hand-built strings** → where `.trim().min(1, msg)` can't reproduce the exact wording, use `.refine` with the literal legacy message; the char test catches mismatches.
- **zod `.optional()` infers `T | undefined`, a handler may have assumed a present value** → `exactOptionalPropertyTypes` is NOT enabled (tsconfig has `strict` only), so optional-key ⇄ `| undefined` is interchangeable and the risk is limited to `strictNullChecks` narrowing; audit the inferred tool-arg types against handler expectations after step 3.
- **Lenient vs strict divergence** — both paths must share the SAME schema; only the wrapping differs (file-load accumulates + logs, tool throws). Risk that one path skips a refinement → mitigated by both calling `safeParse` on the identical schema object.
- **Helper over-fitted to trivia's labeled-path need** → keep `zodErrorToResult` generic (path + message only); downstream graceful loaders can ignore the label and just read `.error`.
