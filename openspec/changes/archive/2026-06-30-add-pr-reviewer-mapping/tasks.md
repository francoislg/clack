## 1. Registry: core github field

- [x] 1.1 Add `github?: { username: string }` to `UserRecord` and to `userRecordZod` (`src/userRegistry.ts`), keeping the reader graceful (optional, old files load unchanged); confirm `github` is a core field, not under `plugins`. Parse the `github` sub-field TOLERANTLY (e.g. `.catch(undefined)`) so a malformed value is logged and dropped to absent rather than failing the record/registry parse.
- [x] 1.2 Add a serialized write-through mutator `mergeUserGithub(userId, github | null)` (named as a sibling of `mergeUserNamespace`) following `upsertIdentity`'s pattern: load → merge/clear → persist via `serialize()`, preserving `plugins`, `displayName`, `lastFetched`; create a placeholder record for an unknown `userId`.
- [x] 1.3 Unit-test the mutator: set preserves other fields, `null` clears, legacy record without `github` loads, malformed `github` logged + dropped to absent with record preserved, unknown user creates placeholder, concurrent same-user writes serialize (mock the registry file boundary).

## 2. update_user MCP tool

- [x] 2.1 Create `src/tools/actions/updateUser.ts` — typed zod args `{ user_id, display_name?: string | null, github?: { username: string } | null }` with omit-to-keep / null-to-clear; no free-form bag, no plugin-namespace arg.
- [x] 2.2 Implement field-level permission gating from tool context (current user + role): `display_name` → self or admin+; `github.username` → anyone. Reject (don't silently drop) an unauthorized `display_name` write with a clear English error.
- [x] 2.3 Wire the tool into the tool server/gating (`src/tools/server.ts`) and surface the current Slack user + role into its context if not already available.
- [x] 2.4 Unit-test: omit keeps, null clears, plugin data unreachable, self/admin display_name allowed, non-admin cross-user display_name rejected, anyone can set any user's github, multi-field call with one unauthorized field rejected atomically (no field applied). Serialization is covered by the registry mutator's own tests (1.3) since `update_user` delegates to it — no separate concurrency test here.

## 3. Config: requirePRReviewers

- [x] 3.1 Add `requirePRReviewers: boolean` (default `false`) to the boot config zod schema (`src/config.ts` / config schemas), fail-fast parsing.
- [x] 3.2 In `src/changes/execution.ts` (where the worker context is built), thread the resolved `requirePRReviewers` flag onto the worker tool context so `ensure_pr` can read it. Extend the worker context type in `src/changes/types.ts`.
- [x] 3.3 Test: absent/false → flag resolves false; true parses; invalid type rejected at boot.

## 4. ensure_pr reviewer request

- [x] 4.1 Add optional `reviewers: string[]` arg to `ensure_pr` (`src/tools/worker/ensurePR.ts`).
- [x] 4.2 After create/locate, when reviewers present, call `octokit.pulls.requestReviewers` with the PR author excluded — wrapped in its own try/catch.
- [x] 4.3 Make the reviewer step non-fatal: on any error, or on a flag-enabled-but-empty/unresolved list, log + add a non-fatal `warning` to the result (suggesting `update_user`), never throw, never roll back the PR. (Empty/omitted list when the flag is false is the normal path — no warning; see 4.4.)
- [x] 4.4 Gate on the flag: when `requirePRReviewers` is false (or no/empty reviewers given), keep current behavior exactly — the `reviewers` arg is ignored and no `requestReviewers` call is made.
- [x] 4.5 Update `ensurePR.test.ts`: reviewers requested on success, author excluded, requestReviewers failure stays `success: true` with warning, empty `reviewers: []` makes no request, and **flag false + reviewers passed → reviewers ignored, no request** (the flag gate).

## 5. Reviewer resolution flow (worker context + prompt)

- [x] 5.1 In `src/changes/execution.ts` (where the worker context is built), load the requesting user's registry record, extract `github.username`, and add it to the worker context as an optional `requestingUserGithubUsername` (null when unmapped). Extend the worker context type in `src/changes/types.ts`. Collaborators themselves are NOT plumbed by code — Claude fetches them at runtime via the auto-injected GitHub MCP tools (see 5.2).
- [x] 5.2 Add worker reviewer-resolution guidance to the worker prompt (`src/changes/execution.ts`, alongside the existing ensure_pr step). Cover the two paths explicitly: (a) **high-confidence** — when the Slack user's email is available, fetch collaborators via the GitHub MCP tools, match by case-insensitive exact email, and persist via `update_user`; (b) **fallback** — when email is unavailable or there is no exact email match, the user stays unmapped: do NOT write a name-only guess via `update_user` and do NOT request them as a reviewer. Note `users:read.email` is optional and matching degrades gracefully without it. Always exclude the author (`requestingUserGithubUsername`). Keep this content English (via-Claude path).
- [x] 5.3 Unit-test the context plumbing (`execution.test.ts`, mock the registry boundary): `requestingUserGithubUsername` is the requester's stored `github.username` when present, and `null` when the record is missing or has no `github`.
- [x] 5.4 Document required GitHub App permissions in `CLAUDE.md` (a "GitHub App scope requirements" note): `repos.listCollaborators` read + `pulls.requestReviewers` write. No fail-fast boot check — missing scope degrades to a non-fatal warning at runtime (per the never-fail-PR contract), so a startup gate would be stricter than the design intends.

## 6. Verification

- [x] 6.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` on changed files; full `npm test` green.
- [x] 6.2 `openspec validate add-pr-reviewer-mapping --strict` passes.
- [ ] 6.3 Manual sanity: with flag off, PRs open exactly as before; with flag on and a mapped user, a reviewer is requested; with flag on and no mapping, PR still opens with a warning.
