# Tasks: Add Developer Change Request Workflow

## 1. Configuration Schema

- [x] 1.1 Add top-level `ChangesWorkflowConfig` interface to `src/config.ts`
  - `enabled: boolean`
  - `prInstructions?: string`
  - `timeoutMinutes?: number`
  - `maxConcurrent?: number`
  - `additionalAllowedTools?: string[]`
  - ~~`triggerPatterns: string[]`~~ (removed - Claude now handles semantic detection)
- [x] 1.2 Add `changesWorkflow` to root `Config` interface
- [x] 1.3 Add `TriggerChangesWorkflowConfig` interface for per-trigger config
  - `enabled: boolean`
- [x] 1.4 Add `ReactionsChangesWorkflowConfig` extending with `trigger?: string`
- [x] 1.5 Add nested `changesWorkflow` to `DirectMessagesConfig`, `MentionsConfig`, and `ReactionsConfig`
- [x] 1.6 Add `supportsChanges`, `worktreeBasePath`, `pullRequestInstructions`, and `mergeStrategy` to `RepositoryConfig` interface
- [x] 1.7 Update `validateConfig()` to validate new fields
- [x] 1.8 Update `data/config.example.json` with new fields and comments

## 2. Worktree Management

- [x] 2.1 Create `src/worktrees.ts` module
- [x] 2.2 Implement `createWorktree(repoName, branchName)` function
  - Fetch latest from remote
  - Create worktree with `git worktree add`
  - Return worktree path
- [x] 2.3 Implement `removeWorktree(worktreePath)` function
  - Run `git worktree remove`
  - Delete directory if needed
- [x] 2.4 Implement `cleanupStaleWorktrees()` function
  - Scan `data/worktrees/` for old directories
  - Remove worktrees older than retention period
- [x] 2.5 Branch naming handled by Claude in planning phase (removed hardcoded generateBranchName)
- [x] 2.6 Add worktree cleanup to application startup in `src/index.ts`

## 3. Change Request Detection

- [x] 3.1 Create `src/changes.ts` module with types
  - `ChangeRequest` interface
  - `ChangeResult` interface
  - `ChangeStatus` type
- [x] 3.2 ~~Implement `isChangeRequest(message, config)` function~~ Replaced with Claude-driven detection
  - Change detection now happens in `askClaude()` with `enableChangeDetection` option
  - Claude uses semantic understanding to determine if a message is a change request or question
  - Avoids false positives like "how do I fix this?" being detected as a change request
- [x] 3.3 Implement `isChangesEnabledForTrigger(triggerType, config)` helper
  - Check `changesWorkflow.enabled` globally
  - Check `{trigger}.changesWorkflow.enabled` for specific trigger
- [x] 3.4 Update `src/slack/handlers/directMessage.ts`
  - Check if changes enabled for DMs via nested config
  - Route to change workflow if detected
  - Route to Q&A workflow otherwise
- [x] 3.5 Update `src/slack/handlers/mention.ts`
  - Check if changes enabled for mentions via nested config
  - Route to change workflow if detected
- [x] 3.6 Update reaction handler to support separate change trigger emoji
  - Check `reactions.changesWorkflow.trigger` for change requests
  - Use `reactions.trigger` for Q&A queries
- [x] 3.7 Add role check for change requests using `isDev()` from `src/roles.ts`

## 4. Change Execution

- [x] 4.1 Implement `executeChange(request, worktreePath)` in `src/changes.ts`
  - Build change-focused system prompt
  - Configure default allowed tools: Read, Glob, Grep, Write, Edit, Bash
  - Merge `additionalAllowedTools` from config
  - Always disallow Task tool
  - Set cwd to worktree (sandbox)
  - Stream execution with timeout
- [x] 4.2 Implement worktree sandbox enforcement
  - Set `cwd` to worktree directory
  - All file operations restricted to worktree path
  - Bash commands run from worktree context
- [x] 4.3 Create change execution system prompt
  - Instruct Claude to analyze, implement, test, commit
  - Include PR instructions from config
  - Specify output format for commit hash
- [x] 4.4 Implement execution timeout handling
  - Timeout with configurable duration
  - Kill process on timeout
- [x] 4.5 Implement result parsing
  - Extract commit hash from output
  - Extract summary from output

## 5. PR Creation

- [x] 5.1 Implement `resolvePRTemplate(worktreePath)` function
  - Check repo paths in order
  - Check `data/templates/pr-template.md`
  - Return template content or default
- [x] 5.2 Implement `resolvePRInstructions(worktreePath, repoConfig)` function
  - Read file from `pullRequestInstructions` path if configured
  - Fall back to global `prInstructions` from config
  - Return instructions content or empty string
- [x] 5.3 Implement `createPR(worktreePath, template, summary)` function
  - Push branch to remote
  - Run `gh pr create` with template
  - Return PR URL
- [x] 5.4 Create default PR template content
- [x] 5.5 Create `data/templates/` directory with `.gitkeep`

## 6. PR Review

- [x] 6.1 PR comment fetching integrated into `reviewPR()` function
  - Uses `gh pr view --comments --json` for PR comments
- [x] 6.2 Implement `reviewPR(changeSession)` function
  - Fetch PR comments
  - Pass to Claude for analysis
  - Implement requested changes in worktree
  - Commit and push updates
