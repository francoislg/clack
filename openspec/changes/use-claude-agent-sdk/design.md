## Context

The current implementation spawns a new Claude Code CLI subprocess for each query using `-p` mode. Benchmarking shows ~5 seconds per query due to CLI startup overhead, which is too slow for a responsive Slack bot.

The Claude Agent SDK provides the same agentic capabilities (Read, Glob, Grep, Bash) as the CLI but runs within the Node.js process, eliminating subprocess overhead.

## Goals / Non-Goals

**Goals:**
- Eliminate ~5s CLI startup latency per query
- Maintain codebase exploration capabilities (Read, Glob, Grep)
- Keep the same non-technical response style
- Support multi-repository awareness

**Non-Goals:**
- Session pooling (SDK handles connection management internally)
- Changing the Slack interaction flow
- Modifying how sessions/refinements work at the application level

## Decisions

### Decision: Use Claude Agent SDK instead of CLI subprocess
The SDK provides the same tools as the CLI but runs in-process, eliminating fork/exec and CLI initialization overhead.

**Alternatives considered:**
- CLI with `--resume`: Still has 5s startup per query
- PTY with warm processes: Complex, fragile completion detection
- HTTP API wrapper: Doesn't include agentic file exploration tools

### Decision: Configure tools per query
Use `allowedTools` option to restrict which tools Claude can use. For safety, we allow read-only exploration tools by default.

**Tools to allow:**
- `Read` - Read file contents
- `Glob` - Find files by pattern
- `Grep` - Search file contents

**Tools to restrict:**
- `Bash` - Could execute arbitrary commands
- `Write`/`Edit` - Could modify files

### Decision: Set working directory to repositories
Use the SDK's `cwd` option to set the working directory to `data/repositories/`, giving Claude access to all cloned repos.

### Decision: API key from environment
Store the Anthropic API key in environment variable `ANTHROPIC_API_KEY` rather than config file to follow security best practices.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Slack Bot (Node.js)                │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │              askClaude()                     │   │
│  │                                              │   │
│  │  const response = await query({             │   │
│  │    prompt: buildPrompt(session),            │   │
│  │    options: {                               │   │
│  │      cwd: "data/repositories",              │   │
│  │      allowedTools: ["Read", "Glob", "Grep"] │   │
│  │    }                                        │   │
│  │  });                                        │   │
│  └─────────────────────────────────────────────┘   │
│                        │                            │
│                        ▼                            │
│  ┌─────────────────────────────────────────────┐   │
│  │           Claude Agent SDK                   │   │
│  │  - Warm connection to Claude API            │   │
│  │  - File exploration tools (Read/Glob/Grep)  │   │
│  │  - Runs in-process, no subprocess overhead  │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Query Flow

1. Slack reaction triggers query
2. Build prompt with system instructions + user question + context
3. Call SDK `query()` with prompt and options
4. SDK streams response (or returns complete result)
5. Extract answer, format for Slack, post ephemeral response

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| API key exposure | Use environment variable, not config file |
| SDK API changes | Pin dependency version |
| Different behavior than CLI | Test thoroughly during migration |
| Tool access too broad | Explicitly whitelist safe tools only |

## Open Questions

- Does the SDK support streaming responses? (Would improve perceived latency for long answers)
- What's the SDK's model selection API? (Need to support configurable model)
