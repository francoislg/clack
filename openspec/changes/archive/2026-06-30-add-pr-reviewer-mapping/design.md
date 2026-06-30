## Context

`ensure_pr` (`src/tools/worker/ensurePR.ts`) is the only PR-creation path in worker mode and calls `octokit.pulls.create({ owner, repo, title, body, head, base })` — no reviewers. There is no Slack→GitHub identity mapping anywhere: `UserRecord` (`src/userRegistry.ts`) holds `userId`, `displayName`, `lastFetched`, and a `plugins.<name>` namespace bag; `find_user` returns only Slack identity. The registry already has a serialized write chain (`serialize()`), a graceful (permissive) zod reader, and a plugin-namespace merge primitive (`mergeUserNamespace`) reachable only through the plugin SDK — no MCP tool can write user metadata today.

This change adds (1) a core identity field for the GitHub username, (2) a generic but typed MCP tool to maintain user fields with per-field permission gating, and (3) an opt-in reviewer-request policy on `ensure_pr` driven by Claude's judgement, degrading gracefully.

## Goals / Non-Goals

**Goals:**
- Persist a per-user GitHub username as a first-class identity attribute, backward-compatible with existing `users.json`.
- One generic `update_user` tool (omit-to-keep / null-to-clear), typed surface, field-level permissions.
- Let Clack request reviewers on PRs it opens, chosen by judgement, gated by an opt-in config flag.
- Never let reviewer logic fail PR creation.

**Non-Goals:**
- No static reviewer list in config (the LLM chooses; the flag only expresses "reviewers are expected").
- No autonomous bulk identity mapping written silently — low-confidence guesses are confirmed, not persisted blindly.
- No change to merge/close/CI worker tools beyond `ensure_pr`.
- No new Slack scopes are *required*; `users:read.email` only improves match quality.

## Decisions

### Decision 1: `github` is a core field, not a plugin namespace

`UserRecord` gains `github?: { username: string }` as a sibling of `displayName`, NOT an entry under `plugins`. GitHub identity is a core attribute of the user, not data owned by a plugin; squatting a fake `plugins.github` slice would abuse the namespace contract and require a fake plugin owner.

- Add to `userRecordZod` as `github: z.object({ username: z.string() }).optional()` — graceful reader stays permissive, old files without the field load fine.
- Add a serialized `mergeUserGithub(userId, github | null)` (or fold into a small `updateUserCore`) following `upsertIdentity`'s pattern: load → merge → persist under `serialize()`, preserving `plugins`. `null` removes the field.
- **Alternatives considered:** reuse `mergeUserNamespace("github", ...)` — rejected, conflates plugin data with core identity and would surface in `getUserNamespace`.

### Decision 2: `update_user` is generic in mechanics, typed in surface

The tool mirrors `upsert_game`'s omit-to-keep / null-to-clear semantics but over an **explicit zod schema**, per the project rule that anything persisted is shaped by a zod schema that is the single source of truth — not a free-form `JsonObject`.

