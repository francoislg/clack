## Context

Several persisted-state JSON loaders hand-roll shape validation with bespoke type guards, then degrade gracefully (log + return default/`null`) on mismatch — distinct from the fail-fast config path. An earlier investigation triaged them:

- **GOOD candidates (single clean shape, low risk):** `src/workers/persistence.ts` (`isObject`/`isStatus`/`isPersistedWorker`/`isWorkersState` guards + ISO-date→`Date`), `src/roles.ts` (`JSON.parse` + `?? DEFAULTS`), `src/userPreferences.ts` (assert + per-key defaults; carries the deprecated-but-inert `dmOptOut`).
- **LOW-VALUE (thin single-field guards, folded in):** `src/changes/persistence.ts` `isValidSessionState` (3-field presence check), `src/cronJobs.ts` `sanitizeLoadedJobs` (`submitResponseMode` enum guard).
- **EXCLUDED:** `src/sessions.ts` — 3 on-disk eras + heavy legacy synthesis; deferred to `sessions-loader-onto-zod` (Change 4).

This is Change 3 of the sweep; it reuses `src/plugins/zodResult.ts` from Change 1.

## Goals / Non-Goals

**Goals:**

- Replace the per-module type guards with one zod schema per persisted shape, parsed via `safeParse`.
- Preserve graceful-degradation: on parse failure, log a warning and return the existing default/`null` — never throw, never reject real saved data.
- Fold in the two thin guards (`changes/persistence`, `cronJobs`) as small schemas.
- Keep reading OLD on-disk data unchanged, including the inert `dmOptOut` preference.

**Non-Goals:**

- `sessions.ts` legacy synthesis (Change 4).
- Changing on-disk formats, defaults, or the degradation contract (still log + fallback).
- Runtime reconciliation logic in `workers/persistence.ts` (disk-vs-state, orphan adoption) — that's not parsing.

## Decisions

### Decision 1: One schema per persisted shape; `safeParse` + log + fallback

`WorkersState`/`PersistedWorker` (enum `status`, ISO-date strings via `.transform(s => new Date(s))`), `RolesConfig` (`.default()` per field), the user-preferences map (`z.record(userId, prefsSchema)` with `dmOptOut` accepted-but-optional). Each loader becomes: `const parsed = schema.safeParse(json); if (!parsed.success) { logger.warn(...); return DEFAULT; } return parsed.data;`.

### Decision 2: Preserve backward-compat explicitly

Schemas MUST accept every shape currently on disk. `dmOptOut` stays `.optional()` (parsed, not surfaced). Missing optional fields fall back exactly as today (per-key defaults for preferences, `?? []`/`?? null` for roles). A fixture round-trip test over real sample files guards this.

### Decision 3: Fold the thin guards in

`changes/persistence.ts` `isValidSessionState` → a small `PersistedSessionState` schema (still returns `null` on mismatch). `cronJobs.ts` `submitResponseMode` guard → an enum field validated at parse, dropping invalid values with the same warning.

### Decision 4: Reuse the shared leaf, consistently

These loaders only need success + a logged warning on failure (no Claude-facing labeled path). For consistency with Change 1 and to avoid dumping a raw `ZodError`, the warning message SHALL be formatted with `zodErrorToResult(parsed.error, "<loader>").error` (e.g. `"workers"`, `"roles"`, `"preferences"`). The reuse is real and uniform — not "maybe".

## Risks / Trade-offs

- **Rejecting real saved data** → highest risk; a too-strict schema would wipe live state (roles, worker pool). Mitigation: fixture round-trip tests over real `data/state/*.json` samples; schemas use `.optional()`/`.passthrough()` where the loaders are currently lenient.
- **Date coercion** → `lastUsedAt`/`createdAt` are ISO strings on disk, `Date` in memory; the `.transform` must match the current `new Date(...)` behavior (including how invalid dates were handled).
- **Lower value than Change 2** → these are simple shapes; the win is consistency + catching malformed JSON at parse. Keep the change small and additive.
