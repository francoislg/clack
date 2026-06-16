import type { IdlerConfig } from "../types.js";

/**
 * The sync fire: read-only backlog maintenance. Discovers/refreshes work units and recomputes
 * priority. Has NO change tools and acquires no worktree. `fetchInstructions` is the admin-editable
 * sourcing guidance, baked in at reconcile time.
 */
export function buildSyncPrompt(config: IdlerConfig, fetchInstructions: string): string {
  const repos = config.repoAllowlist.join(", ") || "(none — do nothing)";
  const channels = config.sources.channels.join(", ") || "(none)";
  return `IDLER SYNC FIRE — refresh the backlog. You make NO code changes here; you only read and update the ledger.

Allowlisted repos: ${repos}
Discovery channels: ${channels}
Tracker source enabled: ${config.sources.tracker}
Own-PRs source enabled: ${config.sources.ownPrs}

## Steps
1. QUICK-FETCH (every fire): list open Clack-authored PRs (find_pull_requests on each allowlisted repo, filter by author / clack/ branch prefix). For each tracked unit, re-run its references' howToRead to detect new activity, and advance cursors.
2. DISCOVERY (rotate — do ONE source per fire, round-robin, so every source is covered across the window): scan a discovery channel, OR poll the tracker, OR inspect own PRs — per the sourcing instructions below. Create a unit for each NEW item via upsert_idea, keyed by its STABLE source-entity id (an issue/ticket id or PR number — NOT a message ts). Populate each reference's howToRead AND howToComment recipe now, and set what/why plus a best-guess staleAfter (date + reason) so the daily memory review can later prune it.
3. RECOMPUTE PRIORITY: for every open unit call upsert_idea with the right kind + freshInput/blocked signals so priority reflects current state. A unit waiting on a human with no new activity is blocked (sinks); a fresh reply/comment past the cursor is freshInput (rises).

## Rules
- If a source's MCP tools are not available, skip that source silently — no error.
- Do NOT modify the unit the work task is actively advancing (leave its nextSteps alone); only refresh OTHER units' priority/whereWeAre.
- Dedup by stable key: a re-emitted entity (e.g. a re-alerting Sentry issue) updates the existing unit, never a duplicate.
- End the fire when done (skip_response). You post nothing to any channel.

## Sourcing instructions (admin-editable)
${fetchInstructions}`;
}
