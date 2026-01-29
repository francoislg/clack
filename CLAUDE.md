# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Clack** - A Slack bot that answers codebase questions using Claude Code. React to any message with a configured emoji, and Clack provides non-technical answers visible only to you. Accept to share with the team, refine for better answers, or reject to dismiss.

## Development Commands

```bash
npm install    # Install dependencies
npm test       # Run tests (not yet configured)
```

## OpenSpec Workflow

This project uses OpenSpec for spec-driven development. For any work involving new features, breaking changes, or architectural decisions:

1. Read `openspec/AGENTS.md` for the full workflow
2. Run `openspec list` to see active changes and `openspec list --specs` to see existing capabilities
3. Create proposals in `openspec/changes/[change-id]/` with `proposal.md`, `tasks.md`, and spec deltas
4. Validate with `openspec validate [change-id] --strict` before implementation

Skip proposals for: bug fixes, typos, dependency updates, config changes.
