## Why

When Clack opens a PR in worker mode, no reviewer is ever requested — `ensure_pr` calls `octokit.pulls.create` with only title/body/head/base, so PRs land with zero reviewers and rely on humans noticing them. Clack also has no idea which GitHub user corresponds to which Slack user, so it cannot pick a reviewer even if asked. This change gives Clack a per-user GitHub-username mapping, a generic tool to maintain it, and an opt-in policy that has Clack choose and request reviewers (by judgement) on every PR it opens — degrading gracefully when it can't.

## What Changes

- **Core `github` identity field** on the user registry record (`github?: { username }`), persisted in `data/state/users.json`, validated by the existing graceful schema, written through a new serialized registry mutator. It is a first-class identity attribute, NOT a plugin namespace.
- **New `update_user` MCP tool** with `upsert_game`-style semantics (omit-to-keep, explicit `null`-to-clear) over an **explicit, typed** field set — not a free-form JSON bag. Field-level permission gating:
  - `display_name` (root identity) — writable by the user themselves or an admin only.
  - `github.username` — writable by **anyone** (so any user can fix a wrong attribution).
  - plugin namespace data — **NOT** writable through this tool (plugins own their slices via the SDK).
- **GitHub → Slack reviewer resolution flow** — when a reviewer's GitHub username is missing, Clack fetches repo collaborators (`repos.listCollaborators`, not org members — non-collaborators can't be requested) and maps them to Slack users by judgement. Only **high-confidence** (case-insensitive exact email) matches are written via `update_user` and used; **low-confidence (name-only) matches are ignored** — never written, never requested — so a wrong guess can't mis-ping anyone and the flow works in autonomous/idler PR creation. Unmapped users are filled in by a later high-confidence run or a human calling `update_user`.
- **New `requirePRReviewers` config flag** (in `config.json`, default `false`). When `true`, `ensure_pr` expects a non-empty, LLM-chosen `reviewers` list; after creating the PR it calls `pulls.requestReviewers`. The PR author is always excluded.
- **Graceful degradation** — a failed or empty reviewer resolution NEVER fails `ensure_pr`. The PR is created regardless; reviewer-request failures are caught, logged, and surfaced as a warning (e.g. "couldn't resolve a reviewer — run `update_user` to map GitHub names"). The config flag expresses intent, not a hard gate that bricks the Changes Workflow.

## Capabilities

### New Capabilities
- `user-update-tool`: The generic `update_user` MCP tool — typed omit-to-keep/null-to-clear field updates over a user record, with per-field permission gating and a hard exclusion of plugin namespace data.
- `pr-reviewer-assignment`: The reviewer policy and resolution flow — the `requirePRReviewers` config flag, GitHub-collaborator → Slack-user mapping by judgement, author exclusion, and the graceful-degradation contract (reviewer failures never fail PR creation).

### Modified Capabilities
- `user-registry`: Add the core `github?: { username }` identity field to the persisted record and a serialized write-through mutator for it, preserving existing plugin namespaces.
- `worker-tools`: `ensure_pr` accepts an optional LLM-chosen `reviewers` argument and, after creating/locating the PR, issues a non-fatal `pulls.requestReviewers` for the resolved logins (author excluded).

## Impact

- **Code:**
  - `src/userRegistry.ts` — new `github` field on `UserRecord` + `userRecordZod`, new `mergeUserGithub`/equivalent serialized writer.
  - `src/tools/` — new `update_user` action tool; permission gating wired through tool context (current user + role).
  - `src/tools/worker/ensurePR.ts` — optional `reviewers` arg, post-create `requestReviewers` call wrapped in its own try/catch, author exclusion.
  - `src/config.ts` / config schema — new `requirePRReviewers` boolean (default `false`).
  - Worker/changes context — plumb the requesting Slack user's resolved GitHub login into `ensure_pr`'s context so Claude can resolve reviewers.
  - Instruction/prompt content for the worker — guidance on the resolution flow (collaborators pool, email join, ignore low-confidence matches, exclude author).
- **APIs:** GitHub `repos.listCollaborators` (new read) and `pulls.requestReviewers` (new write). Requires the GitHub App to have the relevant repo read + PR write permissions. Slack `users:read.email` scope improves match quality (optional).
- **Data:** `data/state/users.json` records gain an optional `github` object — backward compatible (graceful reader tolerates absence).
- **Config:** `config.json` gains `requirePRReviewers` (default `false`); existing deployments are unaffected until enabled.
