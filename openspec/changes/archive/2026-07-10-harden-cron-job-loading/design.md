# Design

## Decision 0 — Quarantine location: a sibling `quarantinedJobs` array in the same file

Malformed jobs are preserved in a new top-level field of `cron-jobs.json`:

```jsonc
{
  "jobs": [ /* valid CronJob[] */ ],
  "quarantinedJobs": [ /* raw unknown[], verbatim as read from disk */ ]
}
```

Rejected alternatives:
- **Keeping bad jobs in the `jobs` array, unscheduled.** Every consumer iterating `jobs` assumes `CronJob` shape; a raw malformed object there is a landmine. Isolating them in a separate field means no scheduler/CRUD/Home-Tab code path ever touches an unvalidated object by accident.
- **A separate `cron-jobs.quarantine.json` file.** More moving parts, another loader, and it decouples the quarantine from the file it belongs to. One file keeps the state atomic and the round-trip trivial.

`cronJobStateZod` already ignores unknown top-level keys (it is not `.strict()`), so older builds reading a file that contains `quarantinedJobs` simply ignore it — forward/backward compatible.

## Decision 1 — Per-element parse; `jobs` never fails as a whole

`loadJobs()` changes from:

```ts
const parsed = cronJobStateZod.safeParse(JSON.parse(content)); // atomic — one bad job => empty
if (!parsed.success) { return []; }
```

to a per-element walk:

```ts
const raw = JSON.parse(content);
const rawJobs = Array.isArray(raw?.jobs) ? raw.jobs : [];
const valid: CronJob[] = [];
const quarantined: unknown[] = [...(Array.isArray(raw?.quarantinedJobs) ? raw.quarantinedJobs : [])];
for (const j of rawJobs) {
  const r = cronJobZod.safeParse(j);
  if (r.success) valid.push(r.data);
  else quarantined.push(j);           // preserve verbatim — NEVER drop
}
```

Worst case is now "one malformed job is quarantined and reported," never "all jobs disappear."

## Decision 2 — Quarantine survives the save cycle (this is what made 07-06 permanent)

The July 6 loss became irreversible because after the loader returned empty, a plugin `reconcileCronJobs` → `saveState()` overwrote the file with only the plugin jobs. To prevent recurrence, `saveState()` MUST re-serialize `quarantinedJobs` on every write:

```ts
await writeFile(filePath, JSON.stringify({ jobs: state.jobs, quarantinedJobs: state.quarantinedJobs ?? [] }, null, 2));
```

The in-memory `cached` state carries `quarantinedJobs` so it round-trips without a re-read. Quarantined entries are omitted from serialization only when the array is empty (keeps clean files clean).

## Decision 3 — Total-failure guard: freeze, don't overwrite

`JSON.parse` throwing (truncated/corrupt file) or a non-object top level is categorically different from one bad job. Today the `catch` sets empty and returns, and the next save clobbers the corrupt-but-possibly-hand-recoverable file. New behavior:

1. Copy the unreadable file to `cron-jobs.corrupt-<ISO-ish-ts>.json` (best-effort; failure to copy is logged, not fatal).
2. Set an in-memory `persistenceFrozen = true` flag. While frozen, `saveState()` logs an error and **returns without writing** — the original file on disk is never overwritten by the running process.
3. Return an empty live-jobs set (the scheduler has nothing to run) but DM the owner immediately.
4. The freeze clears on the next successful full load (e.g. after an operator repairs the file and the process restarts), or via an explicit owner action.

Timestamps: `Date.now()`/`new Date()` are available in production code (only banned in workflow scripts and tests). The corrupt-snapshot name uses a filesystem-safe timestamp.

## Decision 4 — Owner notification reuses the worker-quarantine pattern

`src/workers/quarantineNotifier.ts` already DMs owners when a worker is dirty-quarantined. The cron quarantine notifier follows the same shape: resolve owner user id(s), send a concise DM listing each quarantined job's id, the failing field path (from the zod issue), and the error message; on freeze, a single DM naming the corrupt-snapshot file. Notifications are best-effort and never block loading. Strings on this DM path go through `t()` (direct-to-Slack path).

## Decision 5 — Home Tab panel: Retry re-validates, Delete is the only removal

A "Quarantined schedules" section renders only when `quarantinedJobs` is non-empty. Each entry shows a human summary (name/id if present in the raw object, the failing field, the error) and two buttons:

- **Retry** — re-run `cronJobZod.safeParse` on the stored raw object. On success, move it from `quarantinedJobs` into `jobs` and persist; on failure, keep it quarantined and surface the (possibly changed) error. This is the fix path after an operator hand-edits the raw job or after a schema is loosened.
- **Delete** — remove the entry from `quarantinedJobs` and persist. Owner-gated. This is the ONLY code path that deletes a quarantined job; there is no automatic pruning.

Panel visibility and both actions are owner/admin-gated consistent with existing Home Tab schedule controls. Action handlers live in a new file under `src/slack/handlers/`.

## Decision 6 — Gating test

A characterization test proves the behavior change at the seam:
- **Before-fix baseline** (documented, not run against new code): a file with 8 valid + 1 invalid job → loader returns `[]`.
- **After-fix**: the same file → loader returns the 8 valid jobs and `quarantinedJobs` holds the 1 invalid; `saveState` round-trips the quarantine; a total-`JSON.parse` failure freezes persistence and writes a `.corrupt-*` snapshot without overwriting the original.

No real timers, no real fs against `data/` — use a temp dir / injected path and fake timers per repo test conventions.
