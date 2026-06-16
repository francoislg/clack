---
name: handle-reviews
description: "Triage, fix, and resolve review feedback on your PR. Use when the user asks to handle review comments, address PR feedback, respond to a code review, or resolve review threads."
---

Handle code review feedback for the current PR.

Follow these steps carefully.

---

## Step 1: Resolve the PR

- Parse the user's request for a PR reference (number, URL, or branch name). If empty, default to the current branch.
- Fetch PR metadata:
  ```bash
  gh pr view <ref> --json number,title,url,headRefName,baseRefName
  ```
- If no PR is found, inform the user and stop.
- Store the PR number, owner/repo (from the URL), and branch info for later use.
- **Confirm you're on the PR branch**: run `git branch --show-current` and compare it to the PR's `headRefName`. If they don't match, switch to the PR branch (`git checkout <headRefName>`).
- **Check if branch is behind base**: run `git fetch origin <baseRefName>` then `git rev-list --count HEAD..origin/<baseRefName>` to see how many commits behind. If the count is > 0, rebase onto the base branch (`git rebase origin/<baseRefName>`) before continuing.

---

## Step 2: Fetch all review feedback

Use the GitHub GraphQL API to fetch **both** review threads and PR comments in a single query. Extract the owner and repo from the PR URL (e.g., `https://github.com/OWNER/REPO/pull/N`).

```bash
gh api graphql -f query='
  query {
    repository(owner: "OWNER", name: "REPO") {
      pullRequest(number: N) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 10) {
              nodes {
                body
                author { login }
                path
                line
                createdAt
              }
            }
          }
        }
        comments(first: 50) {
          nodes {
            id
            body
            author { login }
            createdAt
          }
        }
      }
    }
  }
'
```

### Review threads
- Filter to only **unresolved** threads (`isResolved: false`).

### PR comments
- GitHub PRs have two kinds of comments: **review threads** (inline, attached to file + line in the diff) and **PR comments** (posted in the conversation tab, not attached to code).
- Automated review bots (e.g., Claude code review) typically post PR comments, not review threads.
- Filter PR comments to only those that contain **actionable review feedback**. Skip comments that are purely informational (merge notifications, CI status updates, bot metadata). A comment is actionable if it suggests code changes, flags issues, or requests modifications.
- PR comments don't have file:line info directly, but often reference specific files and lines in their body text. Parse these references when presenting to the user.

Also fetch the PR's CI check status:
```bash
gh pr checks <ref>
```

- Parse the output to identify any **failing** or **pending** checks.
- If there are no unresolved threads, no actionable PR comments, AND no failing checks, inform the user that everything looks good and stop.
- If there is no actionable feedback but there ARE failing checks, skip ahead to Step 3 (show only the checks section) and stop after that — there is nothing to triage.

---

## Step 3: Present summary to the user

### Failing checks

If any CI checks are failing or pending, display them first:

```
## CI Checks

| Status | Check                    | Details                          |
|--------|--------------------------|----------------------------------|
| FAIL   | tests / unit-tests       | 2 tests failed (link)            |
| FAIL   | lint / eslint            | 3 errors found (link)            |
| PASS   | build / webpack          |                                  |
| ...                                                                     |
```

- Show the check name, status, and the details URL so the user can investigate.
- If there are failures, suggest the user investigate them (e.g., read the logs via the details link, run the relevant checks locally).
- Checks are not part of the thread triage flow below — they are handled separately in Step 8, which monitors CI at the end and fixes any failures.

### Review feedback

Use a **single numbered list** that combines both review threads and PR comments. This gives the user one unified list to triage in Step 4.

For each item, display a summary table with:
- Item number (sequential across both types)
- Type: `thread` or `comment`
- Location: file:line for threads, `PR conversation` for comments
- Author
- First line (or first ~80 chars) of the feedback

Example format:

```
# Review Feedback (3 items)

| #  | Type    | Location                           | Author | Summary                                  |
|----|---------|------------------------------------|--------|------------------------------------------|
| 1  | thread  | src/components/Button.tsx:42       | alice  | Consider using a constant for this va... |
| 2  | thread  | src/utils/format.ts:15             | bob    | This could cause a runtime error if...   |
| 3  | comment | PR conversation                    | claude | [3 actionable items extracted]            |
```

**For PR comments that contain multiple actionable items** (common with bot reviews like Claude), break them into separate numbered items — one per actionable suggestion. Parse the comment body for distinct issues (often separated by headings, bullet points, or numbered lists). Each sub-item gets its own number in the unified list. Include the file:line references found in the comment body as the location.

Then show the full comment body for each item so the user has all the context.

---

## Step 4: Ask the user what to do

Ask the user how to handle all threads at once. Present each thread and ask the user to categorize it.

For efficiency, ask about all threads in a single interaction:
- Present all threads with their full comments
- Ask the user to specify which threads to **fix** and which to **skip** (with reasons for skips)
- The user can type something like: "Fix 1, 2, 4. Skip 3 (already handled elsewhere), Skip 5 (intentional design choice)"

