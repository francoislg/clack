## Why

Worker-mode Claude runs in the Agent SDK's **isolation mode** — it loads no filesystem settings — so operators have no supported way to attach external guardrails (PreToolUse command hooks, `permissions.deny` rules) that stop the worker from doing things they don't want. Operators need a generic, outside-the-codebase lever to constrain the worker without Clack shipping or referencing any specific tool.

## What Changes

- Worker-mode `runClaude` (`src/changes/execution.ts`) forwards an **operator-provided native Claude Code `settings.json`** to the Agent SDK's `settings` query option when the file is present, opening filesystem-free settings injection. **PreToolUse command hooks** are the primary lever (they fire even under the worker's `bypassPermissions` mode); other native keys are forwarded too, though `permissions` allow/deny rules are inert under bypass mode.
- The file lives at a fixed, gitignored path, `data/worker-settings.json` (a sibling of `data/mcp.json`); absent → worker behaves exactly as today (zero-config unaffected).
- The path is resolved to an **absolute** path before being passed (the worker `cwd` is a per-run worktree, so relative resolution would break).
- The existing programmatic `buildWorkerBashGuardHook` PreToolUse guard continues to fire alongside any operator-supplied command hooks (both channels coexist).
- **No reference to any specific hook tool** (e.g. claude-dont) anywhere in the codebase — Clack only knows "read this native settings file and forward it." Installation of the actual hook binary/scripts and authoring of the settings file are operator/ops steps (documented, not coded).

## Capabilities

### New Capabilities
- `worker-external-settings`: Forwarding an operator-provided native Claude Code settings file into worker-mode Claude via the Agent SDK `settings` option, so external hooks and permission rules constrain the worker without any tool-specific code.

### Modified Capabilities
<!-- None: this is additive; existing worker behavior is unchanged when the file is absent. -->

## Impact

- **Code:** `src/changes/execution.ts` (`runClaude` query options) — a small, generic door-opener that reads a fixed path and forwards it as `settings`. Optionally a light zod schema if boot-time validation is chosen over path-forwarding.
- **SDK:** uses the existing `@anthropic-ai/claude-agent-sdk` `settings` option (path or object); no new dependency.
- **Ops/deployment (the bulk of the work, no code):** the settings file and any referenced hook binaries/scripts must exist at absolute paths **inside the runtime environment** (GCE VM / Docker image), plus their prerequisites (e.g. `jq`, `bash`). Zero-config deployments that omit the file are unaffected.
