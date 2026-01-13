## 1. Project Setup

- [x] 1.1 Initialize TypeScript project with `tsconfig.json`
- [x] 1.2 Add dependencies: `@slack/bolt`, `@slack/web-api`, `simple-git`
- [x] 1.3 Create `data/config.example.json` with documented schema
- [x] 1.4 Add `.gitignore` for `data/config.json`, `data/repositories/`, `data/sessions/`
- [x] 1.5 Create directory structure: `src/`, `data/`

## 2. Configuration Module

- [x] 2.1 Create `src/config.ts` to load and validate `data/config.json`
- [x] 2.2 Define TypeScript interfaces for config schema
- [x] 2.3 Add defaults for optional values (timeouts, intervals, etc.)
- [x] 2.4 Add startup validation with clear error messages

## 3. Repository Management

- [x] 3.1 Create `src/repositories.ts` module
- [x] 3.2 Implement `cloneRepository()` with SSH and shallow clone support
- [x] 3.3 Implement `pullRepository()` for updates
- [x] 3.4 Implement `syncAllRepositories()` with error handling
- [x] 3.5 Add periodic sync scheduler using `setInterval`
- [ ] 3.6 Test with a sample repository

## 4. Session Management

- [x] 4.1 Create `src/sessions.ts` module
- [x] 4.2 Implement `createSession()` with unique ID generation
- [x] 4.3 Implement `getSession()` and `updateSession()`
- [x] 4.4 Implement session context file read/write
- [x] 4.5 Implement `isSessionExpired()` check
- [x] 4.6 Implement cleanup job with scheduler
- [ ] 4.7 Test session lifecycle

## 5. Claude Code Integration

- [x] 5.1 Create `src/claude.ts` module
- [x] 5.2 Implement `spawnClaudeCode()` with permission flags
- [x] 5.3 Build system prompt with repository list and non-technical instruction
- [x] 5.4 Implement output capture and parsing
- [x] 5.5 Add markdown to Slack mrkdwn conversion
- [x] 5.6 Handle long response truncation
- [ ] 5.7 Test with sample questions

## 6. Slack Integration

- [x] 6.1 Create `src/slack.ts` module with Bolt app setup
- [x] 6.2 Implement reaction event listener for trigger emoji
- [x] 6.3 Implement thread/message context fetching
- [x] 6.4 Implement ephemeral message posting with Block Kit buttons
- [x] 6.5 Implement Accept action handler (ephemeral → visible)
- [x] 6.6 Implement Reject action handler (dismiss)
- [x] 6.7 Implement Refine action handler (open modal)
- [x] 6.8 Implement Update action handler (re-read and regenerate)
- [x] 6.9 Implement "thinking" indicator during generation
- [ ] 6.10 Test full flow in Slack

## 7. Main Application

- [x] 7.1 Create `src/index.ts` entry point
- [x] 7.2 Wire up all modules
- [x] 7.3 Add startup sequence: config → repos → scheduler → Slack
- [x] 7.4 Add graceful shutdown handling
- [x] 7.5 Add startup CLI check for Claude Code availability

## 8. Testing & Documentation

- [ ] 8.1 Write unit tests for config validation
- [ ] 8.2 Write unit tests for session management
- [ ] 8.3 Write integration test for Claude Code spawning
- [x] 8.4 Update README with setup instructions
- [x] 8.5 Document Slack app manifest/permissions needed
- [x] 8.6 Document SSH key setup for repositories
