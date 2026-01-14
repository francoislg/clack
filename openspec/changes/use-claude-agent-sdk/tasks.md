## 1. Dependencies and Configuration

- [x] 1.1 Add `@anthropic-ai/claude-agent-sdk` to package.json
- [x] 1.2 Update `ClaudeCodeConfig` to remove `path` (SDK handles it)
- [x] 1.3 Keep model selection config
- [x] 1.4 Update config validation for new structure

## 2. SDK Integration

- [x] 2.1 Refactor `askClaude()` to use SDK `query()` function
- [x] 2.2 Configure `cwd` option to point to repositories directory
- [x] 2.3 Configure `allowedTools` to restrict to Read, Glob, Grep
- [x] 2.4 Handle streaming response via async iterator
- [x] 2.5 Extract answer text from SDK result message

## 3. Prompt Adaptation

- [x] 3.1 Pass `systemPrompt` via SDK options
- [x] 3.2 Ensure multi-repository context is passed correctly
- [x] 3.3 Verify refinement/conversation history works with SDK

## 4. Cleanup

- [x] 4.1 Remove `checkClaudeCodeAvailable()` (SDK handles availability)
- [x] 4.2 Remove subprocess spawn logic
- [x] 4.3 Update error handling for SDK error types

## 5. Testing

- [ ] 5.1 Manual test: verify query returns answer from codebase
- [ ] 5.2 Manual test: verify response latency is improved
- [ ] 5.3 Manual test: verify refinements work correctly
- [ ] 5.4 Manual test: verify multi-repo questions work
