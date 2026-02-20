# CLAUDE.md

## Project Overview

**Clack** - A Slack bot that answers codebase questions using Claude Code. React to any message with a configured emoji, and Clack provides non-technical answers visible only to you. Accept to share with the team, refine for better answers, or reject to dismiss.

## OpenSpec Workflow

This project uses OpenSpec for spec-driven development.

**For new features, breaking changes, or architectural decisions:**

1. Read `openspec/AGENTS.md` for the full workflow
2. Run `openspec list` to see active changes and `openspec list --specs` to see existing capabilities
3. Create proposals in `openspec/changes/[change-id]/` with `proposal.md`, `tasks.md`, and spec deltas
4. Validate with `openspec validate [change-id] --strict` before implementation

**Skip proposals for:** bug fixes, typos, dependency updates, config changes.

## Migrations

When creating boot migrations, **always use `/create-migration`**. This skill scaffolds the migration file, registers it, creates test cases, and registers them in the test runner. Never create migration files manually.
