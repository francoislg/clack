## Context

The Q&A flow runs Claude with `disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash", "Task"]` and `cwd: data/repositories/`. Claude can read files but cannot write. The existing pattern for Claude to trigger actions is structured XML output tags (`<change-request>`, `<resume-request>`) parsed by the handler.

The `writeInstructionFile()` function already exists with path traversal protection. The admin role check exists. The Slack interactive button pattern is used throughout (change approval, PR merge/close, etc.).

## Goals / Non-Goals

**Goals:**
- Admins can request config file updates conversationally
- Claude reads current file content, drafts an update, outputs structured tags
- Handler shows preview with Apply/Dismiss buttons
- Apply writes the file, confirms in thread

**Non-Goals:**
- Diff view (showing what changed vs current) — nice to have but not needed for v1
- Undo support
- Non-admin users requesting config changes
- Editing non-instruction files (e.g., `config.json`, `roles.json`)

## Decisions

### 1. Structured output tag format

```xml
<config-update>
  <file>applauz-monorepo_changes_instructions.md</file>
  <content>
...new file content...
  </content>
</config-update>
```

The handler strips leading/trailing whitespace from content. The `<file>` value is validated against `listInstructionFiles()` filenames before writing.

### 2. CONFIG_UPDATE_BLOCK variable placement

Added to `buildSystemPrompt()` for admin/owner roles only. Includes:
- List of available config filenames from `listInstructionFiles()`
- Paths for reading current content (`../configuration/` and `../default_configuration/` relative to cwd)
- The exact output format

Placed in admin instructions since only admins can trigger this.

### 3. Confirmation via Slack buttons

The handler posts a message in the thread showing:
- Filename being updated
- Content preview (truncated if very long)
- "Apply" and "Dismiss" buttons

The content and filename are stored in the button's `value` field. Since Slack has a 2000-byte limit on action values, we store the content temporarily in a pending config updates map (in-memory, keyed by a random ID) and put just the ID in the button value.

### 4. File validation whitelist

Before writing, the handler:
1. Checks the filename is in `listInstructionFiles()` results
2. Calls `writeInstructionFile()` which already has path traversal protection
3. Verifies the user clicking "Apply" is still an admin

### 5. Parsing priority

Config update parsing happens AFTER change-request and resume-request. If Claude outputs both (shouldn't happen), change-request takes priority.

## Risks / Trade-offs

**In-memory pending store** → Pending config updates are lost on restart. Mitigation: the TTL is short (5 minutes), and the user can just ask again.

**Slack action value size** → Can't store full file content in button values. Mitigation: use an in-memory store with a UUID key.

**Claude might propose bad content** → The confirmation step prevents auto-writing. Admin must explicitly click Apply.
