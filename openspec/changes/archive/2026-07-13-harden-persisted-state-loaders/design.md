# Design

## Decision 0 — A pure core + a thin per-store adapter, not a state-owning framework

The at-risk loaders each own a lot of surrounding API (`cronJobs.ts` alone has ~15 CRUD
functions) and their own module-level `cached`. A framework that took ownership of all that state
would be a massive, risky rewrite. Instead the shared module is **mechanism, not state**:

```ts
// src/state/resilientCollection.ts
export type CollectionKind = "array" | "record";

// PURE core (no I/O): per-element parse an already-parsed top-level value. This is the seam every
// consumer shares — including the SYNCHRONOUS worker-pool loader (`loadPoolState` is `readFileSync`),
// which reads bytes itself and calls this. No async needed for the parse itself.
export function parseResilientCollection<T>(raw: unknown, opts: {
  entrySchema: ZodType<T>;
  kind: CollectionKind;
  collectionKey?: string;
}): { valid: T[] | Record<string, T>; quarantined: QuarantineBucket; newly: QuarantineEntry[] } | "unusable";
// Returns "unusable" when the top level isn't the expected object/array shape (→ caller freezes).

// ASYNC file wrapper: readFile + JSON.parse (freeze+snapshot on throw or "unusable"), then the pure
// core, then owner-notify. The common path for the async loaders.
export async function loadResilientCollection<T>(opts: {
  path: string;
  entrySchema: ZodType<T>;
  kind: CollectionKind;
  collectionKey?: string;      // array files: the natural key ("jobs", "rules"); default "entries"
  onQuarantine?: (report: QuarantineReport) => void;
}): Promise<{ valid: T[] | Record<string, T>; quarantined: QuarantineBucket; frozen: boolean }>;

// Serialize valid + quarantined back to the on-disk shape (omit quarantine when empty).
export function serializeResilientCollection(...): unknown;

// Freeze guard consulted by each store's save; keyed by file path.
export function isFrozen(path: string): boolean;

// Quarantine mutation helpers (Home Tab Retry/Delete), keyed by path.
export async function retryQuarantined(path, key, reload, save): Promise<Result>;
export async function deleteQuarantined(path, key, reload, save): Promise<boolean>;
```

Each store keeps its `cached` and its `saveX`, but delegates the parse/quarantine/freeze mechanics.
`cronJobs.ts` becomes the reference adapter — it loses its bespoke copy and calls the shared core,
proving the abstraction covers the real case without behavior change.

## Decision 1 — Two collection shapes, one core

`data/state` collections are either **arrays with a wrapper** (`{ jobs: [...] }`,
`{ rules: [...] }`) or **bare records** (`{ [userId]: prefs }`, `{ [key]: memoryEntry }`).

- **Array kind**: valid → `T[]`, quarantine → `unknown[]` (verbatim). Keyed by array index for the
  Home Tab (same as the shipped cron panel).
- **Record kind**: valid → `Record<string, T>`, quarantine → `Record<string, unknown>` **preserving
  the original key** (a bad user's prefs stay quarantined under their userId, so Retry can restore
  them to the right slot). Keyed by the record key for the Home Tab.

The per-element walk is identical; only iteration (array vs `Object.entries`) and the quarantine
container differ. `QuarantineBucket` is a discriminated union over `kind`.

## Decision 2 — On-disk format: additive for arrays, wrapped-with-legacy-read for records

- **Array files** already have a wrapper object, so they just gain a sibling: `{ jobs, quarantined }`,
  `{ rules, quarantined }`. (cron currently writes `quarantinedJobs`; the migration renames it to the
  uniform `quarantined` — the loader reads both, so no data migration is needed.)
- **Bare-record files** (`user-preferences.json`, `memory.json`, `memory-archive.json`) have no
  wrapper to hang quarantine on. They move to `{ entries: { ...record }, quarantined: { ...record } }`.
  **Backward compatibility is mandatory**: the loader accepts EITHER a legacy bare record (no
  `entries` key → treat the whole object as `entries`) OR the wrapped shape. Writes always use the
  wrapped shape. First write after upgrade transparently migrates the file. This is the single
  riskiest bit — it gets an explicit "reads legacy bare record" characterization test per store.

