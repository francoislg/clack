# Design: Developer Change Request Workflow

## Context

Clack currently operates in read-only mode, answering questions about codebases. Devs have requested the ability to trigger small code changes through Slack, with Clack autonomously creating a PR. This requires a significant shift from read-only queries to write-enabled autonomous execution.

**Key constraints:**
- No user interaction during autonomous execution (Claude works alone)
- Must isolate changes from the main repository (use git worktrees)
- Must respect repo's PR conventions (templates, branch naming)
- Must enforce role-based access (only devs can trigger)
- Docker deployment must support write operations safely

## Goals / Non-Goals

**Goals:**
- Enable devs to trigger code changes via Slack DMs
- Autonomously create worktrees, implement changes, and open PRs
- Provide clear feedback on success/failure via Slack thread
- Support configurable PR templates (repo-based + fallback)
- Maintain security through role enforcement

**Non-Goals:**
- Complex multi-file refactors (start with simple fixes)
- Interactive review cycles (PR review happens in GitHub, not Slack)
- Support for non-GitHub remotes (GitHub only initially)
- Auto-merge PRs (always requires human review)

## Decisions

### 1. Worktree Isolation

**Decision:** Use git worktrees instead of cloning separate copies.

**Rationale:**
- Worktrees share the same `.git` directory, saving disk space
- Faster than full clones (no network fetch needed)
- Clean branch isolation without affecting main checkout
- Easy cleanup after PR is created

**Structure:**
```
data/
├── repositories/           # Main checkouts (read-only)
│   └── my-app/
└── worktrees/             # Change worktrees (read-write)
    └── my-app/
        └── fix-login-bug-abc123/
```

### 2. Autonomous Claude Execution

**Decision:** Spawn a new Claude instance with a specialized system prompt and expanded tool permissions.

**Rationale:**
- Different context than Q&A (needs implementation instructions)
- Different tool set (needs Write, Edit, Bash for git/npm)
- Clean separation from query sessions

**Default tools allowed:**
- `Read`, `Glob`, `Grep` - Code exploration
- `Write`, `Edit` - Code modification
- `Bash` - All commands allowed, but sandboxed to worktree

**Worktree sandbox:**
- Claude's `cwd` is set to the worktree directory
- All file operations (Read, Write, Edit, Glob, Grep) are restricted to the worktree
- Bash commands run from within the worktree context
- No access to parent directories, other repositories, or system paths

**Configurable additional tools:**
```json
{
  "changesWorkflow": {
    "additionalAllowedTools": ["WebFetch", "WebSearch"]
  }
}
```

**Tools always disallowed:**
- `Task` - No sub-agents (prevents runaway execution)

### 3. PR Template Resolution

**Decision:** Check repo for template, then Clack data dir, fall back to built-in default.

**Resolution order:**
1. Repo: `.github/PULL_REQUEST_TEMPLATE.md`
2. Repo: `.github/pull_request_template.md`
3. Repo: `docs/PULL_REQUEST_TEMPLATE.md`
4. Clack: `data/templates/pr-template.md` (user-configurable)
5. Built-in default (hardcoded minimal template)

**User can also configure PR instructions in config:**
```json
{
  "changesWorkflow": {
    "prInstructions": "Always include test coverage. Reference JIRA ticket if mentioned."
  }
}
```

These instructions are appended to Claude's system prompt when creating the PR.

### 4. Change Request Detection

**Decision:** Claude-driven semantic detection with top-level workflow config and per-trigger opt-in.

**Rationale:**
- Pattern-based detection is brittle ("how do I fix this?" vs "fix the login bug")
- Claude understands intent through semantic analysis
- Single Claude call handles both detection and planning
- Avoids false positives routing questions to change workflow

**Detection flow:**
1. Check if user is a dev and changes are enabled for trigger
2. Add change detection instructions to Claude's system prompt
3. Claude analyzes message intent:
   - If question → returns `<answer>` tags
   - If change request → returns `<change-request>` tags with branch, description, repo
4. Parse response tags to route to appropriate workflow

**Follow-up command detection:**
- Thread replies in change sessions are analyzed by Claude
- Claude detects intent: review, merge, update, close, or general question
- Returns `<follow-up-command>` tags with command type and any additional instructions

**Config structure:**
```json
{
  "changesWorkflow": {
    "enabled": true,
    "prInstructions": "Always include test coverage.",
    "timeoutMinutes": 10,
    "maxConcurrent": 3
  },
  "directMessages": {
    "enabled": true,
    "changesWorkflow": {
      "enabled": true
    }
  },
  "mentions": {
    "enabled": true,
    "changesWorkflow": {
      "enabled": false
    }
  },
  "reactions": {
    "trigger": "robot_face",
    "changesWorkflow": {
      "enabled": true,
      "trigger": "clack-work"
    }
  }
}
```

The top-level `changesWorkflow` section defines global workflow behavior. Each trigger type has a nested `changesWorkflow` object to opt in and configure trigger-specific options (e.g., reactions can have a different trigger emoji for changes).

### 5. Branch Naming

**Decision:** Auto-generate branch names from request summary.

**Format:** `clack/{type}/{short-description}-{random-suffix}`

**Examples:**
- `clack/fix/login-validation-a1b2c3`
- `clack/feat/add-export-button-x9y8z7`

### 6. Thread-Based Follow-ups

**Decision:** After PR creation, the Slack thread becomes an interactive session for PR lifecycle management.

