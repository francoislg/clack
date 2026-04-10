## Why

Admins occasionally need to remove a message Clack posted — e.g. a hype message sent to the wrong channel, a stale announcement, or a message that contained incorrect information. There is currently no way to do this without logging into Slack manually or contacting a workspace admin.

## What Changes

- New `admin_delete_message` tool available to admin+ roles
- Accepts a Slack message permalink URL
- Verifies the message was posted by Clack before deleting
- Returns a clear error if the message is not found (including ephemeral messages), not owned by Clack, or cannot be deleted

## Capabilities

### New Capabilities
- `admin-delete-message`: Admin tool that deletes a Clack-owned Slack message by URL, with ownership verification

### Modified Capabilities
- `clack-tools`: New `admin_delete_message` tool added to the admin tool set
