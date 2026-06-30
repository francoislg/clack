import type { IdlerConfig } from "../types.js";

/**
 * The sync fire: read-only backlog maintenance. Has NO change tools and acquires no worktree.
 *
 * Every fire runs an unconditional MEMORY MAINTENANCE pass — close resolved units, triage
 * recently-changed memory (gated by `scanMemory`), re-verify the coldest units and park stale ones
 * via the blocked sink — then rotates through the EXTERNAL discovery sources one-per-fire. Memory is NOT part of the round-robin: it is maintained
 * every fire so newly-remembered work is picked up promptly. `fetchInstructions` is the
 * admin-editable sourcing guidance, baked in at reconcile time.
 */
export function buildSyncPrompt(config: IdlerConfig, fetchInstructions: string): string {
  const repos = config.repoAllowlist.join(", ") || "(none — do nothing)";
  const channels = config.sources.channels.join(", ") || "(none)";

  const triageBlock = config.sources.scanMemory
    ? `2. TRIAGE RECENTLY-CHANGED MEMORY (every fire): other paths (a scheduled message, a Q&A session) may have remembered work-shaped entries the idler never sourced. Pick them up:
   a. Call recall with no query and limit 50 (newest-updatedAt first).
   b. Classify EVERY entry on the page by its plugins.idler slice:
      - NO plugins.idler slice → CANDIDATE (untriaged).
      - plugins.idler.ignoredAt EQUALS the entry's updatedAt → SKIP (already triaged as not-work, unchanged since).
      - plugins.idler.ignoredAt PRESENT but DIFFERS from updatedAt → CANDIDATE (re-remembered/edited since it was ignored — re-evaluate).
      - plugins.idler slice WITHOUT ignoredAt → SKIP (already a tracked work unit; handled by steps 1 and 3).
   c. Take up to 10 candidates (classify the whole page FIRST, then take, so you reach older untriaged entries when the newest are all triaged). For each:
      - Clearly actionable AND it concerns an allowlisted repo → adopt it: call get_archived by its id (enrich on a hit, as in DISCOVERY), then upsert_idea keyed by its existing id with the right kind.
      - Otherwise (a preference, a note, out-of-allowlist, or unclear) → call upsert_idea with ignore: true to mark it not-idler-work. Default to ignore when in doubt.
`
    : "";

  return `IDLER SYNC FIRE — refresh the backlog. You make NO code changes here; you only read and update the ledger.

Allowlisted repos: ${repos}
Discovery channels: ${channels}
Tracker source enabled: ${config.sources.tracker}
Own-PRs source enabled: ${config.sources.ownPrs}
Memory triage enabled: ${config.sources.scanMemory}

## Memory maintenance (EVERY fire — run all of these before discovery)
1. QUICK-FETCH + CLOSE RESOLVED: list open Clack-authored PRs (find_pull_requests on each allowlisted repo, filter by author / clack/ branch prefix). For each tracked unit, re-run its references' howToRead to detect new activity and advance cursors. When a unit's surface now reads resolved/merged/closed (PR merged or closed, source issue resolved), CLOSE it: call upsert_idea with open:false and a short grace staleAfter (~2 days out) — the same close move the work fire uses — so it leaves selection now and the daily memory review prunes it after the grace. Do NOT touch the unit the work task is actively advancing (leave its nextSteps alone); only refresh/close OTHER units.
${triageBlock}${config.sources.scanMemory ? "3" : "2"}. RE-VERIFY THE COLDEST UNITS (every fire, regardless of memory triage): call list_top_ideas with sort_by: "coldest" and limit 8 to get the least-recently-attended open units — a bounded rotation, NOT the whole ledger. Re-verifying a unit bumps its updatedAt and rotates it to the back, so successive fires cover every unit over time. For EACH returned unit, re-run its references' howToRead to detect activity past the cursor, then make ONE call:
   - FRESH activity (a human reply / new comment past the cursor) → upsert_idea with freshInput: true so it rises. NEVER park a unit that has genuine fresh input.
   - STALE — its overdue flag is true, OR it is long-untouched (old updatedAt) with no new activity past the cursor → PARK it: upsert_idea with blocked: true so it sinks below workable units and drops out of the work fire's window. Parking keeps the unit OPEN (never close or remove it); a later fire auto-resurfaces it via freshInput when its source shows new activity.
   - Otherwise (still active, nothing changed) → refresh its whereWeAre via upsert_idea.

## External discovery (rotate — do ONE source per fire, round-robin, so every external source is covered across the window)
Scan a discovery channel, OR poll the tracker, OR inspect own PRs — per the sourcing instructions below. (Memory is NOT a discovery source here; it is maintained every fire above.) For each NEW item (no live memory entry), FIRST call get_archived with its stable id to check whether it was already handled and resolved before. On a hit, still create the unit but ENRICH its what/whereWeAre with the prior outcome (e.g. "fixed before in PR #123 — this re-appearance may be a regression") — do NOT skip it; a recurrence is real work. Then create the unit via upsert_idea, keyed by its STABLE source-entity id (an issue/ticket id or PR number — NOT a message ts). Populate each reference's howToRead AND howToComment recipe now, and set what/why plus a best-guess staleAfter (date + reason) so the daily memory review can later prune it.

## Rules
- If a source's MCP tools are not available, skip that source silently — no error.
- Dedup by stable key: a re-emitted entity (e.g. a re-alerting Sentry issue) updates the existing unit, never a duplicate.
- End the fire when done (skip_response). You post nothing to any channel.

## Sourcing instructions (admin-editable)
${fetchInstructions}`;
}
