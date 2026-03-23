## Why

Users upload images in Slack (screenshots, error outputs, diagrams) alongside their questions, but Clack ignores them. The `.files[]` array on Slack messages is never read — only `.text` and `.attachments[].text/.fallback` are extracted. Claude cannot answer questions about visual content.

## What Changes

- Extract image file metadata (ID, name, mimetype, url) from Slack messages across all three trigger modes (reactions, DMs, mentions) and thread context
- Add a new `view_slack_image` MCP tool that Claude calls on-demand to download and view images from Slack, returning MCP `ImageContent` (base64)
- Add a disk-based image cache (`data/cache/images/`) so follow-up queries and retries don't re-download the same images
- Include image metadata in the prompt so Claude knows what images are available and can decide which to view
- Add `files:read` to the Slack app manifest's core scopes

## Capabilities

### New Capabilities

- `slack-image-support`: Image extraction from Slack messages, on-demand viewing via MCP tool, and disk caching

### Modified Capabilities

- `clack-tools`: New `view_slack_image` query tool gated on image availability (not role); `QueryToolContext` gains `availableImages`; prompt gains image metadata section
- `slack-reaction-trigger`: Resolved message and thread context include image file metadata
- `slack-message-trigger`: DM and mention events extract image file metadata from messages
- `manifest-generation`: `files:read` added to core scopes (required for downloading images via `url_private`)

## Impact

- **Slack scopes**: Requires `files:read` bot scope — existing installations must re-authorize
- **Data directory**: New `data/cache/images/` directory for cached downloads
- **MCP tool server**: New tool registered conditionally (when images are available)
- **Session data model**: `ThreadMessage` and `SessionContext` gain optional `imageFiles` field
- **Dependencies**: No new npm dependencies (uses native `fetch`)
