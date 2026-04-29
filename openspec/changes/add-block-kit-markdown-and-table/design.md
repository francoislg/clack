## Context

Today Claude authors responses through `submit_response` (and `post_to` actions) using a curated 5-block Block Kit subset: `divider`, `header`, `section`, `context`, `image`. The pipeline is three stages — `BlockSchema` (Zod parse) → `prepareBlocks` (markdown→mrkdwn conversion + 3000-char section split) → `validateBlocks` (Slack limits) — each with per-block-type handling. Two long-standing pain points motivate adding `markdown` and `table`:

- **Long-form prose** loses fidelity through mrkdwn: real markdown headers (`##`) are silently re-rendered as bold text, code blocks lack syntax highlighting, task lists don't render. The split-at-3000-chars logic also produces awkward visual breaks mid-paragraph.
- **Tabular data** (lists of repos, sessions, PRs, comparisons, role audits) flattens into bullet lists or two-column `fields`, neither of which scales past 2 columns.

Slack's `markdown` block solves the first (full markdown including code highlighting, native cumulative-overflow handling — *"passing a single block may result in multiple blocks after translation"*). The `table` block solves the second, with a meaningful caveat: cells are `rich_text`-style structured elements, not mrkdwn, and only one table is allowed per message (additional tables → `invalid_attachments`).

## Goals / Non-Goals

**Goals:**
- Extend the curated subset to 7 block types: add `markdown` and `table`.
- Keep the three-stage pipeline shape (schema → prepare → validate) unchanged. New types slot in as new branches of each stage's switch.
- Give Claude a clear authoring contract via the prompt doc: when to use `markdown`, when to use `table`, when to fall back to a markdown-table inside a `markdown` block.
- Surface Slack's quirky table constraints (one-per-message, always-rendered-at-bottom) as Claude-actionable validation errors before the API call.

**Non-Goals:**
- Adopting `rich_text`, `alert`, `card`, `carousel`, `context_actions`, `plan`, `task_card`, `file`, `video`. Out of scope for this change; revisit individually if a use case emerges.
- Replacing or deprecating section-mrkdwn. Sections remain the default for short prose, `fields`, and accessory elements.
- Auto-detecting markdown tables in section text and converting them to `table` blocks. Too much implicit magic; Claude picks the right block.
- Changing the `submit_response` `actions: Action[]` boundary. Action buttons are still routed through that field, never through `actions` blocks in `blocks[]`.
- Backwards-compatibility shims. Existing sessions that never emit the new types are unaffected; no migration needed.

## Decisions

### 1. Cell shape for `table`: strings + optional rich_text element trees

Slack's table cells accept two element types: `raw_text` (plain) or `rich_text` (structured elements supporting bold/italic/code/links/mentions). The Claude-facing authoring shape will be:

- A bare **string** in any cell position is auto-wrapped as `{ type: "raw_text", text: <string> }` during `prepareTable`.
- A **`{ type: "rich_text", elements: [...] }`** object is passed through.
- A **`{ type: "raw_text", text }`** object is also passed through (allowed but redundant — the bare-string form is preferred).

**Why:** Strings are the simplest authoring contract for the common case (most table cells are plain values like a repo name or PR number). Rich-text cells stay available for the cases that need formatting (a linked PR title, a `<@USERID>` mention, a code-styled identifier). We don't expose `raw_text` as the recommended explicit shape because the bare-string sugar is friendlier.

**Alternatives considered:**
- *Always require explicit element objects.* Rejected — heavy authoring tax for the 90% case.
- *Auto-convert mrkdwn syntax inside string cells to rich_text elements.* Rejected — too much implicit magic; rich_text elements are precise structural objects, mrkdwn-cell-conversion would be a brittle parser, and Claude can pick the right cell type given a clear prompt.

### 2. `markdown` block: passthrough preparer, no internal split

`prepareMarkdown` does nothing — the block is appended to the output array untouched. Specifically:
- No `convertMarkdownToSlack` (Slack handles markdown natively in this block type).
- No `splitForSlack` analogue. Slack's spec says oversize markdown blocks may be auto-split into multiple blocks server-side. We rely on that and only enforce the **cumulative 12,000-char cap** at validation time.

**Why:** The whole reason this block exists in Slack is to let server-side rendering handle markdown. Re-implementing splitting client-side would defeat the purpose and risk diverging from Slack's behaviour over time.

**Alternatives considered:**
- *Split markdown blocks ourselves at 3000 chars (mirroring sections).* Rejected — there is no per-block 3000-char limit on markdown blocks; only the 12,000-char cumulative cap matters.

### 3. `table` block: prepare normalizes cells; validate enforces all limits

`prepareTable` walks `rows[][]` and normalizes each cell as in Decision 1. No row/column splitting — tables are atomic.

`validateTable` enforces:
- Max 100 rows (per cell array length).
- Max 20 cells per row.
- Max 20 entries in `column_settings`.
- Per-cell content size — Slack's docs don't publish a hard cell-text limit; we'll cap conservatively at **2,000 chars per cell** (matching the section-field cap), plus error messaging that points Claude at restructuring rather than truncation. (Open question — see below.)

`validateBlocks` adds a **payload-scope check**: at most one block of `type: "table"` per `blocks[]`. Multiple tables → validation error before the Slack call (Slack would otherwise return `invalid_attachments`).

