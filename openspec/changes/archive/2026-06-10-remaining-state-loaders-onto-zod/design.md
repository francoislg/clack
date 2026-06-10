## Context

Seven persisted-state JSON loaders still hand-roll validation (full classification in `zod-inventory.md`). All are **graceful**: on a missing file, parse error, or shape mismatch they log and return a default (`[]`, `null`, basename defaults) — they never throw to abort startup. Five carry bespoke type guards (`isQuarantineRecord`, `isValidSessionState`, `isValidMetaShape`) or sanitizers (`sanitizeLoadedJobs`); two are blind `as` casts (`errorReports`, `skillPlugins`). This mirrors Change 3, which already shipped the pattern for `workers/persistence.ts` / `roles.ts` / `userPreferences.ts`.

## Goals / Non-Goals

**Goals:**

- One zod schema per on-disk shape (shape + semantics + defaults), reused as the single validator. Hand-rolled guards/casts and ad-hoc default-filling collapse onto it.
- Identical graceful behavior: every loader still returns its current default/`null` on bad input and logs the same way; accepted shapes (including legacy on-disk data) are unchanged.
- Reuse `src/plugins/zodResult.ts` for any error formatting in log lines, matching Change 3's wording style.

**Non-Goals:**

- Changing on-disk formats, field names, defaults, or which inputs are tolerated.
- Touching `sessions.ts` (Change 4), boot config (Change 2), migrations, or external-API parsers.
- Converting fail-fast write-time input validators beyond what each loader needs (the `userSkills` slug/description rules are folded in only because they share the meta shape).

## Decisions

### Decision 1: Mirror Change 3 exactly (proven pattern)

Use the same shape Change 3 used for `workers/persistence.ts`: `const result = schema.safeParse(JSON.parse(raw)); if (!result.success) { logger.warn(\`<file> has unexpected shape; <fallback>: ${zodErrorToResult(result.error, "<label>").error}\`); return <default>; } return <map result.data>`. Date/`Date`-coercion stays in a `fromPersisted`-style mapper or a `.transform()`, as in `persistence.ts`.

### Decision 2: Tests are the gate (they already exist)

Six of seven loaders have unit tests asserting the graceful path (corrupt JSON → default, valid → parsed). Run them unchanged before and after each migration — they are the parity proof. `errorReports.ts` has none; add a small loader test (valid → record, missing/corrupt → `null`) as part of this change so it is gated too.

### Decision 3: Schemas must accept legacy on-disk data

These files hold live state written by older builds. Each schema models optional/legacy fields with `.optional()`/`.default()` (e.g. `cronJobs` legacy nameless jobs, `autoRespond` partial state) so a real saved file round-trips. Add a fixture test per loader using a representative real-world sample. If a schema would reject existing data, widen the schema — never the reverse.

### Decision 4: Independent, low-coupling — migrate one loader at a time

The seven loaders share no state. Each is a self-contained edit + its own green test run; they can land in any order or be split across PRs. No cross-loader barrier.

## Risks / Trade-offs

- **State-wipe risk** → a too-strict schema silently discards a real file (lost cron jobs, dropped auto-respond rules, abandoned in-flight change sessions). Mitigation: fixture round-trips over real samples + the existing graceful-path tests; widen schemas to fit observed data.
- **`cronJobs` is the meatiest** → nested `runs[]`, `skipDates[]`, enum `submitResponseMode`, legacy nameless jobs. Model it carefully and lean on `cronJobs.test.ts` (roundtrip + legacy + enum cases).
- **Over-reach** → resist schematizing things the loader doesn't read (e.g. `getSessionTrace` SDK format, trivia issue-collecting config). Scope is exactly the seven loaders.
