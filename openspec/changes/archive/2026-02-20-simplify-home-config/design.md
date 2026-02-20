## Context

The Home tab's Configuration section currently shows each instruction file with an "Edit" / "Customize" / "Create" button that opens a Slack modal for inline editing. This modal is constrained by Slack's 3000-character limit and offers a poor editing experience. Meanwhile, the `config-update-via-chat` capability already provides a superior workflow: admins chat with Clack, who reads files with `read_config_file` and proposes changes via `propose_config_update` with a confirmation flow.

## Goals / Non-Goals

**Goals:**
- Remove edit buttons from the Configuration section to simplify the UI
- Guide admins toward the chat-based config update workflow
- Clean up dead code (modal builder, action handlers) that becomes unreachable

**Non-Goals:**
- Changing the config-update-via-chat workflow itself
- Modifying the role management buttons (those remain as-is)
- Removing the Configuration section entirely — file status visibility is still useful

## Decisions

### Remove buttons, keep file listing
The Configuration section still lists each instruction file with its status (Customized / Default / Not created). Only the button accessory is removed. This preserves at-a-glance visibility of config state.

**Alternative considered:** Remove the entire Configuration section. Rejected because admins benefit from seeing which files exist and their customization status without needing to ask Clack.

### Add a context hint about chatting with Clack
A short mrkdwn context block below the file list tells admins: "Chat with Clack to view or update configuration files." This bridges the gap for anyone looking for the old edit buttons.

### Delete modal builder and handlers
`buildEditFileModal()` in `homeTab.ts` and the `edit_config_file` action handler + `edit_config_file_modal` submission handler in `handlers/homeTab.ts` become dead code once the buttons are removed. Clean deletion rather than leaving unused code.

## Risks / Trade-offs

- **Admins accustomed to modal editing lose that workflow** — Mitigated by the chat-based workflow being strictly more capable (no 3000-char limit, supports diffs and context).
- **New admins might not know how to update config** — Mitigated by the hint text directing them to chat with Clack.
