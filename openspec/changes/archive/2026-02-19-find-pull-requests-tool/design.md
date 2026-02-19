## Context

When Clack's app restarts, in-memory change sessions are lost. The follow-up tools (`request_update`, `request_review`, etc.) are gated on `ctx.changeSession` existing. Without it, Claude only has `propose_change` available and creates a duplicate PR.

Two fixes work together:
1. **`ensurePR`** (safety net) — the rename of `createPR` that already checks for an existing open PR before creating
2. **`find_pull_requests`** (root fix) — a query tool that lets Claude discover existing PRs and make informed decisions

## Goals / Non-Goals

**Goals:**
- Give Claude visibility into open PRs on GitHub, regardless of in-memory session state
- Rename `createPR` → `ensurePR` to reflect idempotent behavior
- Follow existing query tool patterns (`find_changes`, `find_sessions`)

**Non-Goals:**
- Session reconstruction from discovered PRs (future work — would require re-gating follow-up tools)
- Showing closed/merged PRs (open PRs are the actionable ones)
- Cross-repo PR queries (one repo at a time, matching existing tool patterns)

## Decisions

### D1: Tool returns all open PRs, with optional branch filter

The tool fetches all open PRs for a repo via `octokit.pulls.list({ state: "open" })`, then applies an optional client-side `branch` partial match. This keeps the API simple while supporting both broad queries (`find_pull_requests(repo: "backend")`) and targeted lookups (`find_pull_requests(repo: "backend", branch: "clack/feat/cook-208")`).

Alternative: Use GitHub's `head` parameter for server-side filtering. Rejected because it requires exact `owner:branch` format and doesn't support partial matching.

### D2: Available to dev+ roles, unconditionally

The tool is registered alongside `find_sessions` and `find_changes` for any dev+ user, not gated on `changeSession` or `changesWorkflowEnabled`. This is a read-only query — no reason to restrict it.

### D3: Repo access filtering via existing `getVisibleRepos`

The tool only queries repos the user has read access to, using the same `getVisibleRepos` pattern as `find_changes` and `find_sessions`.

### D4: `ensurePR` is a pure rename + existing idempotent logic

The check-then-create logic is already in place (from the earlier fix). The rename just makes the function name match its behavior. Single call site in `workflow.ts`.

## Risks / Trade-offs

- **GitHub API rate limits** — Each `find_pull_requests` call hits the GitHub API. For repos with many open PRs, this could be noticeable. Mitigated by: Claude only calls it when relevant (system prompt guidance), and the `pulls.list` endpoint is lightweight.
- **Stale data** — PRs could be opened/closed between the tool call and the action. Mitigated by: `ensurePR` independently checks before creating, so the worst case is a slightly stale response to the user.
