## Context

After the `role-based-instructions` change, Clack uses convention-based instruction files resolved through a two-tier chain: `data/configuration/` (editable overrides) → `data/default_configuration/` (shipped defaults). Multiple files exist: `instructions.md` (base), `dev_instructions.md`, `admin_instructions.md`, `user_instructions.md`.

Currently there is no way for admins to edit these files from Slack — it requires server access. The Home Tab already has admin-only sections (role management), so adding a configuration section follows the existing pattern.

Slack modals have a **3000 character limit** per `plain_text_input` element. Instruction files can exceed this. We need to handle this constraint.

## Goals / Non-Goals

**Goals:**
- Let admins view and edit instruction files from the Slack Home Tab
- Show defaults from `data/default_configuration/` when no override exists
- Create overrides in `data/configuration/` when an admin edits a default
- Enforce that only files in `data/configuration/` can be written to

**Non-Goals:**
- Editing config.json, slack.json, or any other files from Slack
- Version history or undo for edited files
- Editing files outside `data/configuration/`
- Multi-user concurrent editing (last write wins is acceptable)
- Creating new instruction files (only editing existing convention files)

## Decisions

### Decision: Show both tiers in the UI

The Configuration section shows all known instruction files. For each file:
- If an override exists in `configuration/`, show it as "Customized" with an Edit button
- If only the default exists in `default_configuration/`, show it as "Default" with a "Customize" button that creates the override

This way admins see all files and understand the override mechanism.

### Decision: "Customize" creates override from default

When an admin clicks "Customize" on a default-only file, the system copies the default content into the edit modal. On submit, it writes to `configuration/`. This is the only way files get created in `configuration/` — through explicit admin action.

### Decision: Slack modal with `plain_text_input` for editing

Slack's `plain_text_input` element with `multiline: true` is the natural fit for editing markdown text. However, it has a **3000 character limit**. If the file content exceeds this:
- The edit modal shows a warning that the file is too large to edit via Slack
- The admin can still view a truncated preview on the Home Tab
- Editing must be done via server access

### Decision: Path safety via `resolve` + `startsWith` check

Before any file write, the system resolves the full path and verifies it starts with the `data/configuration/` directory. This prevents path traversal attacks.

### Decision: Configuration section placement

The "Configuration" section appears on the Home Tab for admins, between Role Management and Active Workers. It shows the instruction files with their status (Default / Customized).

## Risks / Trade-offs

- **3000 char limit**: Instructions that grow beyond 3000 chars can't be edited via Slack. → Mitigation: show a clear message; most instructions are well under this limit.
- **Last-write-wins**: No concurrent editing protection. → Acceptable: single-admin editing is the expected pattern.
- **No version history**: Edits are permanent. → Mitigation: defaults remain in `default_configuration/` as reference. Admin can delete the override to revert.
