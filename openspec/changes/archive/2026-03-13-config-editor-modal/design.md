## Context

The Home Tab's Configuration section currently shows a static hierarchy of files per role directory with no interactivity. Admins can only modify configuration files through the chat interface (`propose_config_update`). A previous modal editor existed but was removed because it didn't work well with the old flat-file structure. The cascading directory system (from `cascading-config-resolver`) now makes a modal editor viable since files are organized by role with clear source status.

Existing patterns in the codebase: the Home Tab already uses `views.open` for modals (role management, settings) and `views.push` is available but unused. Slack Block Kit's `plain_text_input` has a 3000-character limit.

## Goals / Non-Goals

**Goals:**
- Admins can browse, edit, create, and delete configuration files from the Home Tab
- Same UX for both role directories and repo directories
- Graceful handling of files too large for Slack's 3000-char textarea limit
- File operations go through existing `writeInstructionFile()` / new `deleteInstructionFile()`

**Non-Goals:**
- Replacing the chat-based `propose_config_update` flow (both coexist)
- Editing files larger than 3000 characters via modal (use chat instead)
- Syntax validation or preview of instruction content
- Multi-file operations or bulk editing

## Decisions

### Decision 1: Three-modal stack pattern

Use `views.open` for the file picker and `views.push` for the editor and create modals. This gives Slack's native back navigation (close stacked modal returns to picker).

```
Home Tab [View] → File Picker (views.open)
                      │
                      ├── [Edit] on file → Editor (views.push)
                      │
                      └── [+ Create New] → Create form (views.push)
```

**Why not `views.update`**: Using `views.push` gives a real back button. With `views.update`, we'd need to rebuild the picker state and there's no native "go back" affordance.

### Decision 2: Action IDs encode the directory context

Buttons on the Home Tab use action IDs like `view_config_dir:user`, `view_config_dir:dev`, `view_config_dir:applauz-monorepo`. The file picker buttons use `edit_config_file:user/identity.md`. This lets handlers parse the directory/file context from the action ID without maintaining state.

File edit buttons in the picker use the full `{dir}/{filename}` path as the action value rather than encoding it in the action ID, since Slack limits action IDs to 255 characters and filenames could be long.

### Decision 3: Submit button label based on file state

The editor modal's submit button reflects the action:
- File has no override (showing default content) → **"Create Override"**
- File has an existing override → **"Save"**
- Custom-only file (no default) → **"Save"**

This is set via the modal's `submit` field in `views.push`. The handler reads the file state from `private_metadata` to know what operation to perform.

### Decision 4: Delete via block_actions, not form submission

"Reset to Default" / "Delete File" is a button inside the modal body, handled as a `block_actions` event. On click:
1. Delete the file via `deleteInstructionFile()`
2. If a default exists: `views.update` the stacked modal to show default content with status "Default — no override" and submit label "Create Override"
3. If no default (custom-only): close the stacked modal via `views.update` with a brief confirmation, or just close it

**Why not a separate confirmation modal**: Extra friction for a recoverable action. Defaults are preserved, and custom files can be recreated.

### Decision 5: Files over 3000 chars are view-only in the picker

In the file picker modal, files whose effective content (custom override or default) exceeds 3000 characters show a static text label ("Too large — use chat") instead of an [Edit] button. No misleading affordance.

### Decision 6: Repo directories share the UX but not [+ Create New]

Repo directories appear in the Home Tab alongside role directories with the same [View] button. The file picker shows the repo's files with [Edit] buttons. No [+ Create New File] button since repo filenames are convention-based (`changes_instructions.md`, `worktree_setup_instructions.md`).

### Decision 7: Private metadata for state passing

The pushed editor modal stores context in `private_metadata` (JSON-encoded):
```json
{
  "dir": "user",
  "filename": "identity.md",
  "hasDefault": true,
  "hasOverride": false
}
```
This tells the submission handler what file to write and whether it's creating a new override or updating an existing one.

### Decision 8: Home Tab refresh after modal actions

After any write or delete via the modal, refresh the Home Tab for the user. This updates the file counts in the Configuration section. Use the same `publishHomeView()` pattern already used by role management modals.

## Risks / Trade-offs

- **3000-char limit**: Some default files (e.g., `submit-response.md` at ~2800 chars) are close to the limit. If a user's override grows past 3000 chars, they won't be able to edit it via modal anymore. Mitigation: the chat-based flow always works regardless of size.
- **Action ID collisions**: Directory names that match action ID patterns could cause routing issues. Mitigation: use a specific prefix (`view_config_dir:`, `edit_config_file:`).
- **No undo for delete**: Deleting a custom-only file is permanent. Mitigation: these files are typically small and can be recreated. Git history also preserves them if the data directory is tracked.
