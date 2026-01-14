# persist-session-info

## Summary
Persist Slack session info (threadTs) to disk so sessions can survive app restarts. When a user clicks a button after a restart, the session is lazily restored from disk.

## Problem
Currently, `activeSessions` in `src/slack/state.ts` is an in-memory Map. When the app crashes or restarts:
- The session data (`context.json`) persists on disk
- But the Slack routing info (`threadTs`) is lost
- Users cannot continue interacting with existing responses

## Solution
1. Add `threadTs` to `SessionContext` and persist it in `context.json`
2. When a button handler can't find a session in memory, look it up on disk by `sessionId`
3. Restore `SessionInfo` from the persisted `SessionContext`

## Scope
- Modify `SessionContext` interface to include `threadTs`
- Update `createSession()` to accept and store `threadTs`
- Add lazy restoration in button handlers (accept, reject, refine, update)
- No folder restructuring needed - `sessionId` is already the folder name

## Out of Scope
- Auto-restore on startup (not needed with lazy approach)
- Folder structure changes
- Resume mid-flight Claude Code calls (those would need to be re-triggered)