Rejected: a per-store `<name>.quarantine.json` sidecar (two files, loses write atomicity, more
moving parts) and a reserved `"__quarantined__"` record key (collides with the record's own keyspace).

## Decision 3 — Freeze + snapshot generalized and keyed by path

The cron freeze logic (a module-level `persistenceFrozen` bool) becomes a `Set<string>` of frozen
file paths in the shared module. `loadResilientCollection` snapshots a `JSON.parse`-failing file to
`<name>.corrupt-<ts>-<rand>.json`, adds its path to the frozen set, and returns `frozen: true` with
an empty live collection. Each store's save calls `isFrozen(path)` and no-ops when frozen. A clean
load removes the path from the set. Same cross-restart guarantee as cron: in-memory only, re-arms on
the next fresh load while the file stays corrupt, original never overwritten.

## Decision 4 — Owner notification: one notifier, source-labeled

`cronQuarantineNotifier.ts` generalizes to a `stateQuarantineNotifier` that takes a **source label**
(`"auto-respond rules"`, `"memory"`, `"cron schedules"`, …) so one DM names which store quarantined
what. Reuses the shared `OwnerNotifierDeps` already extracted in `harden-cron-job-loading`. Registered
once at boot; each store passes its label through `onQuarantine`. Best-effort, never blocks a load.

## Decision 5 — One Home Tab "Quarantined state" panel

The shipped cron "Quarantined schedules" section generalizes to a single admin-only "Quarantined
state" panel that enumerates quarantined entries across ALL registered stores. Each store registers a
descriptor `{ label, load, retry, delete }` in a small registry the panel iterates; each row shows
source label + key/field/error + Retry/Delete. One persistence-freeze banner lists every frozen
store. The cron-specific panel is removed in favor of this unified one (its behavior is subsumed).
Action ids carry `(storeId, key)` so Retry/Delete route to the right store.

## Decision 6 — `roles.ts` gets a freeze fail-safe, not quarantine

`roles.json` is a single object (`{ owner, admins[], devs[] }`), so per-element quarantine is
meaningless — but a total parse failure today null-to-empties every role assignment, which the next
save persists (a silent, catastrophic auth wipe). `loadRoles` adopts only the freeze half of the
shared machinery: on `JSON.parse`/shape failure it snapshots + freezes + DMs the owner and returns
the last-known-good cache if present (else an empty set that is NOT written back while frozen). No
quarantine bucket, no Home Tab rows — just "never silently blank the file."

## Decision 7 — Migration order (each step independently shippable)

1. Build `src/state/resilientCollection.ts` (pure `parseResilientCollection` + async
   `loadResilientCollection` + freeze set + quarantine mutators) + shared characterization test.
2. Refactor `cronJobs.ts` onto it (behavior-preserving; the shipped cron tests are the guard).
3. Array stores: `autoRespond`, `ephemeralRules` (async), and `workers/persistence` (sync — uses
   `parseResilientCollection` directly, keeps `readFileSync`).
4. Record stores: `userPreferences`, `memoryRegistry` (×2) — each with a legacy-bare-record read test.
5. Unified Home Tab panel + notifier; remove the cron-specific panel.
6. `roles.ts` freeze fail-safe (single object — freeze half only, see D6).

Steps 3–4 are independent; a partial landing is safe (un-migrated loaders keep today's behavior).
**Trivia is NOT in this order** — it is plugin code and cannot import bot-core `src/state/...` (plugin
hard-rules); hardening it needs an SDK-mediated resilient read, tracked as a separate follow-up.

## Decision 8 — Gating test

A shared `resilientCollection.test.ts` proves, for both kinds: one bad entry → the rest load + the
bad one is quarantined (not wiped); quarantine round-trips through save; total `JSON.parse` failure
snapshots + freezes without overwriting; legacy bare-record files are read and transparently wrapped
on next write. Plus each migrated store keeps its existing unit tests green (behavior preserved for
valid data) and adds one "one bad entry survives" case.
