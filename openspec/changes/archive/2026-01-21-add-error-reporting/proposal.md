# Proposal: Add Error Reporting with Conversation Trace

## Summary

Add error detection and reporting capabilities that capture the full Claude conversation trace when errors occur, store errors in session for debugging, and optionally send detailed error reports via DM.

## Problem

When Claude Agent SDK errors occur (e.g., "process exited with code 1"), the user only sees a generic error message with no context about what went wrong. The full conversation trace that led to the error is lost, making debugging difficult.

## Solution

1. **Capture conversation trace**: Collect all SDK messages during query execution
2. **Store errors in session**: Persist all error traces in session context (not just the last one)
3. **Preserve error sessions**: Don't auto-delete sessions that contain errors
4. **User-friendly error message**: Show generic "Claude seems to have crashed" message with retry button
5. **Optional DM reporting**: Add `slack.sendErrorsAsDM` config flag to send detailed error reports to users
6. **Claude error analysis**: When DM reporting is enabled, include Claude's analysis of what went wrong

## Scope

- Modify `askClaude()` to capture conversation traces internally
- Add `errors` array to session context to store all error traces
- Skip cleanup of sessions with errors
- Update error handlers to show friendly message with retry button
- Add `slack.sendErrorsAsDM` config option
- Create error report formatting and DM sending logic (when enabled)
- Add Claude-based error analysis (for DM reports only)

## Out of Scope

- Automated error recovery/retry logic
- External error tracking integration (Sentry, etc.)
- Error rate limiting or aggregation

## Dependencies

- Existing `claude-code-integration` spec
- Existing `session-management` spec