**Why:** Surfacing the one-per-message constraint as a Claude-actionable error during validation is the entire point of having our validator — a Slack API error here would be nearly impossible for Claude to recover from mid-session.

### 4. Prompt doc: steer toward markdown-tables-in-markdown-blocks as the default tabular shape

In `block-kit-formatting.md`, document a clear hierarchy for tabular data:

1. **Default:** write a markdown table inside a `markdown` block. No 1-per-message limit (markdown blocks can repeat), simpler authoring, full formatting in cells.
2. **Escalate to `table` block when** column alignment matters, wrap control matters, or cells need rich-text elements (mentions, links rendered as buttons).

For prose, document:
- **Prefer `markdown`** when the response is mostly long-form text, headers, code blocks, or task lists.
- **Use `section`** when you need `fields`, accessory elements, or short snippets where mrkdwn is sufficient.

Update `submit-response.md`'s one-line subset reference (`divider, header, section, context, image`) to include the two new types.

**Why:** Without explicit guidance, Claude will likely overuse the new structural `table` block and hit the 1-per-message limit on multi-table answers. The markdown-table-first heuristic sidesteps this and matches what Claude already does naturally.

### 5. Schema validation: `looseObject` everywhere, mirroring the existing convention

Both new block schemas use Zod `looseObject` (matching the existing 5 schemas), so optional Slack fields like `block_id` survive parsing untouched. This preserves the project's established passthrough-of-optional-fields convention.

### 6. Rich-text cell elements: structural Zod schema, not `z.custom`

`BlockSchema` is registered as the input schema for the `submit_response` MCP tool via `@anthropic-ai/claude-agent-sdk`. The SDK serializes the Zod schema to JSON Schema for the MCP `tools/list` payload. **`z.custom` cannot be serialized — it has no static schema, only a runtime predicate** — so using `z.custom<RichTextBlockElement>(...)` for the rich-text element validator silently produced invalid output and broke the entire Clack MCP tool registry (not just `submit_response` — the whole server).

We therefore validate rich-text cell elements with `z.looseObject({ type: z.string() })`: a real Zod object schema that converts cleanly to JSON Schema, requires only that each element be a tagged object, and lets Slack enforce the deeper element schema server-side.

This widened the authoring types: instead of `AuthoredTableCell = string | RawTextElement | RichTextBlock`, we now have:

```ts
interface AuthoredRichTextElement { type: string; }
interface AuthoredRichTextCell { type: "rich_text"; elements: AuthoredRichTextElement[]; }
type AuthoredTableCell = string | RawTextElement | AuthoredRichTextCell;
```

`RichTextBlock` from `@slack/types` is structurally a subtype of `AuthoredRichTextCell` (same `type` discriminator, narrower element shape), so call sites that construct fully-typed Slack rich text values still type-check.

**Alternatives considered:**
- *Drop rich_text cell support entirely.* Rejected — leaves cells with mentions/styled spans/links unsupported, undercutting one of the table block's main affordances.
- *Encode the full `RichTextBlockElement` schema in Zod.* Rejected — large discriminated union with nested element trees; brittle, high maintenance, and we explicitly chose not to validate cell elements deeply (Decision 1 above).

## Risks / Trade-offs

- **One-table-per-message is a hard Slack constraint, not a soft one.** Claude may not understand the constraint from the prompt and emit two tables anyway. → **Mitigation:** Validator catches it before the API call with a Claude-actionable error message; `block-kit-formatting.md` calls this out explicitly with a "use markdown tables when you need multiple tables" pointer.
- **Tables always render at the bottom of the message** (Slack appends as an attachment regardless of position in `blocks[]`). Claude's mental model of "blocks render in order" breaks for tables. → **Mitigation:** Document this in the prompt doc. Validation does NOT reorder blocks — the model gets surprised once, learns from the rendered result.
- **Per-cell text limit is unpublished.** A 2000-char default may be too generous (slow rendering) or too restrictive (cuts off legit content). → **Mitigation:** Start at 2000, adjust based on production observation. Easy to tune since it's one constant.
- **Markdown block changes user-visible formatting.** A response that was previously rendered as mrkdwn-section text would render slightly differently as a markdown block (real headers, inline code spacing, etc.). → **Mitigation:** This is opt-in per-block; Claude only emits `markdown` when explicitly choosing to. No existing response paths flip silently.
- **`@slack/types` version may not include `MarkdownBlock`/`TableBlock`.** → **Mitigation:** Verify version during implementation; if missing, define our own narrow types (consistent with the existing approach where `BlockSchema` is the runtime authority and `@slack/types` provides compile-time types).

## Migration Plan

None. Purely additive change at the tool boundary. No data migration, no config schema change, no Slack-side setup. Deploy normally; older sessions that never emit `markdown` or `table` are unaffected.

Rollback: revert the diff. No persisted artifacts depend on the new block types.

## Open Questions

- **Per-cell text length limit for `table`.** 2000 chars is a starting guess based on the section-field cap. Should we instrument or pick a different number? Resolve during implementation by checking Slack's table-block error responses for any documented cell limit.
- **Should `prepareTable` enforce trim/whitespace conventions on string cells?** Lean: no — passthrough, let Claude author exact strings.
- **Should `validateBlocks` warn when a `table` is not the last block in `blocks[]` (since Slack will reorder it to the bottom)?** Lean: no — it's a Slack rendering quirk Claude will learn from one observation. Adding a warning expands the validator's scope into "stylistic reordering advice," which we've avoided elsewhere.
