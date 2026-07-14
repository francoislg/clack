import type { IdlerConfig } from "../types.js";

/**
 * The shared memory-triage recipe, run on BOTH sync tiers. Reads a recency-ordered page, classifies
 * every entry by its idler slice, then adopts (actionable + allowlisted) or ignores (everything
 * else) up to a bounded number of candidates. Classify-then-take slides past already-triaged newest
 * entries to reach older untriaged ones. Kept in one place so light and deep can't drift on it.
 */
const MEMORY_TRIAGE_RECIPE = `a. Call recall with no query and limit 50 (newest-updatedAt first).
   b. Classify EVERY entry on the page by its plugins.idler slice:
      - NO plugins.idler slice → CANDIDATE (untriaged).
      - plugins.idler.ignoredAt EQUALS the entry's updatedAt → SKIP (already triaged as not-work, unchanged since).
      - plugins.idler.ignoredAt PRESENT but DIFFERS from updatedAt → CANDIDATE (re-remembered/edited since it was ignored — re-evaluate).
      - plugins.idler slice WITHOUT ignoredAt → SKIP (already a tracked work unit).
   c. Take up to 10 candidates (classify the whole page FIRST, then take, so you reach older untriaged entries when the newest are all triaged). For each:
      - Clearly actionable AND it concerns an allowlisted repo → adopt it: call get_archived by its id (enrich on a hit, as in DISCOVERY), then upsert_idea keyed by its existing id with the right kind.
      - Otherwise (a preference, a note, out-of-allowlist, or unclear) → call upsert_idea with ignore: true to mark it not-idler-work. Default to ignore when in doubt.`;

/**
 * The LIGHT sync fire: cheap, frequent memory-triage-only pass. It does NOT list PRs, re-poll
 * tracked references, run the coldest rotation, or do external discovery — those belong to the deep
 * fire. When nothing on the recall page is a fresh candidate it ends immediately via skip_response;
 * that is the expected common outcome, not an edge case. The admin fetch-instructions are NOT baked
 * in — triage classification needs only the repo allowlist, so omitting them keeps this fire cheap.
 */
export function buildSyncLightPrompt(config: IdlerConfig): string {
  const repos = config.repoAllowlist.join(", ") || "(none — do nothing)";
  if (!config.sources.scanMemory) {
    return `IDLER LIGHT SYNC FIRE — memory triage is disabled (sources.scanMemory is false), so there is nothing to do this fire. End immediately with skip_response. You post nothing.

Allowlisted repos: ${repos}`;
  }
  return `IDLER LIGHT SYNC FIRE — a cheap triage pass that picks up newly-remembered work as it appears. You make NO code changes and post NOTHING; you only read memory and update the ledger. This is NOT the full maintenance pass — do ONLY the triage below, then end.

Allowlisted repos: ${repos}

## Triage recently-changed memory
Other paths (a scheduled message, a Q&A session) may have remembered work-shaped entries the idler never sourced. Pick them up:
   ${MEMORY_TRIAGE_RECIPE}

## Early exit is the expected outcome
Most fires find nothing new: if classification yields NO candidates (every entry on the page is already tracked or already ignored-and-unchanged), end the fire immediately with skip_response. Doing nothing is the correct, common result — never manufacture work or reach for the deep-fire steps to fill the fire.

## Rules
- Do NOT list pull requests, re-poll tracked units' references, run the coldest rotation, or scan discovery channels — those are the deep fire's job.
- Dedup by stable key: a re-emitted entity updates the existing unit, never a duplicate.
- End the fire when done (skip_response). You post nothing to any channel.`;
}

/**
 * The DEEP sync fire: the full-maintenance pass that runs once per sync-window day, at the anchor
 * hour just before the work window opens, to prime the ledger for the first work fire. Every fire
 * runs an unconditional MEMORY MAINTENANCE pass — close resolved units, triage recently-changed
 * memory (gated by `scanMemory`), re-verify the coldest units and park stale ones — then scans ALL
 * enabled external discovery sources (not a round-robin — this is the only fire that scans).
 * `fetchInstructions` is the admin-editable sourcing guidance, baked in at reconcile time.
 */
