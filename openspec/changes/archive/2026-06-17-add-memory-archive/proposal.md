## Why

The memory faculty's `forget` is destructive: when the daily review decides a referenced work item is resolved and its `staleAfter` has passed, the entry is hard-deleted. The "we already did this, and here's what happened" signal is lost forever. The idler's sync dedups re-emitted entities (a re-alerting Sentry issue, a re-surfacing tracker task) only against *live* entries — so once an entry is pruned, a recurrence is re-triaged from zero, with no memory of the prior outcome or the PR that fixed it. We are losing this outcome data on every daily review starting now.

## What Changes

- **New lean, ID-only archive store** (`data/state/memory-archive.json`) holding terminal "what happened" notes — `id`, `summary`, `outcome`, optional `link`, `archivedAt`. It sheds the heavy live-work machinery (reference `howToRead`/`howToComment` recipes, `plugins` namespaces): an archived entry is terminal and never re-polled.
- **Retrieval is exact-ID only** (`getArchived(id)`) — the archive is deliberately invisible to keyword `recall`, so completed items never re-pollute the active working set. The only way back in is holding the stable key.
- **The daily review gains a three-way decision** instead of keep-or-forget: *still relevant* → leave/refresh; *done & worth remembering* → distill into a lean note and archive (atomically removing the active entry); *noise* → `forget` (true delete, unchanged). A new `archive(id, leanNote)` tool, reachable by the review, performs the distill-and-remove in one step. Claude composes the lean note at review time.
- **Archive pruning on an age horizon** — a mechanical step (no fetch, no Claude) in the daily review drops archived notes older than a configurable `archiveRetentionDays` (default 365). Lean + age-pruned keeps the store bounded and small.
- **Idler sync consults the archive on discovery** — before `upsert_idea` for a discovered entity, sync point-looks-up the archive by stable key and, when hit, **enriches** the new/refreshed unit with the prior outcome ("fixed before in PR #123") rather than suppressing it. A re-alerting entity is still treated as workable (a genuine regression must get worked); the prior outcome is context, not a veto.

## Capabilities

### New Capabilities
- `memory-archive`: A lean, terminal, ID-only memory archive — its record shape, exact-ID retrieval (no keyword search), the `archive(id, leanNote)` atomic distill-and-remove tool, and age-horizon pruning.

### Modified Capabilities
- `memory-faculty`: The daily relevance review's decision becomes three-way (leave / archive / forget); a done-but-worth-remembering entry is distilled into the archive instead of hard-deleted. Adds the archive-prune step to the daily review.
- `idler-ideas-ledger`: Stable-key dedup additionally consults the archive on discovery, enriching a re-discovered entity with its prior archived outcome.

## Impact

- **New code**: archive store in `src/memoryRegistry.ts` (or a sibling `memoryArchive.ts`) — graceful permissive zod reader + serialized write chain, mirroring the active store's idioms; `archive`/`getArchived` reads/writes; `pruneArchive(now)`.
- **New tools**: `archive`, `get_archived`, and `prune_archive` query tools (`src/tools/query/`), dev+ with system-cron permitted — `archive` and `prune_archive` reachable by the daily review, `get_archived` by the idler sync prompt (`recall` is keyword-only and cannot serve an exact-id lookup).
- **Modified**: daily-review prompt (`src/memory/dailyReview.ts`) — three-way decision + archive-prune step; idler sync prompt (`src/plugins/idler/prompts/sync.ts`) — archive lookup before `upsert_idea`.
- **Config**: `archiveRetentionDays` (default 365) on the memory/review config surface.
- **No breaking change**: `forget` semantics for noise entries are unchanged; the active store, keyword recall, and `staleAfter` pruning are untouched.
