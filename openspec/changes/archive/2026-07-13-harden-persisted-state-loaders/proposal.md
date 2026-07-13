## Why

`harden-cron-job-loading` fixed ONE loader, but the audit that followed found the **same
wipe-on-one-bad-entry idiom copy-pasted across the persisted-state layer**. Every one of these
reads a collection, validates it with a single whole-collection `safeParse`, and on ANY failure
returns an empty default that the next save then writes back — permanently destroying the whole
file because of one malformed entry (the exact mechanism of the 2026-07-06 cron loss).

Verified instances (`data/state/` graceful readers, each confirmed against the code):

- `src/autoRespond.ts` `loadStandingRules` (`autoRespond.json`) — a structural twin of the old
  cron loader; admin-authored standing rules, no per-field guard.
- `src/memoryRegistry.ts` `loadMemoryStore` + `loadArchiveStore` (`memory.json`,
  `memory-archive.json`) — `z.record(string, memoryEntryZod)` with **no** per-entry `.catch()`;
  one bad entry wipes the entire durable knowledge base. Highest-value, least-replaceable data.
- `src/userPreferences.ts` `loadPreferences` (`user-preferences.json`) — every user's prefs map.
- `src/workers/persistence.ts` `loadPoolState` — pool metadata (reconstructable; worktrees survive).
  NOTE: this loader is **synchronous** (`readFileSync`), so the shared core exposes a pure sync
  parse helper it can call (see design D1).
- `src/ephemeralRules.ts` `loadEphemeralRules` — ~1h-TTL conversation windows (self-heals, but disruptive).

`add-daily-state-backup` already gives these a recovery *net* (midnight snapshots), so the harm is
now "recoverable-but-silent" rather than "catastrophic" — but the loaders still silently drop live
data and nothing surfaces it to a human. The right fix is to stop copy-pasting the fragile idiom:
factor the cron-jobs resilience (per-element parse + quarantine + freeze-on-total-failure) into ONE
shared loader that every collection store adopts, so the whole bug class is closed and the next
new state file inherits the protection for free.

Out of scope: single-object / one-record-per-file loaders (`roles.ts`, `readQuarantineRecord`,
`parseSessionState`, `readMeta`, `readErrorReport`) — losing one file ≠ wiping a collection. `roles.ts`
is called out separately below for a lighter fail-safe (freeze, don't null-to-empty) since a roles
wipe is all-or-nothing catastrophic even though quarantine doesn't apply to a single object.

Also out of scope — **trivia** (`src/plugins/trivia/core/dataLayer.ts` `readSdkJson`, files under
`data/plugins/trivia/`): it has the same whole-collection-safeParse shape, but it is **plugin code**
and the plugin hard-rules (`src/plugins/CLAUDE.md`) forbid importing bot-core (`src/state/...`); plugin
data I/O goes through `sdk.readFile`/`writeFile`, not `node:fs`. Hardening it correctly needs either a
new resilient-read SDK primitive or a plugin-local helper — a separate design. Its blast radius is also
smaller: its schemas are already minimal (validate only the load-bearing fields), so only a truly
malformed entry trips the wipe. Tracked as a follow-up, not bundled here.

## What Changes

- **One shared resilient-collection loader** (`src/state/resilientCollection.ts`): per-element
  `safeParse` over an array OR a keyed record; valid entries load, invalid entries are quarantined
  verbatim (never dropped, never returned to consumers); a total `JSON.parse` failure snapshots the
  file and freezes persistence (never overwrites the corrupt original); the quarantine round-trips
  on every save; the workspace owner is DMed on any quarantine or freeze. This is the cron-jobs
  logic generalized — `cronJobs.ts` is refactored to consume it (no behavior change).
- **Migrate every at-risk bot-core loader** onto the shared loader: `autoRespond`, `userPreferences`,
  `memoryRegistry` (store + archive), `workers/persistence` (via the sync parse helper), and
  `ephemeralRules`. Each keeps its own public API and cache; only the parse/save mechanics change.
  (Trivia is deferred — see the plugin-boundary note above.)
- **On-disk format** gains a `quarantined` sibling. Array files keep their natural key
  (`{ jobs, quarantined }`, `{ rules, quarantined }`); bare-record files (prefs, memory, registry)
  move to a wrapped `{ entries, quarantined }` shape, with the loader still reading the legacy bare
  record for backward compatibility. `quarantined` is omitted when empty (clean files stay clean).
- **Unified Home Tab "Quarantined state" panel** (admin-only): one section listing every quarantined
  entry across all stores, labeled by source, each with Retry (re-validate → rejoin the live set)
  and Delete (the only removal path). Generalizes the cron "Quarantined schedules" panel; a
  persistence-freeze banner covers all stores.
- **`roles.ts` fail-safe** (single-object, no quarantine): on a total parse failure it freezes
  persistence and DMs the owner instead of null-to-empty, so a schema slip can't silently blank every
  role assignment.

## Capabilities

### Added Capabilities

- `resilient-state-loading`: the shared per-element loader — quarantine, freeze, owner
  notification, and the quarantine round-trip contract, for both array and record collections.

### Modified Capabilities

- `cron-messages`: the cron loader is re-expressed on top of the shared loader (behavior-preserving).
- `auto-respond`: standing rules load resiliently (per-rule quarantine, no whole-collection wipe).
- `user-preferences`: the prefs map loads resiliently (per-user quarantine).
- `memory-faculty`: the memory store + archive load resiliently (per-entry quarantine).
- `home-tab`: the cron "Quarantined schedules" panel generalizes to a "Quarantined state" panel
  spanning all stores; the freeze banner covers all stores.

## Impact

- Code: new `src/state/resilientCollection.ts` (pure parse core + async/sync loaders) + tests;
  refactors to `cronJobs.ts`, `autoRespond.ts`, `userPreferences.ts`, `memoryRegistry.ts`,
  `workers/persistence.ts`, `ephemeralRules.ts`, `roles.ts`; Home Tab panel + handler
  generalization; a shared source-labeled quarantine-notifier (extends the cron one).
- Data: each collection file gains an optional `quarantined` array/map; bare-record files adopt a
  wrapped shape (legacy bare shape still read). `<name>.corrupt-<ts>.json` snapshots may appear on
  total failure. Complements `add-daily-state-backup` (net) — this is the prevention.
- Risk: MEDIUM. The parse change is additive per loader (valid entries behave identically), but it
  touches many modules; each migration is gated by that loader's existing unit tests plus a shared
  characterization test proving "one bad entry no longer wipes the collection."
- Depends on: nothing. Builds on the shipped `harden-cron-job-loading` and `add-daily-state-backup`.