**Supported follow-up commands in thread:**
- "review" / "check comments" → Read PR comments and implement fixes
- "merge" / "merge it" → Merge the PR
- "update" / "push more changes" → Continue working on the branch
- "close" / "abandon" → Close PR without merging

**Flow:**
```
User: "fix the login validation bug"
Bot: "Starting change request..."
Bot: "PR created: github.com/org/repo/pull/123"
User (in thread): "review the comments"
Bot: "Reading PR comments... Found 2 review comments. Implementing fixes..."
Bot: "Pushed fixes. PR updated."
User (in thread): "merge it"
Bot: "Merging PR #123... Done! PR merged successfully."
```

**Session persistence:**
- Thread is linked to the worktree and PR
- Worktree is retained while thread is active
- Session expires after configurable idle period (default 24h)

### 7. PR Review Flow

**Decision:** Use GitHub CLI to fetch PR comments and implement requested changes.

**Steps:**
1. Fetch PR comments via `gh pr view --comments`
2. Parse review comments and change requests
3. Claude analyzes comments and implements fixes in worktree
4. Commit and push changes
5. Reply in thread with summary of changes made

### 8. PR Merge Flow

**Decision:** Use GitHub CLI to merge PRs when requested.

**Merge options (configurable):**
- Default: squash merge
- Can be configured per-repo: `mergeStrategy: "squash" | "merge" | "rebase"`

**Pre-merge checks:**
- Verify PR has no unresolved review comments (optional, configurable)
- Verify CI checks passed (optional, configurable)

### 9. Claude-Directed PR Cleanup

**Decision:** Let Claude decide about branch deletion and worktree cleanup after merge/close.

**Rationale:**
- Claude has context about what happened during the change
- Different scenarios may warrant different cleanup behavior
- Claude can make intelligent decisions about branch retention (e.g., keep if related work might continue)
- Reduces hardcoded logic in favor of semantic decision-making

**Guidance provided to Claude:**
- After successful merge: typically delete remote branch and cleanup worktree
- After close: ask user if branch should be deleted or kept for later
- After review: never cleanup (session continues)

**Claude has the tools to:**
- Delete remote branches (`git push origin --delete`)
- Remove local worktrees (`git worktree remove`)
- Keep resources if there's reason to preserve them

### 10. Notification Strategy

**Decision:** Reply in the original Slack thread with status updates.

**Messages:**
1. "Starting change request..." (immediate)
2. "Working on: {summary}" (after analysis)
3. "PR created: {url}" OR "Change failed: {reason}" (completion)
4. Review/merge follow-ups continue in same thread

### 11. Worker Visibility

**Decision:** Provide real-time progress updates in Slack and persist session state/logs to disk.

**Rationale:**
- Long-running executions leave users wondering what's happening
- Session logs help debug failures and understand what Claude did
- State persistence enables crash recovery and monitoring

**Directory structure:**
```
data/
├── worktrees/                    # Worktree checkouts
└── worktree-sessions/            # Session metadata and logs
    └── {branch-name}/
        ├── state.json            # Session metadata
        └── execution.log         # Streaming Claude output
```

**state.json schema:**
```json
{
  "sessionId": "abc123",
  "status": "executing",
  "phase": "implementing",
  "branch": "clack/fix/login-bug-abc123",
  "repo": "my-app",
  "userId": "U12345",
  "description": "Fix login validation bug",
  "prUrl": null,
  "startedAt": "2025-01-22T10:00:00Z",
  "lastActivityAt": "2025-01-22T10:05:00Z",
  "lastMessage": "Writing validation logic to src/auth.ts"
}
```

**Real-time Slack updates:**
- Initial message: "Implementing changes..."
- Updates every 30 seconds (configurable) with Claude's last activity
- Format: "Implementing changes...\n_Currently: {lastMessage}_"
- Truncate long messages to fit Slack limits (max ~100 chars for activity)

**execution.log format:**
```
[2025-01-22T10:00:00Z] Phase: planning
[2025-01-22T10:00:05Z] Claude: Analyzing the request...
[2025-01-22T10:00:10Z] Claude: Reading src/auth.ts
[2025-01-22T10:00:15Z] Claude: Writing validation logic...
```

**Cleanup behavior:**
- On successful merge: remove session folder
- On close/abandon: keep logs for 24h (configurable) for debugging
- On failure: keep logs indefinitely until manual cleanup

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Claude makes incorrect changes | PR review is required; never auto-merge |
| Worktrees accumulate disk space | Cleanup after PR created; periodic garbage collection |
| Unauthorized users trigger changes | Role check (dev+) before execution |
| Long-running execution blocks Slack | Run async; provide progress updates |
| Bash escape/injection | Restrict to allowlist of commands |

## Migration Plan

1. **Phase 1:** Add config schema (no behavior change)
2. **Phase 2:** Implement worktree management
3. **Phase 3:** Add change execution with Claude
4. **Phase 4:** PR creation flow
5. **Phase 5:** Update docker-setup with instructions

**Rollback:** Feature is behind config flag; disable `changesWorkflow.enabled` to revert to read-only.

## Open Questions

1. **Max execution time?** Suggest 10 minutes, then abort and report failure.
2. **Concurrent change limit?** Suggest 1 per user, 3 total to prevent resource exhaustion.
3. **Worktree cleanup timing?** Suggest immediate after PR created, or 24h for failed attempts.