export function buildSyncDeepPrompt(config: IdlerConfig, fetchInstructions: string): string {
  const repos = config.repoAllowlist.join(", ") || "(none — do nothing)";
  const channels = config.sources.channels.join(", ") || "(none)";

  const triageBlock = config.sources.scanMemory
    ? `2. TRIAGE RECENTLY-CHANGED MEMORY (every fire): other paths (a scheduled message, a Q&A session) may have remembered work-shaped entries the idler never sourced. Pick them up:
   ${MEMORY_TRIAGE_RECIPE}
`
    : "";

  return `IDLER DEEP SYNC FIRE — the full-maintenance pass that primes the ledger before the work window opens. You make NO code changes here; you only read and update the ledger.

Allowlisted repos: ${repos}
Discovery channels: ${channels}
Tracker source enabled: ${config.sources.tracker}
Own-PRs source enabled: ${config.sources.ownPrs}
Memory triage enabled: ${config.sources.scanMemory}

## Memory maintenance (run all of these before discovery)
1. QUICK-FETCH + CLOSE RESOLVED: list open Clack-authored PRs (find_pull_requests on each allowlisted repo, filter by author / clack/ branch prefix). For each tracked unit, re-run its references' howToRead to detect new activity and advance cursors — for PR references, follow the PR-handling contract (canonical review check) from the attached behavior topic instead of the recipe text. When a unit's surface now reads resolved/merged/closed (PR merged or closed, source issue resolved), CLOSE it: call upsert_idea with open:false and a short grace staleAfter (~2 days out) — the same close move the work fire uses — so it leaves selection now and the daily memory review prunes it after the grace. Do NOT touch the unit the work task is actively advancing (leave its nextSteps alone); only refresh/close OTHER units.
${triageBlock}${config.sources.scanMemory ? "3" : "2"}. RE-VERIFY THE COLDEST UNITS AND RECOMPUTE PRIORITY (every deep fire, regardless of memory triage): call list_top_ideas with sort_by: "coldest" and limit 8 to get the least-recently-attended open units — a bounded rotation, NOT the whole ledger. Re-verifying a unit bumps its updatedAt and rotates it to the back, so successive deep fires cover every unit over the days. For EACH returned unit, re-run its references' howToRead to detect activity past the cursor (PR references: follow the PR-handling contract's canonical review check), then make ONE call:
   - FRESH activity (a human reply / new comment past the cursor) → upsert_idea with freshInput: true so it rises. NEVER park a unit that has genuine fresh input.
   - STALE — its overdue flag is true, OR it is long-untouched (old updatedAt) with no new activity past the cursor → PARK it: upsert_idea with blocked: true so it sinks below workable units and drops out of the work fire's window. Parking keeps the unit OPEN (never close or remove it); a later fire auto-resurfaces it via freshInput when its source shows new activity.
   - Otherwise (still active, nothing changed) → refresh its whereWeAre via upsert_idea.

## External discovery (scan ALL enabled sources this fire — the deep fire is the only fire that scans)
Scan every enabled discovery channel, poll the tracker, AND inspect own PRs — per the sourcing instructions below. (Memory is NOT a discovery source here; it is maintained above.) For each NEW item (no live memory entry), FIRST call get_archived with its stable id to check whether it was already handled and resolved before. On a hit, still create the unit but ENRICH its what/whereWeAre with the prior outcome (e.g. "fixed before in PR #123 — this re-appearance may be a regression") — do NOT skip it; a recurrence is real work. Then create the unit via upsert_idea, keyed by its STABLE source-entity id (an issue/ticket id or PR number — NOT a message ts). Populate each reference's howToRead AND howToComment recipe now, and set what/why plus a best-guess staleAfter (date + reason) so the daily memory review can later prune it.

## Rules
- If a source's MCP tools are not available, skip that source silently — no error.
- Dedup by stable key: a re-emitted entity (e.g. a re-alerting Sentry issue) updates the existing unit, never a duplicate.
- End the fire when done (skip_response). You post nothing to any channel.

## Sourcing instructions (admin-editable)
${fetchInstructions}`;
}