- Args: `{ user_id: string, display_name?: string | null, github?: { username: string } | null }`. Absent key = keep; explicit `null` = clear; value = set.
- Plugin namespace data is **unreachable** through this tool (no arg accepts it) — satisfies "we cannot update plugin data" structurally, not just by check.
- **Per-field permission gating** (resolved from tool context: current Slack user + role):
  - `display_name`: allowed iff `caller === user_id` OR caller is admin+. Otherwise reject that field.
  - `github.username`: allowed for **anyone** (any role, any user, including editing another user's mapping) — the explicit requirement so wrong attributions are fixable by whoever notices.
  - A single call touching `display_name` without permission is rejected with a clear error; it does not silently drop the field.
- **Alternatives considered:** separate `set_display_name` + `set_github_username` tools — rejected, more tool surface for the same thing; the `upsert_game` precedent argues for one tool with field semantics.

### Decision 3: reviewer resolution is a worker-prompt flow over collaborators, joined by email

When `requirePRReviewers` is on and a candidate reviewer lacks a stored `github.username`, the worker resolves it before `ensure_pr`:

- Candidate pool = everyone with access to **this repo** via `repos.listCollaborators` (default affiliation, which includes org members who have repo access AND outside collaborators) — NOT the whole org roster (`orgs.listMembers`). GitHub 422s if a requested reviewer isn't a collaborator on the repo. Do NOT restrict to `affiliation=outside` — org members with repo access are valid reviewers. **Claude fetches this list at runtime via the auto-injected GitHub MCP tools** (the `github-mcp-server` already available in worker mode) — collaborators are NOT pre-fetched and plumbed by Clack code.
- A **high-confidence match** = case-insensitive exact equality of the Slack profile email and a collaborator's email → write via `update_user` and use as a reviewer. **Low-confidence (name-only / partial) matches are ignored entirely** — never written, never requested; the user stays unmapped until a high-confidence run or a human `update_user` fills it in. Rationale: zero mis-ping/leak risk and it works in autonomous/idler PR creation where no human is watching to confirm a guess.
- The ONLY thing Clack code plumbs into `ensure_pr`'s worker context is the requesting Slack user's resolved GitHub login (so Claude has a default candidate and can exclude the author); everything else is Claude-driven over the GitHub MCP tools.
- **Alternatives considered:** org-member pool — rejected (non-collaborators can't be requested); name-matching with auto-write — rejected (mis-ping / leak risk); name-matching with interactive in-thread confirmation — rejected (blocks on a human, breaks autonomous/idler PR creation).

### Decision 4: the config flag is intent, not a hard gate

`requirePRReviewers: boolean` (default `false`) in `config.json`, parsed through the existing config zod schema (fail-fast boot reader). When `true`:

- `ensure_pr` expects a non-empty `reviewers: string[]` (GitHub logins) and, after create/locate, calls `pulls.requestReviewers({ owner, repo, pull_number, reviewers })` with the author removed.
- **The PR is created regardless of reviewer outcome.** `requestReviewers` runs in its own try/catch; a 422 (bad login, author-in-list, non-collaborator) or any error is logged and surfaced as a non-fatal warning in the tool result — it never throws out of `ensure_pr`. When the flag is `true` but the resolved list is empty (reviewers were *expected* but none could be resolved), that too surfaces a non-fatal warning.
- When the flag is `false`, behavior is identical to today (no reviewers arg honored, no `requestReviewers` call, **no warning** — an empty/omitted list is the normal path here, not a failure).

## Risks / Trade-offs

- **Wrong Slack→GitHub mapping pings/leaks to the wrong person** → only high-confidence (exact email) matches are ever written or requested; low-confidence guesses are ignored entirely (never written, never requested); and `github.username` is editable by anyone so a wrong map is self-serviceable.
- **`requirePRReviewers` could brick the Changes Workflow if treated as a hard gate** → explicit graceful-degradation contract: reviewer failures never fail PR creation; the PR always lands.
- **`github.username` writable by anyone enables griefing** (user A sets a wrong username for user B) → accepted trade-off per requirement; mitigated because it only affects reviewer routing (non-destructive) and is trivially correctable by anyone. Mutations flow through the serialized write chain so concurrent edits don't corrupt the file.
- **Requesting a non-collaborator 422s** → pool restricted to `repos.listCollaborators`; the request is non-fatal anyway.
- **GitHub App may lack scope** for `listCollaborators` / `requestReviewers` → document required permissions; failures degrade to a warning, not a crash.

## Migration Plan

- No data migration needed — `github` is optional and the graceful reader tolerates its absence in existing `users.json`.
- `requirePRReviewers` defaults `false`; deployments are unaffected until an admin opts in.
- Rollback: remove/disable the flag → `ensure_pr` reverts to today's behavior; the `github` field and `update_user` tool are inert when unused.

## Open Questions

- Should `requirePRReviewers` be global (`config.json` root) or per-repo (`RepositoryConfig`)? Proposal assumes global; per-repo is a straightforward follow-up if needed.
- When resolution yields zero reviewers under an enabled flag, is the warning surfaced only to Claude (tool result) or also DM'd to the requester? Proposal assumes tool-result warning; DM is optional polish.
