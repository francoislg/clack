# Design — Add Idler PR Review Instructions

## Context

The idler's priority machinery already ranks a new review on a Clack PR as the top signal (`continue` = 400 + `freshInput` bump), but nothing guarantees the review is ever *seen*:

- Review detection is delegated to each unit's free-text `howToRead` recipe, authored by Claude at discovery time. A recipe written as "find_pull_requests + check comments" is permanently blind to formal reviews.
- The GitHub MCP server is registered with `alwaysLoad: false` — `pull_request_read` (`get_reviews`/`get_review_comments`/`get_comments`) is not loaded in an idler fire unless Claude calls `attach_integration("github")` mid-session. `CronJobSpec.attachedTopics` pre-loads topic *instructions* only, never MCP tools (verified: `preAttachedTopics` feeds only `promptBuilder.ts`).
- The core `find_pull_requests` tool is deliberately lean: number/title/state/branch/author/`updatedAt` — no review data.
- `data/default_configuration/dev/github.md` already documents the three-method reading pattern (`get_reviews` = metadata only; content lives in `get_comments` + `get_review_comments`) and is loaded as a baseline, but it's dormant knowledge without the tools attached and without a contract pointing PR checks at it.

The fix is instruction-text only — no schema, tool, or state changes.

## Goals / Non-Goals

**Goals:**

- Make PR review checking a **contract**, not a hope: every sync and work fire that touches a PR reference runs the canonical review check.
- New reviews on tracked PRs reliably produce `upsert_idea` with `freshInput: true` (kind `continue`) so the existing priority machinery surfaces them first.
- Zero added cost on fires with no PR references in play.

**Non-Goals:**

- No recipe migration/repair for existing ledger units (the contract overrides recipes for PR references, making stale recipes harmless).
- No typed PR references or core-code polling (structural option deliberately rejected — instructions suffice).
- No changes to priority weights, the kind ladder, cursors' shape, or any persisted state.
- No new tools, no MCP registry changes (`github` stays `alwaysLoad: false`).

## Decisions

### 1. The canonical check lives in the behavior topic, not the prompts or fetch-instructions

`BEHAVIOR_INSTRUCTION` (`src/plugins/idler/instructions.ts`) gains a "Handling PR references" section. Rationale:

- It's attached to **every** idler fire (sync, work, summary) via `attachedTopics`, so both consumers inherit it from one place.
- It's shipped and non-editable — an admin editing `fetch-instructions.md` cannot break review detection (consistent with the existing two-layer split: contract vs sourcing).
- Alternative considered: putting the full recipe in each prompt — rejected as duplication; the prompts get one-line pointers instead.

### 2. Contract overrides free-text recipes for PR references

For any reference that points at a PR, the canonical check ALWAYS runs regardless of the unit's `howToRead` text; the recipe still governs non-PR surfaces. This makes existing blind recipes harmless without a repair pass — closed units are pruned days later via `staleAfter`, so blind recipes age out naturally.

- Alternative considered: instruct recipe repair during the coldest-units rotation — rejected as unnecessary bookkeeping once the override exists.

### 3. Gated attach, cheap probe, full read on hit

The contract's sequence:

1. **Gate**: only when a tracked unit has a PR reference OR the quick-fetch lists open Clack-authored PRs → `attach_integration("github")`. No PRs in play → skip entirely (no token/latency cost).
2. **Probe** (cheap): `pull_request_read` method `get_reviews` per PR — compare the latest review timestamp against the reference cursor.
3. **Read on hit** (full): `get_comments` (review summary bodies) + `get_review_comments` (inline threads) — echoing the `dev/github.md` warning that `get_reviews` alone returns metadata without body text.
4. **Record**: `upsert_idea` with `freshInput: true`, kind `continue`, and advance `whereWeAre`/cursor notes so the work fire picks it up.

- Alternative considered: always attach `github` on every sync fire — rejected; wasteful on quiet nights.
- Alternative considered: rely on `find_pull_requests.updatedAt` as the freshness signal — rejected as the sole mechanism (coarse, can't distinguish a review from any other event), but it remains a useful pre-filter hint the contract may mention.

### 4. Prompts get pointers, defaults get a sharpened blurb

- `prompts/sync.ts` step 1 (quick-fetch) and the coldest-units re-verify step: "for PR references, follow the PR-handling contract (attached topic)".
- `prompts/work.ts` step 2 (re-read references before committing): same pointer.
- `fetchInstructions.ts` `DEFAULT_FETCH_INSTRUCTIONS` own-PRs section: reference the contract. Best-effort only — deployments with an edited `fetch-instructions.md` keep their copy, which is exactly why the load-bearing text is in the shipped topic.

## Risks / Trade-offs

- **[LLM non-compliance]** Instructions, not code, enforce the check → Mitigation: the contract is in the always-attached topic AND pointed to from both prompt steps; the sequence is imperative and tool-specific ("call X with method Y"), the style that has held for the rest of the idler contract.
- **[Token cost when PRs exist]** Attaching `github` + per-PR probes adds calls to sync fires with open PRs → Accepted: bounded by the number of open Clack PRs (small by design — the idler itself throttles PR creation), and the probe method is the cheap metadata call.
- **[Edited fetch-instructions drift]** Existing deployments won't see the sharpened default blurb → Accepted: the shipped topic carries the contract; the blurb is reinforcement only.
- **[Double-processing with the work fire]** Sync marks `freshInput` while work independently re-reads references → No change to the existing authority rule: sync never touches the unit the work fire is actively advancing; cursors remain the idempotency mechanism.

## Migration Plan

None needed — instruction text is baked into cron prompts at reconcile time and the topic resolves at session start; the next reconcile/fire after deploy picks it up. No state, config, or manifest changes. Rollback = revert the commit.