If the user wants to fix ALL threads, they can just say "Fix all".

---

## Step 5: Fix items

For each item marked as "fix":
- Read the affected file (for review threads, the path/line comes from the thread metadata; for PR comment items, parse file references from the comment body).
- Understand the reviewer's feedback and implement the fix.
- Format modified files using the repo's formatter (check for prettier, biome, oxfmt, or similar in `package.json` / config files).
- Follow existing code patterns and conventions.

---

## Step 6: Commit and push

If any fixes were made:

1. Show a summary of all changed files (`git status`).
2. **Run the repository's validation checks** before pushing. Look for available scripts in the repo's `package.json` (or equivalent config) and run the relevant ones — typically linting and type-checking (e.g., `yarn lint`, `yarn test:ts`, `npm run lint`, etc.). If checks fail, show the errors and stop — do not push broken code.
3. Stage the changed files (only files that were modified by the fixes).
4. Create a commit with a descriptive message following conventional commits (e.g., `fix: address code review feedback`). Include a body listing what was changed.
5. Push to the PR branch.

If no fixes were made (all items were skipped), skip straight to Step 7.

---

## Step 7: Post replies and resolve

Only run this step after the commit has been pushed (or if all items were skipped).

Only reply to and resolve **review threads**. PR comments are used for context during triage but do not get replies.

**Fixed:**
1. Reply to the thread:
   ```bash
   gh api graphql -f query='
     mutation {
       addPullRequestReviewThreadReply(input: {
         pullRequestReviewThreadId: "THREAD_ID",
         body: "Done -- <brief description of what was changed>"
       }) {
         comment { id }
       }
     }
   '
   ```
2. Resolve the thread:
   ```bash
   gh api graphql -f query='
     mutation {
       resolveReviewThread(input: {
         threadId: "THREAD_ID"
       }) {
         thread { isResolved }
       }
     }
   '
   ```

**Skipped:**
1. Reply with the user's explanation (same `addPullRequestReviewThreadReply` mutation).
2. Resolve the thread (same `resolveReviewThread` mutation).

---

## Step 8: Monitor CI and fix failures

After the push, the new commit triggers CI. Monitor it until the checks settle, and if anything is failing, fix it.

1. **Poll the check status until it settles.** Take a snapshot with `gh pr checks <ref>` — its exit code is the signal:
   - `0` — all checks passed.
   - `8` — checks still pending/running.
   - `1` — at least one check failed.

   Loop: take a snapshot, and while the exit code is `8` (pending), wait an interval (e.g. `sleep 30`) and snapshot again. Cap the total wait (e.g. ~15 minutes) so you never block indefinitely — if checks are still pending at the cap, report that CI hasn't finished and hand back to the user rather than waiting forever. Do **not** use `gh pr checks --watch`: it blocks a single command for the whole CI run, which can exceed the command timeout.
2. If the exit code is `0` (all checks **pass**), report green and continue to Step 9.
3. If the exit code is `1` (a check is **failing**):
   - Identify the failing check(s) and read the logs to understand the cause:
     ```bash
     gh run view <run-id> --log-failed
     ```
     (get `<run-id>` from `gh pr checks <ref>` or `gh run list --branch <headRefName>`).
   - Diagnose and **fix the underlying cause** — failing tests, lint/format errors, type errors, broken build, etc. Reproduce locally where possible (e.g., run the relevant `package.json` script) so you can confirm the fix before pushing.
   - Re-run the repository's validation checks locally to confirm the fix.
   - Commit the fix (`fix: resolve CI failures` or a more specific message) and push.
   - **Loop back to step 1** of this step and re-monitor.
4. **Bail-out:** if the same check keeps failing after a few fix attempts, or a failure is outside your control (e.g., flaky infra, missing secrets, an unrelated pre-existing failure), stop looping. Report the failing check, what you tried, and the likely cause so the user can take over.

---

## Step 9: Summary

Display a final summary:
- Total items processed
- How many were fixed (list the file:line for each)
- How many were skipped (list the file:line and reason for each)
- Whether changes were pushed
- Confirmation that all threads are now resolved on GitHub
- Final CI status (green, or the failing checks left for the user with a brief diagnosis)

---

## Important Notes

- Thread IDs from the GraphQL API are opaque strings (e.g., `PRRT_kwDO...`). Use them as-is in mutations.
- Always use `gh api graphql` for GitHub API calls — never raw curl.
- When replying to threads, keep messages concise and professional.
- **Never mention `@claude` in reply comments.** This will ping the Claude review bot and trigger an unnecessary review cycle. Use `claude` (without the `@`) when referring to the bot's feedback.
- If a GraphQL mutation fails, show the error and continue with remaining threads rather than stopping entirely.
- **Never post replies or resolve threads before the fixes are pushed.** The push must land first so that the reply comments reference code that's already on the branch.
