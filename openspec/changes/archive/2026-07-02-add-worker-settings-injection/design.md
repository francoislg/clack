## Context

Worker-mode Claude runs through `@anthropic-ai/claude-agent-sdk`'s `query()` in `src/changes/execution.ts` (`runClaude`). Today the query options set `cwd`, `executable`, `systemPrompt`, `allowedTools`, `disallowedTools`, `hooks` (a single programmatic `buildWorkerBashGuardHook`), and `mcpServers`. It sets **neither** `settings` **nor** `settingSources`, so the SDK is in **isolation mode** — no filesystem settings (`~/.claude/settings.json`, project `.claude/`) are loaded. Consequently an operator has no supported way to attach external guardrails to the worker.

The Agent SDK exposes two relevant levers:
- `settingSources: ('user'|'project'|'local')[]` — loads whole settings files by source, but also pulls in CLAUDE.md and everything else in those files (unwanted coupling), and is source-located rather than operator-chosen.
- `settings: string | Settings` — the equivalent of the `--settings` CLI flag; loads a single operator-chosen file (or inline object) into the highest-priority "flag" layer, **without** enabling any other filesystem source. `Settings.hooks` is exactly the native command-hook shape (`{ type: 'command', command }`), and `Settings.permissions` supports `deny` rules.

The desired external tool (e.g. claude-dont) is a **PreToolUse command hook**, normally registered in `settings.json`. The `settings` option is therefore the surgical injection point.

## Goals / Non-Goals

**Goals:**
- Let an operator constrain the worker with native command hooks and/or `permissions.deny` rules, supplied entirely from outside the codebase.
- Keep the codebase 100% generic — no reference to any specific hook tool.
- Zero behavior change when no settings file is provided.
- Preserve the existing programmatic bash guard.

**Non-Goals:**
- Injecting settings into **query mode** (this change is worker-scoped; the same lever generalizes later if wanted).
- Shipping or checking in any default settings file, hook binary, or tool.
- Enabling `settingSources` / loading project or user settings wholesale.
- Providing a Slack/Home-Tab UI to edit the file (it is an operator/ops-level escape hatch).

## Decisions

### Decision 1: Use the SDK `settings` option, not `settingSources`

Pass the operator file through `settings` so ONLY the operator's hooks/permissions are injected — no CLAUDE.md or project-config side effects. `settingSources` would over-couple and is source-located rather than operator-chosen.

_Alternative considered:_ `settingSources: ['user']` + dropping the file at `~/.claude/settings.json`. Rejected — drags in unrelated settings and CLAUDE.md, and is less explicit.

### Decision 2: Fixed, gitignored path under `data/`

Read from a fixed path, `data/worker-settings.json` — a native-SDK-shape file at the data root, deliberately a sibling of `data/mcp.json` (also documented as "pure Claude SDK shape"). It is resolved to an **absolute** path from Clack's data directory (`getDataDir()`) before forwarding. Absolute is mandatory because the worker `cwd` is a per-run worktree; a relative path would resolve against the worktree and break. The path is gitignored (like `data/config.json` / `data/mcp.json`), with a checked-in `data/worker-settings.example.json` for operators, so zero-config deployments simply omit it.

### Decision 3: Path-forward vs. read-and-validate

Two viable shapes, both leaving the codebase generic:
- **Path-forward (minimal):** if the file exists, pass its absolute path string as `settings`. The CLI reads and validates it. ~1–3 lines. Loses boot-time validation — a malformed file fails at worker-run time.
- **Read-and-validate (fail-fast):** read the file at boot, validate with a light `z.object({ hooks: …optional(), permissions: …optional() }).passthrough()` (NOT a reimplementation of the full `Settings` type — `passthrough()` lets any other native key flow through), pass the parsed object as `settings`. ~5–8 lines. Catches a broken guardrail before any worker runs, consistent with the repo's "boot config = fail-fast, validate disk reads with zod" convention.

**Chosen:** start with **path-forward** for minimal footprint (matches the "as little code as possible" intent), and treat fail-fast validation as an easy follow-up if operators want boot-time safety. This is called out in Open Questions.

### Decision 4: Both hook channels coexist

The built-in `buildWorkerBashGuardHook` stays on the programmatic `hooks` option; operator command hooks arrive via `settings.hooks`. They travel different SDK layers and are expected to merge additively. This is the one behavior that must be confirmed (see Risks / Open Questions).

## Risks / Trade-offs

- **[Programmatic hook vs. settings.hooks may not both fire]** → Spike before implementing: register a throwaway `echo` command hook in a settings file alongside the bash guard and confirm both execute on a single Bash call. If they don't merge, fall back to translating file command-hooks into programmatic wrapper callbacks.
- **[`permissions.deny`/`allow` rules are inert under the worker's `bypassPermissions` mode]** → The worker runs with `permissionMode: "bypassPermissions"`, which SKIPS the allow/deny permission system. So operator `permissions` rules in the settings file will NOT be enforced (and equally cannot *widen* past Clack's guards). PreToolUse **hooks** are unaffected — they fire under bypass — so command hooks (claude-dont's mechanism) are the enforcement path. The example file leads with hooks and documents this caveat; hard blocks belong in a PreToolUse hook returning a deny decision, not in `permissions.deny`.
- **[Referenced hook binary must exist in the runtime env]** → The `command` path and any prerequisites (`jq`, `bash`) must be present **inside the GCE VM / Docker image**, at absolute paths — not on the operator's laptop. This is an ops/deployment burden, documented but not solved by code.
- **[Path-forward defers validation]** → A malformed settings file fails a change mid-run rather than at boot. Mitigation: log the file's presence at boot; escalate to fail-fast validation (Decision 3) if this bites.
- **[Arbitrary shell execution]** → Command hooks run arbitrary shell on the Clack host with Clack's privileges. Acceptable because the file is operator-authored and deploy-gated, not user-facing.

## Migration Plan

1. Land the generic door-opener in `runClaude`.
2. Operator installs the desired hook tool into the runtime image/volume (clone, `chmod`, `apk add jq bash`) at absolute paths.
3. Operator authors `data/config/worker-settings.json` referencing those absolute paths.
4. Redeploy. Rollback = remove the file (worker reverts to isolation-mode behavior); no code rollback needed since the door-opener is inert without the file.

## Open Questions

- **Spike outcome:** do `settings.hooks` command hooks and the programmatic bash guard both fire? (Blocks final hook-channel design.)
- **Path-forward vs. fail-fast:** ship minimal path-forward now, or include the light zod validation from the start?
- **Final path/location:** resolved — `data/worker-settings.json` (sibling of `data/mcp.json`).
