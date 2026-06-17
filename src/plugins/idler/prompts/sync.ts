import type { IdlerConfig } from "../types.js";

/**
 * The sync fire: read-only backlog maintenance. Discovers/refreshes work units and recomputes
 * priority. Has NO change tools and acquires no worktree. `fetchInstructions` is the admin-editable
 * sourcing guidance, baked in at reconcile time.
 */
export function buildSyncPrompt(config: IdlerConfig, fetchInstructions: string): string {
  const repos = config.repoAllowlist.join(", ") || "(none — do nothing)";
  const channels = config.sources.channels.join(", ") || "(none)";
  const memorySource = config.sources.scanMemory
    ? ", OR scan recently-updated memory (see MEMORY SCAN below)"
    : "";
  const memoryScanBlock = config.sources.scanMemory
    ? `

## MEMORY SCAN (one of the rotated discovery sources)
Other paths (a scheduled message, a Q&A session) may have remembered work-shaped entries the idler never sourced. To pick them up:
1. Call recall with no query and limit 25 (newest-updatedAt first).
2. Classify each entry by its plugins.idler slice:
   - NO plugins.idler slice → CANDIDATE (untriaged).
   - plugins.idler.ignoredAt EQUALS the entry's updatedAt → SKIP (already triaged as not-work, unchanged since).
   - plugins.idler.ignoredAt PRESENT but DIFFERS from updatedAt → CANDIDATE (re-remembered/edited since it was ignored — re-evaluate).
   - plugins.idler slice WITHOUT ignoredAt → SKIP (already a tracked work unit; handled by the steps above).
3. Take up to 5 candidates (classify the whole page first, then take, so you reach older untriaged entries when the newest are all triaged). For each:
   - Clearly actionable AND it concerns an allowlisted repo → adopt it: call get_archived by its id (enrich on a hit, as in DISCOVERY), then upsert_idea keyed by its existing id with the right kind.
   - Otherwise (a preference, a note, out-of-allowlist, or unclear) → call upsert_idea with ignore: true to mark it not-idler-work. Default to ignore when in doubt.`
    : "";
  return `IDLER SYNC FIRE — refresh the backlog. You make NO code changes here; you only read and update the ledger.

Allowlisted repos: ${repos}
Discovery channels: ${channels}
Tracker source enabled: ${config.sources.tracker}
Own-PRs source enabled: ${config.sources.ownPrs}
Memory scan source enabled: ${config.sources.scanMemory}

## Steps
1. QUICK-FETCH (every fire): list open Clack-authored PRs (find_pull_requests on each allowlisted repo, filter by author / clack/ branch prefix). For each tracked unit, re-run its references' howToRead to detect new activity, and advance cursors.
2. DISCOVERY (rotate — do ONE source per fire, round-robin, so every source is covered across the window): scan a discovery channel, OR poll the tracker, OR inspect own PRs${memorySource} — per the sourcing instructions below. For each NEW item (no live memory entry), FIRST call get_archived with its stable id to check whether it was already handled and resolved before. On a hit, still create the unit but ENRICH its what/whereWeAre with the prior outcome (e.g. "fixed before in PR #123 — this re-appearance may be a regression") — do NOT skip it; a recurrence is real work. Then create the unit via upsert_idea, keyed by its STABLE source-entity id (an issue/ticket id or PR number — NOT a message ts). Populate each reference's howToRead AND howToComment recipe now, and set what/why plus a best-guess staleAfter (date + reason) so the daily memory review can later prune it.
3. RECOMPUTE PRIORITY: for every open unit call upsert_idea with the right kind + freshInput/blocked signals so priority reflects current state. A unit waiting on a human with no new activity is blocked (sinks); a fresh reply/comment past the cursor is freshInput (rises).${memoryScanBlock}

## Rules
- If a source's MCP tools are not available, skip that source silently — no error.
- Do NOT modify the unit the work task is actively advancing (leave its nextSteps alone); only refresh OTHER units' priority/whereWeAre.
- Dedup by stable key: a re-emitted entity (e.g. a re-alerting Sentry issue) updates the existing unit, never a duplicate.
- End the fire when done (skip_response). You post nothing to any channel.

## Sourcing instructions (admin-editable)
${fetchInstructions}`;
}
