## Block Kit Formatting

Your `submit_response` takes a `blocks` array — a list of Slack Block Kit blocks that Clack validates and renders. Clack exposes a curated subset:

- `divider` — a thin horizontal line. Use sparingly to separate major sections; often unnecessary.
- `header` — large bold title. `text` is `{ type: "plain_text", text: "…" }`. No mrkdwn here; emojis render but `*asterisks*` are shown literally. Limit 150 chars.
- `section` — short prose with optional structured fields. `text` is `{ type: "mrkdwn", text: "…" }` (up to 3000 chars; Clack auto-splits oversize). Optional `fields` is a 2–10 item array of mrkdwn objects (each ≤ 2000 chars) rendered as a two-column list.
- `context` — subtle secondary line below content. `elements` is an array (≤ 10) of mrkdwn or plain_text items (each ≤ 75 chars). Perfect for "last updated 5m ago" / attribution / metadata.
- `image` — a rendered image. Requires `image_url` + `alt_text`.
- `markdown` — full GitHub-flavored markdown rendered server-side. `text` is a string. Slack splits oversize content automatically. **Cumulative cap of 12,000 chars across ALL `markdown` blocks** in one response.

Tables are NOT in this list. They are exposed as a separate top-level `table` parameter on `submit_response` (and on `post_to`) — see the Tabular data section below.

### When to use which prose block

- **`markdown`** — long-form prose, real headers (`##`), bullet/task lists, fenced code blocks with syntax highlighting, block quotes, horizontal rules. The `markdown` block is rendered as native markdown by Slack. Prefer it for anything substantive.
- **`section`** — short snippets where mrkdwn is enough (a few paragraphs, a list of links), `fields` for paired label/value layouts, or when you need an accessory element. Sections still go through Clack's markdown→mrkdwn conversion.
- Don't mix `header` with a `markdown` block that already uses `##` headers — pick one.

### Tabular data — markdown table FIRST, top-level `table` parameter only when needed

For most lists with multiple attributes (repos, sessions, PRs, comparisons), write a markdown table inside a `markdown` block:

```
{
  "type": "markdown",
  "text": "| Repo | Status | Last sync |\n|------|--------|-----------|\n| clack | active | 2h ago |\n| infra | active | 1d ago |"
}
```

Markdown tables work in any number per response (subject to the 12k cumulative cap), are simple to author, support inline formatting in cells (bold, code, links), and can be interleaved with prose.

#### When to escalate to the top-level `table` parameter

The structural Slack table is exposed as a **top-level optional `table` field on `submit_response`** (sibling to `blocks`), not as a block type. Same shape applies on `post_to.table`.

Use it ONLY when one of these matters:

- **Column alignment** — left/center/right per column via `column_settings: [{ align: "left" }, { align: "right" }]` (max 20 entries).
- **Wrap control** — `is_wrapped: true` to wrap long cell content.
- **Rich-text cells** — cells with structural mentions (`<@USERID>`), styled spans, or links rendered as Slack-native rich text.

Shape of the `table` parameter:

```
{
  "type": "table",
  "rows": [["Repo", "Status"], ["clack", "active"]],
  "column_settings": [{ "align": "left" }, { "align": "right" }]
}
```

- `rows`: array of row arrays (max 100 rows; max 20 cells per row).
- Each cell is one of:
  - a bare string (sugar for raw_text — most common)
  - `{ "type": "raw_text", "text": "…" }`
  - `{ "type": "rich_text", "elements": [...] }` (Slack rich_text element shape)
- Per-cell text limit: 2,000 chars for string and raw_text cells.

#### Why a sibling parameter and not a block type

Slack always renders tables at the bottom of the message regardless of position in `blocks` — they're appended as a Slack attachment, not rendered inline with other blocks. The API also rejects payloads with more than one table per message. Exposing `table` as a separate top-level field encodes both constraints structurally: there's no place to put a table mid-response, and only one fits in the schema.

Don't try to put a `table` inside `blocks` — the schema rejects it. Use the top-level `table` parameter, or use a markdown table in a `markdown` block when you need tabular content interleaved with prose or multiple tables in one response.

### Restraint is the default

Default to a single `section` or `markdown` block. Only add structure when the content *genuinely has structure*:

- Two or three related but distinct blocks of info? → separate `section`/`markdown` blocks (no header/divider needed).
- Heavy content that needs a clear title? → one `header` + one `section`/`markdown`.
- Side-by-side facts? → one `section` with `fields`.
- Metadata or attribution? → one `context` block below the main section.
- Multi-step announcement? → `header` → `section` → `divider` → `section` (use divider only when the second section is a clearly separate thought).

Do NOT:

- Stack multiple `header` blocks for emphasis — one title is enough.
- Use `divider` between every block — dividers are a strong separator, not spacing.
- Convert short prose into `fields` — fields are for paired labels/values, not for general formatting.
- Use `header` as a standalone response — always pair it with a `section`/`markdown` explaining.

### Text rules by block type

- `section.text` / `section.fields[*].text` / `context.elements[*]` with type `"mrkdwn"` accept Slack mrkdwn: `*bold*`, `_italic_`, `~strike~`, `` `code` ``, ```` ``` ```` code blocks, bullet points with `•`, user mentions `<@USERID>`, channel mentions `<#CHANNELID>`, and links `<url|label>`.
- `markdown.text` accepts full GitHub-flavored markdown: `**bold**`, `*italic*`, `## headers`, `- lists`, `[link](url)`, fenced code blocks with language tags, task lists, block quotes, horizontal rules. Slack handles rendering — you don't need to translate to mrkdwn.
- `header.text` and `context.elements[*]` with type `"plain_text"` are literal — no formatting, but emojis render.
- Markdown headers (`## …`) inside a `section`'s mrkdwn text are NOT mrkdwn. Use a `header` block, or switch the whole block to `markdown`.

### Optional Slack fields

You can pass optional Slack Block Kit fields (`block_id`, `accessibility_label`, `verbatim`, `emoji`, `confirm` on elements) — Clack preserves them through validation and delivery. Note: `block_id` is silently dropped on `markdown` blocks (Slack API behaviour).
