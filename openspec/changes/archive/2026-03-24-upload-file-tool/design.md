## Context

Claude running via the Agent SDK has no way to deliver file content to Slack users. The `submit_response` tool delivers text via Block Kit messages, but Slack messages have a 10,000-char limit and can't carry downloadable files. Today Claude sometimes hallucinates creating files on disk — an instruction guardrail (already added to `identity.md`) prevents this, but leaves no alternative for exporting data.

The session already carries `channelId` and `threadTs`, and the `QueryToolContext` already provides `slackClient`. The `@slack/web-api` v7.14.1 includes `files.uploadV2`. No new dependencies are needed.

## Goals / Non-Goals

**Goals:**
- Let Claude upload generated text content (CSV, JSON, Markdown, code, etc.) to Slack as a file
- Support posting to the current thread (default) or an explicit channel/thread
- Available to all roles when a Slack client is present
- Simple, atomic operation — one tool call does the upload

**Non-Goals:**
- Binary file generation (images, PDFs) — Claude generates text, not binary
- File-on-disk workflows — content is passed as a string argument, no temp files
- Reading user-attached files — separate concern, out of scope
- Replacing `submit_response` — `upload_file` is a side-effect tool, not a terminal one

## Decisions

### 1. Content as tool argument, not disk I/O

**Decision:** The tool accepts `content: string` directly as a parameter.

**Alternatives considered:**
- Write to `data/uploads/`, then reference the path → adds two-step flow, cleanup concerns, same generation bottleneck since Claude produces the content either way
- Integrate as `attachments` field on `submit_response` → couples file upload to response delivery, harder to upload multiple files or upload without a text response

**Rationale:** Atomic single-call operation. Claude generates content and uploads in one step. No temp files, no cleanup, no second tool call to forget.

### 2. Thread coordinates from session context, with optional override

**Decision:** Default `channelId` and `threadTs` come from `ctx.session`. Claude can override with explicit `channel` and `thread_ts` parameters for cross-posting.

This mirrors how `send_to_thread` works in `submit_response` — default to current thread, allow explicit targeting.

**Alternatives considered:**
- Always require explicit channel/thread → verbose for the common case (same thread)
- Always post to current thread, no override → blocks "send this to #analytics"

### 3. Gated on slackClient presence, not role

**Decision:** Register the tool whenever `ctx.slackClient` is available (same pattern as `find_user`, `fetch_slack_message`).

**Rationale:** File upload is an output format, not a privileged action. A member asking "give me that as a CSV" shouldn't need dev permissions.

### 4. Not a terminal tool

**Decision:** `upload_file` is a side-effect tool. Claude must still call `submit_response` to complete the response.

**Rationale:** The user needs context — "Here's the CSV you asked for" or "I uploaded a summary with 200 entries." The file alone in the thread lacks explanation. Consistent with the existing pattern where only `submit_response` marks a query as complete.

### 5. Tool placement in query tool set

**Decision:** New file at `src/tools/query/uploadFile.ts`, registered in `buildQueryTools()` alongside other Slack-dependent tools.

**Rationale:** It's a query-mode tool (not worker, not action, not presentation). It doesn't stage intents or produce buttons — it performs an immediate side effect, like `view_slack_image` but in the other direction.

## Risks / Trade-offs

**[Large content consumption]** → Claude generates content token-by-token regardless of delivery method. Practical limit is ~a few thousand rows of CSV before context/speed becomes an issue. Mitigation: document in the tool description that it's for generated summaries and reports, not bulk data export. Add a reasonable content size limit (e.g., 500KB) with a clear error message.

**[Upload failure mid-conversation]** → If `files.uploadV2` fails (permissions, network), Claude gets an error response and can inform the user via `submit_response`. The tool returns structured error results like other tools.

**[Bot token scope]** → `files.uploadV2` requires the `files:write` scope on the bot token. Most Slack bot installations include this, but if missing the tool will fail with a descriptive error. Mitigation: document the required scope; the error from Slack is clear enough.

**[Channel permissions]** → When targeting a channel explicitly, the bot must be a member. If not, Slack returns `channel_not_found` or `not_in_channel`. The tool should return a clear error in this case.
