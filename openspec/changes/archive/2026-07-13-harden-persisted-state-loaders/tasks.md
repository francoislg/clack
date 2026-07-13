## 1. Shared resilient-collection core (write test first)

- [ ] 1.1 Add `src/state/resilientCollection.test.ts` (the gate). For BOTH `kind: "array"` and
  `kind: "record"`: one bad entry → the rest load + the bad one is quarantined (not wiped);
  quarantine round-trips through a save→load cycle; clean files omit `quarantined`; a legacy
  bare-record file (no `entries` key) is read and wrapped on next write; a legacy array file with the
  old `quarantinedJobs` key is read and rewritten under the uniform `quarantined` key.
- [ ] 1.2 Freeze-lifecycle tests: total `JSON.parse` failure AND a non-object/`null`/string top level
  both snapshot `<name>.corrupt-*` + freeze + return empty; a save while frozen does NOT overwrite the
  original; the freeze is set even if the snapshot write fails; a subsequent clean load clears the
  freeze for that path and writes resume.
- [ ] 1.3 Notifier test: `onQuarantine` fires with the correct report (source label + entries) when
  entries are quarantined, and with the freeze payload on total failure; a no-op notifier is safe.
- [ ] 1.4 Add `src/state/resilientCollection.ts`: pure `parseResilientCollection` (per-element walk,
  array + record; record quarantine preserves the original key; returns `"unusable"` for a bad top
  level), async `loadResilientCollection` (readFile + JSON.parse → freeze/snapshot on failure → pure
  core → notify), `serializeResilientCollection` (omit `quarantined` when empty), a per-path frozen
  `Set` + `isFrozen(path)`, and `retryQuarantined`/`deleteQuarantined`. Snapshot naming reuses the
  `corrupt-<ts>-<rand>` scheme from `cronJobs.ts`.

## 2. Fold cron into the unified quarantine surface (keep its internals)

- [ ] 2.1 Adapt cron into the shared quarantine surface WITHOUT rewriting its (already-resilient,
  already-tested) internals: register a registry descriptor wrapping cron's existing
  `getQuarantinedJobSummaries`/`retryQuarantinedJob`/`deleteQuarantinedJob`/`isCronPersistenceFrozen`
  (adapting index↔key), and route cron's notifier through the shared sink with source
  `"cron schedules"`. Delete the cron-specific `cronQuarantineNotifier.ts`. (Folding cron's internals
  onto the shared core is a low-risk follow-up — the internals are unchanged here so the shipped cron
  tests stay the guard.)
- [ ] 2.2 Keep every shipped cron test green (`cronJobs.test.ts`, `cronJobs.quarantine.test.ts`).

## 3. Array-collection stores

- [x] 3.1 `src/autoRespond.ts` `loadStandingRules` → shared array store (`collectionKey: "rules"`),
  label `"auto-respond rules"`. Resilience covered by the factory + core tests (the store's existing
  tests exercise the real-schema wiring with valid data).
- [ ] 3.2 DEFERRED (fast follow-up): `src/workers/persistence.ts` `loadPoolState` is SYNCHRONOUS
  (`readFileSync`) — it wires to the pure `parseResilientCollection` helper (already built + tested in
  the core) rather than the async store factory. Left for a follow-up; pool state is reconstructable
  (worktrees survive a wipe), the lowest blast radius of the set.
- [ ] 3.3 DEFERRED (fast follow-up): `src/ephemeralRules.ts` — ~1h-TTL windows that self-heal; larger
  mutation surface (ratchet/reframe). Left for a follow-up to keep this change's diff focused on the
  irreplaceable-data stores.

## 4. Record-collection stores (legacy-bare-record read is the risk)

- [x] 4.1 `src/userPreferences.ts` `loadPreferences` → shared record store, label `"user preferences"`.
  Live-DI closures preserve the runtime `setUserPreferencesDeps` override. Legacy-bare-record read +
  wrapped-write covered by `resilientStore.test.ts`; the store's own tests updated to the wrapped shape.
- [x] 4.2 `src/memoryRegistry.ts` `loadMemoryStore` + `loadArchiveStore` → shared record stores,
  labels `"memory"` / `"memory archive"`. Legacy-read + per-entry quarantine covered by the factory +
  core tests; the store's 30 tests exercise the real-schema wiring.

## 5. Owner notification + unified Home Tab panel

- [x] 5.1 `src/state/stateQuarantineNotifier.ts` — source-labeled notifier (reuses `OwnerNotifierDeps`);
  one DM names the store + entries / the frozen file. `stateQuarantineNotifier.test.ts` covers both.
  The cron-specific `cronQuarantineNotifier.ts` is deleted; cron routes through this via the adapter.
- [x] 5.2 `src/state/stateQuarantineRegistry.ts`: registry (`{ storeId, label, getSummaries, retry,
  remove, isFrozen }`) + the owner-notification sink. Stores register via the factory; cron via
  `cronQuarantineAdapter.ts`; roles registers a freeze-only descriptor.
- [x] 5.3 Unified admin-only "Quarantined state" panel in `homeTab.ts` iterating the registry; per
  row: source label + key/field/error + Retry/Delete (`storeId::key` value). Freeze banner lists all
  frozen stores; a frozen store contributes only the banner.
- [x] 5.4 `state_quarantine_retry`/`delete` handlers route through the registry; admin-gated (fixed the
  gate to `await userCanEditConfig(userId)`). Tests: grouped-by-source render, correct-store routing,
  non-admin exclusion, unknown-store + malformed-value handling.

## 6. Roles fail-safe (single object — freeze, don't wipe)

- [x] 6.1 `src/roles.ts` `loadRoles`: on total parse/shape failure, snapshot + freeze + DM the owner
  and serve the last-known-good cache (never written while frozen). Registers a freeze-only Home Tab
  descriptor (banner, no rows). Test: a corrupt `roles.json` is not overwritten AND the owner is
  notified via the sink.

## 7. Green gate

- [x] 7.1 `npx tsc` clean
- [x] 7.2 `npx oxlint` + `npx oxfmt` clean on changed files
- [x] 7.3 `npm test` (vitest) green — shared core test + every migrated store's tests + Home Tab +
  i18n parity (6931 passed)
- [x] 7.4 `graphify update .`