- [x] 6.3 Review prompt included in `reviewPR()` function
  - Instruct Claude to read and understand review comments
  - Implement requested changes

## 7. PR Merge

- [x] 7.1 Implement `mergePR(prUrl, strategy)` function
  - Use `gh pr merge` with strategy flag
  - Claude decides about remote branch cleanup
  - Return success/failure status with cleanup summary
- [x] 7.2 Implement `closePR(prUrl)` function
  - Use `gh pr close` to close without merging
  - Optional branch deletion based on user request
- [x] 7.3 Add merge strategy support
  - Read `mergeStrategy` from repo config
  - Default to squash merge
  - Support: squash, merge, rebase
- [x] 7.4 Implement post-merge cleanup
  - Claude decides about remote branch deletion
  - Remove local worktree after merge
  - Delete local branch
  - Clear change session

## 8. Thread Follow-ups

- [x] 8.1 Implement `getSessionByThread(channel, threadTs)` function
  - Check if thread has an active change session
  - Return session data if found
- [x] 8.2 ~~Implement `parseFollowUpCommand(message)` function~~ Replaced with `detectFollowUpCommand()`
  - Detect: review, merge, update, close commands using Claude semantic understanding
  - Return command type and any additional instructions
  - Claude distinguishes between action commands and questions about the change
- [x] 8.3 Update thread reply handler in `src/slack/handlers/threadReply.ts`
  - Check if reply is in a change thread
  - Route to follow-up handler if active session exists
- [x] 8.4 Implement follow-up command routing
  - review → `reviewPR()`
  - merge → `mergePR()`
  - update → `executeChange()` with additional instructions
  - close → `closePR()`
- [x] 8.5 Implement session expiry
  - Track last activity timestamp per session
  - `cleanupExpiredSessions()` function
  - Never cleanup sessions that are actively in progress (planning, executing, reviewing, merging)

## 9. State Management

- [x] 9.1 Add `activeSessions` Map to track in-progress changes
  - Include: user ID, repo, branch, PR URL, thread ID, start time, last activity
- [x] 9.2 Implement concurrency check before starting new change
- [x] 9.3 Implement per-user duplicate prevention
  - `getActiveSessionForUser()` checks for existing session
- [x] 9.4 Add cleanup of state on completion/failure/merge

## 10. Slack Feedback

- [x] 10.1 Change acknowledgment implemented in handlers via `onProgress` callback
- [x] 10.2 Change progress implemented in handlers via `onProgress` callback
- [x] 10.3 Change success messages posted by handlers after workflow completes
- [x] 10.4 Change failure messages posted by handlers on error
- [x] 10.5 Review complete messages included in follow-up result summary
- [x] 10.6 Merge success messages included in follow-up result summary
- [x] 10.7 Add progress update interval (every 30 seconds) during execution
- [x] 10.8 Add active workers display to home tab (visible only to devs and higher)
  - Shows status, description, branch, repo, user, and PR link for each active session

## 11. Docker Setup Updates

- [ ] 11.1 Add change workflow prompt to `scripts/docker-setup.sh`
  - Ask if user wants to enable change requests
  - Warn about write permissions needed
- [ ] 11.2 Add `GH_TOKEN` configuration step
  - Prompt for GitHub personal access token
  - Save to `data/auth/.env`
- [ ] 11.3 Update docker run command output
  - Add worktrees volume mount
  - Add `GH_TOKEN` to env-file
- [ ] 11.4 Update Dockerfile to install `gh` CLI
- [ ] 11.5 Add SSH write access warning/instructions

## 12. Testing & Documentation

- [ ] 12.1 Test worktree creation/cleanup manually
- [ ] 12.2 Test change detection with various message patterns
- [ ] 12.3 Test role enforcement (dev vs non-dev)
- [ ] 12.4 Test full workflow: DM → change → PR
- [ ] 12.5 Test PR review flow: fetch comments → implement → push
- [ ] 12.6 Test PR merge flow: merge command → cleanup
- [ ] 12.7 Test thread follow-ups: review, merge, update, close
- [ ] 12.8 Test timeout handling
- [ ] 12.9 Test concurrent execution limits

## 13. Worker Visibility

- [x] 13.1 Create `data/worktree-sessions/` directory structure
  - Create session folder per branch: `data/worktree-sessions/{branch-name}/`
  - Add `state.json` with session metadata (status, timestamps, user, repo)
  - Add `execution.log` for streaming Claude output
- [x] 13.2 Implement session state persistence
  - Write `state.json` on session start/update/complete
  - Include: status, description, branch, repo, user, PR URL, timestamps
  - Update state on each phase transition (planning → executing → reviewing → etc.)
- [x] 13.3 Implement execution logging
  - Stream Claude's output to `execution.log` in real-time
  - Include timestamps for each message
  - Rotate or truncate logs if they exceed size limit
- [x] 13.4 Implement real-time Slack progress updates
  - Update "Implementing changes..." message with Claude's last activity
  - Use configurable update interval (default: every 30 seconds)
  - Show current phase and last meaningful message from Claude
  - Truncate long messages to fit Slack limits
- [x] 13.5 Add session cleanup for worktree-sessions
  - Remove session folder when worktree is cleaned up
  - Keep failed session logs for debugging (configurable retention)
