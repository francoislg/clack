## Why

Ephemeral messages provide a one-shot, modal-driven interaction that feels clunky for iterative refinement. Users want to have a natural back-and-forth conversation with Clack before sharing an answer publicly. By delivering reaction responses as DMs with threaded follow-ups, users get a private workspace to refine answers naturally, then deliberately share when ready.

## What Changes

- Add `reactions.responseType` config option (`"ephemeral"` | `"directMessage"`) to control how reaction-triggered answers are delivered
- When set to `"directMessage"`: send a DM with a link to the original message, deliver the answer in a DM thread with action buttons, and support natural thread-based refinement
- Add a "Send to thread" action that triggers a synthesis pass (Claude summarizes the full DM conversation into a clean answer), shown to the user for approval before posting to the original channel thread
- After posting, allow the user to come back to the DM thread for further refinement, with options to update the existing channel post or post a new reply
- Add per-user preference storage and a Settings modal on the Home tab, allowing users to opt out of DM mode back to ephemeral (toggle only visible when workspace config is `"directMessage"`)
- Add `im:write` scope to manifest when `reactions.responseType` is `"directMessage"`
- Skip `notifyHiddenThread` DM when the user is already in DM mode (avoid double-DMs)

## Capabilities

### New Capabilities
- `dm-first-reactions`: DM-based response delivery for reaction triggers, including DM thread follow-ups, synthesis, and "send to channel" actions
- `user-preferences`: Per-user preference storage and Settings modal on the Home tab

### Modified Capabilities
- `slack-reaction-trigger`: Add `responseType` config option and conditional DM delivery path
- `home-tab`: Add Settings modal for per-user preferences (conditionally rendered based on config)
- `manifest-generation`: Add `im:write` scope when `reactions.responseType` is `"directMessage"`
- `session-management`: Track DM channel/thread alongside origin channel/thread for cross-channel session linking

## Impact

- **Config**: New `reactions.responseType` field
- **Slack API**: Requires `im:write` scope when DM mode is enabled; uses `conversations.open` to initiate DMs
- **Storage**: New `data/state/user-preferences.json` file for per-user settings
- **Sessions**: Extended session info to track both origin and DM coordinates
- **Claude**: Additional synthesis call when user triggers "Send to thread"
- **Home tab**: New Settings section and modal
