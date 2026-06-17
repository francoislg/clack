## Context

The idler discovers work only from its configured sources (channels, tracker, own PRs, fetch instructions). Core memory — written by `remember` from scheduled messages, Q&A sessions, and other paths — holds work-shaped entries keyed by stable ids (`sentry:1234`, `asana:567`) that the idler never inspects. Because idler work units are themselves core memory entries (the work-state lives under `plugins.idler` on the entry; see `idler-ideas-ledger`), and both `remember` and `upsert_idea` key by the same stable id, the idler can adopt a memory entry simply by stamping its slice — no duplication, no new storage.

The sync fire is the read-only discovery/ledger-refresh task (no change tools, no worktree, ends `skip_response`). It already rotates discovery one source per fire round-robin. The memory scan is pure discovery, so it belongs in sync as one more rotation entry — never in the work fire.

## Goals / Non-Goals

**Goals:**
- Let the idler adopt actionable, untriaged memory entries as work units, dedup-safe by stable id.
- Bound the scan so it fits the idler's existing bounded design (round-robin, per-fire/per-night caps).
- Avoid re-evaluating the same non-work entries every fire, while re-evaluating an entry when it gains new information.
- Add no new tool and no change to core (`recall`, `remember`); keep the plugin boundary intact.

**Non-Goals:**
- A full-memory sweep every fire (too costly, fights the bounded design).
- Acting on memory entries in the work fire's selection beyond the normal ladder — adopted units flow through the existing `continue > triage > implement > review` ladder unchanged.
- Any change to how memory entries are written, pruned, or recalled by non-idler callers.

## Decisions

### D1: Memory is a discovery source under `IdlerSources`, not a new config section
`sources.scanMemory: boolean` (default `true`) sits beside `channels`/`tracker`/`ownPrs`. The idler has no dedicated sync-config section (only `syncHours` + `sources`), and `sources` is literally "discovery sources the idler sweeps" — memory is exactly that. The sync prompt's source header and round-robin gain one uniform entry.
- *Alternative considered:* a top-level `periodicallyScanAllMemories` flag or a new `syncConfig` block. Rejected — `sources` is the coherent home and keeps the round-robin uniform.

### D2: Reuse `recall` unchanged; classify a recency page in the prompt
`recall` already returns whole entries including plugin data, newest-`updatedAt` first, paginated. The scan calls `recall` with no query and a generous page (`limit 25`), and Claude classifies each result from its `plugins.idler` slot (see D3 for the four states), then acts on up to **5 candidates**. Classifying a page (not just the newest 5) and *then* taking 5 candidates is the filter-then-take that prevents starvation: if the physically-newest entries are all already-triaged, Claude still reaches older untriaged ones within the page. No core code changes, and no standalone selector function (it would be dead code — the rule lives in the prompt; its correctness-critical half, the snapshot mechanics, lives in `upsert_idea` and is unit-tested there).
- *Alternative considered:* a new `list_scan_candidates` idler tool that pre-filters server-side. Rejected — `recall` covers it and the user asked to avoid a new tool. A core-side filter on `plugins.idler` would also leak idler knowledge into core `recall` (boundary violation).
- *Alternative considered:* `recall limit 5` then filter. Rejected — newest-5-then-filter starves older untriaged entries when the newest 5 are all triaged.

