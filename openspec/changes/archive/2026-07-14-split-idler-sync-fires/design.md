# Design — split-idler-sync-fires

## Context

The idler's sync task is one cron spec whose static prompt (`buildSyncPrompt`) mandates a full maintenance pass on every fire: quick-fetch + close-resolved (PR listing + per-unit `howToRead` re-runs), memory triage (recall page → classify → adopt/ignore), coldest-unit re-verification with stale parking, and one round-robin external discovery source. Measured on the production VM: ~19 API calls and ~$1.25 per fire, up to 12 fires/day, identical cost whether or not anything changed.

Two structural facts shape the design:

- **Cron prompts are static** — baked at `sdk.reconcileCronJobs` time. Differentiated per-fire behavior therefore means *different specs*, not a conditional prompt.
- **The fire's fixed cost dominates** — ~40k tokens of boot context (system prompt, tools, behavior topic, 24KB fetch-instructions) are cache-cold between fires spaced hours apart. Fragmenting scope across more fires multiplies this tax; the cheap outcome is a fire that ends after 2–3 turns, and the free outcome is a fire that doesn't exist.

The consumer of a fully-maintained ledger is the work window, which opens immediately after the last sync-window hour. Mid-day, the only latency-sensitive need is triaging newly-remembered work (memory entries).

## Goals / Non-Goals

**Goals:**

- Cut sync cost to ~1 full-pass fire per window-day plus cheap triage probes, with no SDK or core changes.
- Preserve every current maintenance behavior at least once per window-day (nothing is dropped, only re-scheduled).
- Keep new-memory triage latency at the configured `syncEveryHours` cadence.
- Shrink the light fire's boot context by omitting the fetch-instructions document.

**Non-Goals:**

- No code-side change detection or `shouldFire` pre-gate (a possible future upgrade; this design must not need rework to add it later).
- No structured-reference model — `howToRead` recipes stay free-text, Claude-executed.
- No changes to the work or summary tasks, the slice schema, or the ledger tools.
- No catch-up (`onDelayedBoot`) handler for missed deep fires.

## Decisions

### D1: Two cron specs, keyed `sync` (deep) and `sync-light`

The deep fire keeps the existing `sync` specKey so `reconcileCronJobs` updates the existing job in place (preserving run history) rather than delete/create; the light fire is a new `sync-light` spec. Both are channelless with `submitResponseMode: "skipped"` and `attachedTopics: [TOPIC]`.

*Alternative considered:* one spec with an hour-aware prompt ("if this is the pre-window hour, also do…"). Rejected: prompts are static, and even if Claude could infer the hour, it puts a scheduling decision inside model judgment where it can silently drift. Two specs make the tiers deterministic and independently observable in run history.

### D2: Anchor-hour math lives in `heuristic.ts`

The **anchor hour** is the last sync-window hour before the work window opens:

- derived sync window (complement of `workHours`): `(workHours.start - 1 + 24) % 24` — always a complement member when the complement is non-empty;
- explicit `syncHours` window: `(syncHours.end - 1 + 24) % 24` — its own last hour (such a window has no relation to the work window, so "its end" is the only meaningful anchor).

Deep cron: `45 <anchor> * * <days>`. Light cron: the existing `thinHours(hours, syncEveryHours, anchor)` set **minus** the anchor hour. Because thinning is already anchored on that hour, removing it preserves the chronological every-N spacing of the remaining fires, and light ∪ deep exactly equals today's thinned schedule. When the light set is empty (single-hour sync window), only the deep spec is reconciled.

### D3: Light prompt — memory triage only, early-exit-first

The light prompt instructs, in order: (1) one recency-ordered `recall` page (no query, newest `updatedAt` first, limit ~30); (2) classify the whole page using the existing slice markers (`plugins.idler` slice present / `ignoredAt` vs `updatedAt`); (3) **if no candidates, end the fire immediately via `skip_response`** — stated as the expected common outcome, mirroring the work fire's "idle is the default" framing; (4) otherwise adopt/ignore up to 10 candidates with the existing `get_archived` enrichment and `upsert_idea` keying rules. No quick-fetch, no coldest rotation, no discovery, no PR handling.

The light prompt does NOT interpolate `fetch-instructions.md` — triage classification needs only the repo allowlist (already in the prompt header). The behavior topic stays attached (it carries the `upsert_idea` contract and dedup rules the triage step uses).

### D4: Deep prompt — current full pass, discovery covers ALL enabled sources

The deep prompt is the current `buildSyncPrompt` content with one change: the external-discovery section drops the round-robin ("do ONE source per fire") and instructs scanning **every enabled source** (channels, tracker, own PRs). Rationale: the deep fire is now the only scanning fire; a round-robin at once-per-day cadence would starve each source for days. The added cost is bounded by the configured source count (typically ≤3 extra tool calls). Fetch-instructions stay embedded here — this is the only fire that needs them.

### D5: `syncEveryHours` governs light only; deep is always 1/window

The knob keeps its existing meaning for the light cadence (default 2, range 1–12). The deep fire is fixed at one per window-day and is not configurable — its timing is structural (prime-before-work), not a tuning knob.

### D6: File shape — `prompts/sync.ts` splits into two builders

`buildSyncLightPrompt(config)` and `buildSyncDeepPrompt(config, fetchInstructions)` (either both in `sync.ts` or as `syncLight.ts`/`syncDeep.ts` — implementer's choice, matching the small-files convention). Shared fragments (allowlist header, memory-triage step, upsert keying rules) are extracted once so the two prompts can't drift on the triage contract.

## Risks / Trade-offs

- **[Mid-day external events wait for the deep fire]** A Sentry alert posted at 10 AM isn't discovered until the pre-window deep fire. → Acceptable by design: nothing could act on it before the work window opens anyway. Genuinely urgent alerts are auto-respond territory, not idler sourcing.
- **[Missed deep fire on process downtime]** The idler has no boot catch-up handler; a deploy spanning the anchor hour loses that day's full pass. → Degradation is soft: the work fire re-reads a unit's references before acting (work prompt step 2), so it acts on current state — selection is just staler. Closing resolved units slips one day. If this bites in practice, an `onDelayedBoot` handler is a small follow-up.
- **[Light fires still cost ~$0.25 when quiet]** The boot tax is the prompt-only floor. → Accepted for this change; the design deliberately leaves room for a code-side `shouldFire` gate to zero these out later without restructuring (the light spec is exactly the thing such a gate would wrap).
- **[Coldest rotation slows]** Coldest-K re-verification cycles once per window-day instead of hourly; a ~30-unit ledger still fully cycles in under a week at K=8. → Matches the actual freshness requirement (staleness is judged in days, not hours).
- **[Memory churn from other writers]** Any plugin bumping `updatedAt` re-surfaces entries on the light fire's recall page. → The classify-then-take cap (10) and the `ignoredAt` marker semantics already bound this; unchanged from today.

## Migration Plan

None needed. On deploy + config hot-reload, `reconcileCronJobs` updates the `sync` job (new cron + deep prompt) and creates `sync-light`. Rollback = revert and redeploy; the reconciler removes `sync-light` when its spec disappears. No persisted-state or schema changes.

## Open Questions

(none)
