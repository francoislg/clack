## Why

The Configuration section on the Home tab displays "Edit" / "Customize" / "Create" buttons next to each instruction file. These buttons open modals with limited text editing capabilities (constrained by Slack's 3000-char modal limit). Since Clack already supports updating configuration files through chat via `propose_config_update` / `read_config_file` tools, the modal-based editing is redundant and offers a worse experience. Removing the buttons simplifies the UI and guides users toward the chat-based workflow.

## What Changes

- Remove the "Edit" / "Customize" / "Create" buttons from the Configuration section on the Home tab
- Keep the file listing with status indicators (Customized / Default / Not created) so admins can still see the state of each file at a glance
- Add a hint below the configuration list telling users they can chat with Clack to update configuration files
- Remove the edit file modal builder and its associated action/submission handlers

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `home-tab`: Configuration section no longer includes edit buttons; replaced with a chat-based update hint

## Impact

- `src/slack/homeTab.ts` — `buildConfigurationSection()` changes (remove button accessory, add hint text), remove `buildEditFileModal()`
- `src/slack/handlers/homeTab.ts` — remove `edit_config_file` action handler and `edit_config_file_modal` submission handler