### D3: `ignoredAt` is a SNAPSHOT of `updatedAt`, not wall-clock — and the ignore write must not bump `updatedAt`
The slice gains `ignoredAt?: string`, set to the entry's `updatedAt` **as captured at ignore time**. The four scan states:
- no idler slot → **candidate** (untriaged)
- slot with `ignoredAt` **equal to** `entry.updatedAt` → **skip** (ignored, unchanged)
- slot with `ignoredAt` **differing from** `entry.updatedAt` → **candidate** (re-touched since ignore — new info may make it actionable)
- slot present **without** `ignoredAt` → **skip** (a tracked work unit, handled by the ladder/digest, not the scan's concern)

The critical subtlety: `mergeMemoryNamespace` bumps `updatedAt` on every slice write. A naive wall-clock `ignoredAt` would therefore make `updatedAt > ignoredAt` true on the *very next fire* (the ignore write moved `updatedAt` past the stamp), re-qualifying the entry forever — an infinite re-triage loop burning tokens every sync. The fix has two parts: (a) `ignoredAt` snapshots `updatedAt` so the comparison is equality, and (b) the ignore write uses a **no-touch merge** (D7) so it does not move `updatedAt` past the snapshot. Result: `ignoredAt == updatedAt` holds until a genuine content write (`remember`) advances `updatedAt`, which flips the entry back to candidate. Claude compares for *equality*, which is more robust than ISO ordering.
- *Alternative considered:* reuse `open: false`. Rejected — `open: false` means "was work, now done" (prune-eligible, surfaces in idler history). A never-was-work entry marked `open: false` reads as a phantom completed unit. `ignoredAt` is a semantically distinct state in the idler's own namespace.
- *Alternative considered:* wall-clock `ignoredAt` + `>` comparison. Rejected — the slice-write `updatedAt` bump causes the re-triage loop above.

### D4: Conservative triage — default to ignore; N = 5 candidates per fire
For each candidate Claude decides: clearly actionable **and** concerns an allowlisted repo → `upsert_idea` adopts it (same `getArchived` regression-enrichment as other sources, clearing any prior `ignoredAt`); otherwise → `upsert_idea` with `ignore: true` snapshots `ignoredAt`. Default to ignore. Acts on at most 5 candidates per fire (internal constant; the config is a plain boolean — widening `boolean → { enabled, maxPerFire }` later is clean). Downstream rails (repo allowlist, action caps, never-auto-merge) bound any work adoption triggers.

### D6: `upsert_idea` gains the ignore capability; `kind` becomes optional
The existing tool gains `ignore?: boolean`. On `ignore: true` the handler reads the entry (`sdk.memory.get(id)`), snapshots `ignoredAt = entry.updatedAt`, and merges `{ ignoredAt, open: false, priority: 0 }` via the **no-touch** merge (D7) — it does NOT call `remember` (no content change) and does NOT compute priority. `kind` (today required) becomes optional, since an ignore is not a work unit; the adopt path errors if `kind` is missing. The adopt path also clears any prior `ignoredAt` so adopting a previously-ignored entry yields a clean tracked unit. One tool serves both — no new tool, consistent with "enhance existing surface."

### D7: No-touch namespace merge (SDK expansion)
`mergeMemoryNamespace(plugin, id, partial, opts?: { touch?: boolean })` — `touch` defaults `true` (today's behavior). When `false`, the merge preserves the entry's existing `updatedAt` instead of bumping it. Threaded through `ClackSdkMemoryData.merge(id, partial, opts?)` and `createMemorySurface`. This is a general, justified SDK capability: bookkeeping writes that record *idler's processing of* an entry (not a change to the remembered knowledge) should not advance the knowledge's `updatedAt`. The optional param is backward-compatible — the three existing callers (`upsert_idea` adopt, `reprioritize_idea`, management close) pass nothing and keep touching `updatedAt`.
- *Alternative considered:* keep the bump and chase it with a second write. Rejected — every write bumps `updatedAt`, so `ignoredAt` can never catch up; the loop persists.

## Risks / Trade-offs

- **Infinite re-triage loop from the `updatedAt` bump** → Mitigated by D3 (snapshot equality) + D7 (no-touch ignore write). This is the central correctness risk; covered by a unit test asserting an ignored entry stays ignored across repeated scans with no intervening content change.
- **Behavior change for existing idler users on upgrade** (`scanMemory` defaults `true`) → Mitigation: the idler is already heavily gated (`enabled` + `repoAllowlist` + `reportingChannel`); conservative triage (default-ignore) + caps + never-merge bound the blast radius; an admin can set `scanMemory: false` to opt out.
- **LLM mis-classifies a non-work memory as work** → Mitigation: triage runs in query mode first, repo allowlist excludes out-of-scope work, and the morning summary is the human checkpoint. Worst case is a bounded, reviewable triage note.
- **Page too small to reach untriaged entries** → Mitigation: `recall limit 25` (filter-then-take) covers a generous recency window; the digest surfaces what was scanned. Widening is a one-number change.
- **`recall` not reachable from the sync session** → Verified false: the sync spec sets no `requiredTools` allowlist, so the cron session gets the standard query toolset including `recall`.

## Migration Plan

- No data migration. `ignoredAt` is an optional slice field; legacy slices parse unchanged (permissive schema). Legacy `sources` objects without `scanMemory` default to `true` via the zod default. The new `merge` `opts` param is optional and backward-compatible.
- Rollback: set `sources.scanMemory: false` (config-only), or revert the change — existing units and slices remain valid either way.
