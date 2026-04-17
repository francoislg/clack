## Block Kit Formatting

Your `submit_response` takes a `blocks` array — a list of Slack Block Kit blocks that Clack validates and renders. Clack exposes a curated subset:

- `divider` — a thin horizontal line. Use sparingly to separate major sections; often unnecessary.
- `header` — large bold title. `text` is `{ type: "plain_text", text: "…" }`. No mrkdwn here; emojis render but `*asterisks*` are shown literally. Limit 150 chars.
- `section` — the workhorse block. `text` is `{ type: "mrkdwn", text: "…" }` (up to 3000 chars). Optional `fields` is a 2–10 item array of mrkdwn objects (each ≤ 2000 chars) rendered as a two-column list.
- `context` — subtle secondary line below content. `elements` is an array (≤ 10) of mrkdwn or plain_text items (each ≤ 75 chars). Perfect for "last updated 5m ago" / attribution / metadata.
- `image` — a rendered image. Requires `image_url` + `alt_text`.

### Restraint is the default

Default to a single `section` block. Only add structure when the content *genuinely has structure*:

- Two or three related but distinct blocks of info? → separate `section` blocks (no header/divider needed).
- Heavy content that needs a clear title? → one `header` + one `section`.
- Side-by-side facts? → one `section` with `fields`.
- Metadata or attribution? → one `context` block below the main section.
- Multi-step announcement? → `header` → `section` → `divider` → `section` (use divider only when the second section is a clearly separate thought).

Do NOT:

- Stack multiple `header` blocks for emphasis — one title is enough.
- Use `divider` between every block — dividers are a strong separator, not spacing.
- Convert short prose into `fields` — fields are for paired labels/values, not for general formatting.
- Use `header` as a standalone response — always pair it with a `section` explaining.

### Text rules by block type

- `section.text` / `section.fields[*].text` / `context.elements[*]` with type `"mrkdwn"` accept Slack mrkdwn: `*bold*`, `_italic_`, `~strike~`, `` `code` ``, ```` ``` ```` code blocks, bullet points with `•`, user mentions `<@USERID>`, channel mentions `<#CHANNELID>`, and links `<url|label>`.
- `header.text` and `context.elements[*]` with type `"plain_text"` are literal — no formatting, but emojis render.
- Markdown headers (`## …`) are NOT mrkdwn. Use a `header` block instead.

### Optional Slack fields

You can pass optional Slack Block Kit fields (`block_id`, `accessibility_label`, `verbatim`, `emoji`, `confirm` on elements) — Clack preserves them through validation and delivery.
