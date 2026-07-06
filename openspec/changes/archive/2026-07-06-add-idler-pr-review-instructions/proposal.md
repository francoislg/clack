# Add Idler PR Review Instructions

## Why

The idler's detection of new PR reviews is delegated to each unit's self-authored free-text `howToRead` recipe — no idler instruction ever mandates checking formal PR reviews (`pull_request_read` with `get_reviews`/`get_review_comments`), the GitHub MCP server is `alwaysLoad: false` so those tools aren't even loaded during a fire unless Claude spontaneously attaches the integration, and the core `find_pull_requests` tool returns no review data. A new review on a Clack PR — the single highest-priority signal in the idler's ladder (continue + freshInput) — can therefore go completely undetected. The ranking machinery is correct; detection is the gap.

## What Changes

- Add a **canonical PR-handling contract** to the shipped idler behavior topic (`src/plugins/idler/instructions.ts`): whenever any tracked unit has a PR reference (or open Clack-authored PRs exist), attach the `github` integration, probe each PR with `pull_request_read` (`get_reviews`) against the reference cursor, and on a hit read full content via `get_comments` + `get_review_comments`, then mark the unit `freshInput: true` (kind `continue`).
- The contract **overrides free-text recipes for PR references**: for any reference pointing at a PR, the canonical review check always runs regardless of what the unit's `howToRead` says (the recipe still governs non-PR surfaces). No recipe migration/repair is needed — stale recipes are harmless and age out via `staleAfter` pruning.
- Add a one-line pointer to the PR-handling contract in the **sync prompt** (quick-fetch step and coldest-units re-verify step) and the **work prompt** (re-read-references step) so both consumers apply it.
- Sharpen the default fetch-instructions' own-PRs blurb to reference the contract (best-effort — existing deployments with an edited `fetch-instructions.md` won't pick this up, which is why the load-bearing text lives in the shipped topic).

No schema, tool, config, or persisted-state changes — instruction/prompt text only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `idler-plugin`: the behavior contract gains a canonical PR review-checking requirement — attach the GitHub integration when PR references are in play, probe reviews with `get_reviews` vs the cursor, read content with `get_comments`/`get_review_comments`, and treat a new review as `continue` work with `freshInput` — applied by both the sync and work fires, overriding per-unit `howToRead` text for PR references.

## Impact

- `src/plugins/idler/instructions.ts` — new PR-handling section in `BEHAVIOR_INSTRUCTION` (topic attached to every idler fire).
- `src/plugins/idler/prompts/sync.ts` — pointer in the quick-fetch/maintenance steps.
- `src/plugins/idler/prompts/work.ts` — pointer in the re-read-references step.
- `src/plugins/idler/fetchInstructions.ts` — sharpened default own-PRs guidance.
- Existing tests referencing these prompt strings (`instructions.test.ts`, `prompts/sync.test.ts`) may need assertion updates.
- No runtime/token cost when no PR references exist — the attach is gated on PRs being in play.
