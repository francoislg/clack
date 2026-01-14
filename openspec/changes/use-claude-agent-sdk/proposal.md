# Change: Use Claude Agent SDK for Query Processing

## Why
Currently, each query spawns a new Claude Code CLI subprocess with `-p` mode, taking ~5 seconds per query due to CLI startup overhead. By switching to the Claude Agent SDK, we can maintain a warm connection in our Node.js process and eliminate the subprocess spawn latency.

## What Changes
- Replace CLI subprocess spawning with Claude Agent SDK integration
- Use `@anthropic-ai/claude-agent-sdk` package for direct API access
- Maintain the same codebase exploration capabilities (Read, Glob, Grep, Bash)
- Configure allowed tools and working directory per query
- Remove subprocess-based invocation pattern

## Impact
- Affected specs:
  - `claude-code-integration` (MODIFIED - switch from CLI to SDK)
- Affected code:
  - `src/claude.ts` - major refactor to use Agent SDK
  - `src/config.ts` - API key configuration instead of CLI path
  - `package.json` - add `@anthropic-ai/claude-agent-sdk` dependency
