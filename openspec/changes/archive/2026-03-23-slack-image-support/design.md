## Context

Clack processes Slack messages as text-only. The message extraction pipeline (`extractMessageText`) reads `.text` and `.attachments[].text/.fallback` but ignores the `.files[]` array where uploaded images live. Claude Code's Read tool supports viewing images, and the Anthropic API supports image content blocks, but the Slack→Claude pipeline has no path for visual content.

Slack file objects include `url_private` URLs that require the bot token for download. The bot currently has no `files:read` scope.

## Goals / Non-Goals

**Goals:**
- Claude can view images uploaded in Slack messages when relevant to the question
- Claude decides which images to view (not auto-downloaded)
- Downloaded images are cached to avoid redundant Slack API calls across follow-ups
- Works across all three trigger modes (reactions, DMs, mentions) and thread context

**Non-Goals:**
- Non-image file types (PDFs, code files, archives) — future enhancement
- Image manipulation or resizing before sending to Claude
- Inline image display in Slack responses
- Image support in the Changes Workflow (worker mode)

## Decisions

### Decision 1: On-demand MCP tool vs. auto-download

**Choice**: MCP tool that Claude calls on-demand

**Alternatives considered**:
- **Auto-download all images upfront**: Simpler pipeline, Claude sees images immediately. Rejected because it wastes bandwidth/tokens on irrelevant images (e.g., a thread with 5 screenshots where only 1 is relevant to the question).
- **Save to disk + Read tool**: Download images, tell Claude to `Read` them. Rejected because it requires `additionalDirectories` in the SDK config and an extra tool call roundtrip — the MCP tool can return `ImageContent` directly.

**Rationale**: The MCP tool approach gives Claude agency. Image metadata in the prompt is cheap (a few lines of text), and Claude only downloads images it needs. The tool returns base64 `ImageContent` directly — no intermediate disk read needed for the Claude interaction itself.

### Decision 2: Image metadata in prompt vs. tool discovery

**Choice**: Image metadata listed in the prompt text

**Alternatives considered**:
- **Discovery tool** (`list_available_images`): Claude calls a tool to discover what images exist. Rejected because it adds an unnecessary tool call — the metadata is known at prompt build time and is small enough to include inline.

**Rationale**: A few lines of metadata (filename, file ID, who uploaded) in the prompt is negligible. Claude can immediately decide whether to view any image without an extra round trip.

### Decision 3: Disk cache by Slack file ID

**Choice**: Cache downloaded images in `data/cache/images/` keyed by Slack file ID

**Rationale**: Slack file IDs are globally unique and stable. The same image referenced in a follow-up query, a retry, or even a different thread will hit the cache. Cache files are simple: `{fileId}.{ext}` + `{fileId}.meta.json` sidecar.

No TTL or eviction — Slack `url_private` URLs are long-lived and the cache is bounded by actual usage. Can add TTL-based cleanup later if needed.

### Decision 4: Tool gating on data availability

**Choice**: `view_slack_image` is registered only when `ctx.availableImages?.size > 0`

**Rationale**: Unlike other clack tools which are role-gated, this tool is pointless without images. Registering it when no images exist would confuse Claude. This is a new gating pattern but follows the existing precedent of `find_user` being gated on `ctx.slackClient` availability.

### Decision 5: `files:read` as core scope

**Choice**: Add to `CORE_SCOPES` (always included), not feature-gated

**Rationale**: Images can appear in any trigger mode. There's no config flag to "enable image support" — it's a baseline capability. Adding it to core scopes keeps the manifest generator simple and avoids a new feature flag for something that should always be available.

## Risks / Trade-offs

- **Scope re-authorization**: Existing installations must re-authorize the Slack app to gain `files:read`. → Document in release notes; the scope is non-sensitive (read-only access to files shared in channels the bot is in).
- **Large images**: A 20MB PNG encoded as base64 becomes ~27MB in the tool response. → Enforce per-file size limit (20MB) and per-message image cap (10) in the extractor. Claude's API handles large images but they consume tokens.
- **Private file URLs expire**: Slack `url_private` URLs may eventually expire or become inaccessible if the file is deleted. → The cache mitigates this for subsequent requests. First request after expiry will fail gracefully with an error result.
- **MCP ImageContent support**: Assuming the Claude Agent SDK properly forwards `{ type: "image" }` content from MCP tool results to the model. → The SDK uses standard MCP `CallToolResult` types. If this fails, fallback is saving to disk + using `additionalDirectories` with the Read tool.
