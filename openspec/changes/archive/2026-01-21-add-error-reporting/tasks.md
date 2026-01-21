# Tasks: Add Error Reporting

## Phase 1: Capture Conversation Trace

- [x] **1.1** Add `ConversationMessage` interface to track SDK messages (type, content, timestamp)
- [x] **1.2** Modify `askClaude()` to collect all messages during query execution
- [x] **1.3** Add `ErrorRecord` interface with timestamp, error message, and conversation trace

## Phase 2: Session Error Storage

- [x] **2.1** Add `errors: ErrorRecord[]` array to `SessionContext` interface
- [x] **2.2** Modify `askClaude()` to accept session and store errors on failure
- [x] **2.3** Update session persistence to save/load error records

## Phase 3: Error Session Preservation

- [x] **3.1** Modify session cleanup to skip sessions with non-empty `errors` array
- [x] **3.2** Add logging when error sessions are preserved

## Phase 4: User-Friendly Error Display

- [x] **4.1** Update error message to show "Claude seems to have crashed, maybe try again?"
- [x] **4.2** Add "Try Again" button to error responses
- [x] **4.3** Create handler for retry button action

## Phase 5: DM Error Reporting (Optional Feature)

- [x] **5.1** Add `slack.sendErrorsAsDM` config option (boolean, default false)
- [x] **5.2** Create `analyzeError()` function to get Claude's analysis of the trace
- [x] **5.3** Create `sendErrorReport()` function in Slack messaging
- [x] **5.4** Format error report with session ID, trace summary, and Claude analysis
- [x] **5.5** Update error handlers to send DM when flag is enabled

## Phase 6: Validation

- [x] **6.1** Test error capture with intentional failure scenarios
- [x] **6.2** Verify errors are stored in session and preserved across cleanup
- [x] **6.3** Test retry button functionality
- [x] **6.4** Verify DM delivery works correctly when enabled
