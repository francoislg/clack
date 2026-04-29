## Context

Today Claude authors responses through `submit_response` (and `post_to` actions) using a curated 5-block Block Kit subset: `divider`, `header`, `section`, `context`, `image`. The pipeline is three stages — `BlockSchema` (Zod parse) → `prepareBlocks` (markdown→mrkdwn conversion + 3000-char section split) → `validateBlocks` (Slack limits) — each with per-block-type handling. Two long-standing pain points motivate adding `markdown` and `table`:

- **Long-form prose** loses fidelity through mrkdwn: real markdown headers (`##`) are silently re-rendered as bold text, code blocks lack syntax highlighting, task lists don't render. The split-at-3000-chars logic also produces awkward visual breaks mid-paragraph.
- **Tabular data** (lists of repos, sessions, PRs, comparisons, role audits) flattens into bullet lists or two-column `fields`, neither of which scales past 2 columns.

Slack's `markdown` block solves the first (full markdown including code highlighting, native cumulative-overflow handling — *"passing a single block may result in multiple blocks after translation"*). The `table` block solves the second, with two structural quirks: cells are `rich_text`-style structured elements rather than mrkdwn, and **Slack always renders the table at the bottom of the message regardless of position in `blocks`** (it is appended as an attachment), with a hard "one table per message" limit (additional tables → `invalid_attachments`).

The first iteration of this change (shipped in commit `a311e08`) modeled `table` as a seventh entry in the curated `blocks` subset, alongside `markdown` and the original five. In practice the rendering-order quirk leaked through the prompt-only mitigation: Claude authored tables mid-`blocks`, the rendered output appended them to the bottom, and the model's mental model diverged from what users saw. Since the change has not yet been archived, we revise the design here rather than ship a follow-up.

## Goals / Non-Goals

**Goals:**
- Extend the curated subset of block types accepted inside `blocks` from 5 to 6 by adding `markdown`.
- Expose `table` as a **top-level optional parameter** on `submit_response` and on the `post_to` action, sibling to `blocks` — making "always rendered at bottom" and "at most one per message" structural rather than prompt-enforced.
- Keep the three-stage pipeline shape (schema → prepare → validate) for blocks unchanged. Reuse the same prepare/validate primitives for the standalone `table` parameter via direct exports.
- Give Claude a clear authoring contract via the prompt doc: when to use `markdown`, when to use the `table` parameter, when to fall back to a markdown-table inside a `markdown` block.

**Non-Goals:**
- Adopting `rich_text`, `alert`, `card`, `carousel`, `context_actions`, `plan`, `task_card`, `file`, `video`. Out of scope for this change; revisit individually if a use case emerges.
- Replacing or deprecating section-mrkdwn. Sections remain the default for short prose, `fields`, and accessory elements.
- Auto-detecting markdown tables in section text and converting them to a `table` parameter. Too much implicit magic; Claude picks the right authoring shape.
- Changing the `submit_response` `actions: Action[]` boundary. Action buttons are still routed through that field, never through `actions` blocks in `blocks[]`.
- Backwards-compatibility shims for the table-as-block intermediate state. The change has not archived; we replace the prior implementation cleanly.

## Decisions

### 1. `table` is a top-level sibling parameter, not a `blocks` member

`submit_response` and `post_to` both accept an optional `table?: AuthoredTableBlock` field at the same level as `blocks`. The schema does NOT admit `type: "table"` inside `blocks`: `BlockSchema` and `ALLOWED_BLOCK_TYPES` exclude it, and Zod rejects any such entry with the standard "invalid type" error.

**Why:** Slack's two table-specific constraints — "always renders at bottom" and "max one per message" — are structural facts of the API, not stylistic preferences. Encoding them in the schema (single optional field, sibling of `blocks`) makes them unfalsifiable: Claude *cannot* place a table mid-response or stage two tables, because there is no shape in the input that expresses either. This eliminates an entire class of "the rendered output doesn't match what I authored" surprises and removes the need for a payload-scope multi-table guard in the validator.

**Alternatives considered:**
- *Keep `table` inside the `blocks` union, mitigate via prompt and a multi-table validation guard* (the previous design). Rejected — the rendering-order quirk is invisible to validation, only observable at render time, and prompt-only mitigation produced unreliable results in practice.
- *Auto-extract a `type: "table"` block out of `blocks` at the schema boundary.* Rejected — silent magic violates the project's "no backwards-compat hacks" stance and produces a confusing two-paths-into-the-same-state input shape. A clean Zod rejection is more honest.

### 2. Cell shape for `table`: strings + optional rich_text element trees

Slack's table cells accept two element types: `raw_text` (plain) or `rich_text` (structured elements supporting bold/italic/code/links/mentions). The Claude-facing authoring shape is:

- A bare **string** in any cell position is auto-wrapped as `{ type: "raw_text", text: <string> }` during `prepareTable`.
- A **`{ type: "rich_text", elements: [...] }`** object is passed through.
- A **`{ type: "raw_text", text }`** object is also passed through (allowed but redundant — the bare-string form is preferred).

**Why:** Strings are the simplest authoring contract for the common case (most table cells are plain values like a repo name or PR number). Rich-text cells stay available for the cases that need formatting (a linked PR title, a `<@USERID>` mention, a code-styled identifier). We don't expose `raw_text` as the recommended explicit shape because the bare-string sugar is friendlier.

**Alternatives considered:**
- *Always require explicit element objects.* Rejected — heavy authoring tax for the 90% case.
- *Auto-convert mrkdwn syntax inside string cells to rich_text elements.* Rejected — too much implicit magic; rich_text elements are precise structural objects, mrkdwn-cell-conversion would be a brittle parser, and Claude can pick the right cell type given a clear prompt.

### 3. `markdown` block: passthrough preparer, no internal split

`prepareMarkdown` does nothing — the block is appended to the output array untouched. Specifically:
- No `convertMarkdownToSlack` (Slack handles markdown natively in this block type).
- No `splitForSlack` analogue. Slack's spec says oversize markdown blocks may be auto-split into multiple blocks server-side. We rely on that and only enforce the **cumulative 12,000-char cap** at validation time.

**Why:** The whole reason this block exists in Slack is to let server-side rendering handle markdown. Re-implementing splitting client-side would defeat the purpose and risk diverging from Slack's behaviour over time.

**Alternatives considered:**
- *Split markdown blocks ourselves at 3000 chars (mirroring sections).* Rejected — there is no per-block 3000-char limit on markdown blocks; only the 12,000-char cumulative cap matters.

### 4. Standalone `table` pipeline: shared primitives, direct calls

`prepareTable` and `validateTable` continue to live in `src/slack/blockPrepare.ts` and `src/slack/blockValidate.ts` next to their block-pipeline siblings, but are **exported and called directly** from `submit_response` against the standalone `table` parameter — they are not wired into the `prepareBlocks` / `validateBlocks` switches.

`prepareTable` walks `rows[][]` and normalizes each cell as in Decision 2. No row/column splitting — tables are atomic.

`validateTable` enforces:
- Max 100 rows.
- Max 20 cells per row.
- Max 20 entries in `column_settings`.
- Per-cell content size — capped conservatively at **2,000 chars per cell** for string and `raw_text` cells (matching the section-field cap), with error messaging that points Claude at restructuring rather than truncation.
- Per-cell text cap is NOT enforced for `rich_text` cells — see Decision 6.

**Why:** Reusing the per-block primitives keeps validation logic in one place and lets us share helper functions (e.g., per-row index reporting in error messages). Calling them directly from the tool layer rather than recursing into them through `validateBlocks` keeps the block pipeline focused on what it actually processes (the `blocks` array) and avoids carrying a `table` case through every block-pipeline branch.

**Alternatives considered:**
- *Move `prepareTable`/`validateTable` to a separate `tablePrepare.ts`/`tableValidate.ts` module.* Rejected — splits cohesive code that shares helpers (cell normalization, error formatting) across two files for no semantic benefit. The `block*.ts` files already have a "block-or-block-shaped-thing" feel; one extra exported function fits.

### 5. Wire-level delivery: append `table` to `blocks` at the `chat.postMessage` boundary

The MCP-tool surface keeps `blocks` and `table` separate. At the Slack send boundary (`buildDeliverFn` in `handlerResponse.ts`, `postAnswerToChannel` in `dmActions.ts`), if a prepared `table` is present, it is appended to the outgoing `blocks` array passed to `chat.postMessage`.

**Why:** Slack moves the table to the bottom regardless of position; concatenation produces the correct rendered result and keeps the wire-level call simple. The Slack API does not support passing a table as a separate argument — appending to `blocks` is the canonical shape.

### 6. Rich-text cell elements: structural Zod schema, not `z.custom`

`tableBlockSchema` is reachable as part of the input schema for the `submit_response` MCP tool via `@anthropic-ai/claude-agent-sdk`. The SDK serializes Zod schemas to JSON Schema for the MCP `tools/list` payload. **`z.custom` cannot be serialized — it has no static schema, only a runtime predicate** — so using `z.custom<RichTextBlockElement>(...)` for the rich-text element validator silently produced invalid output and broke the entire Clack MCP tool registry (not just `submit_response` — the whole server).

We therefore validate rich-text cell elements with `z.looseObject({ type: z.string() })`: a real Zod object schema that converts cleanly to JSON Schema, requires only that each element be a tagged object, and lets Slack enforce the deeper element schema server-side.

This widened the authoring types: instead of `AuthoredTableCell = string | RawTextElement | RichTextBlock`, we have:

```ts
interface AuthoredRichTextElement { type: string; }
interface AuthoredRichTextCell { type: "rich_text"; elements: AuthoredRichTextElement[]; }
type AuthoredTableCell = string | RawTextElement | AuthoredRichTextCell;
```

`RichTextBlock` from `@slack/types` is structurally a subtype of `AuthoredRichTextCell` (same `type` discriminator, narrower element shape), so call sites that construct fully-typed Slack rich text values still type-check.

**Alternatives considered:**
- *Drop rich_text cell support entirely.* Rejected — leaves cells with mentions/styled spans/links unsupported, undercutting one of the table block's main affordances.
- *Encode the full `RichTextBlockElement` schema in Zod.* Rejected — large discriminated union with nested element trees; brittle, high maintenance, and we explicitly chose not to validate cell elements deeply.

### 7. Schema validation: `looseObject` everywhere, mirroring the existing convention

Both new schemas (`markdownBlockSchema`, `tableBlockSchema`) use Zod `looseObject` (matching the existing block schemas), so optional Slack fields like `block_id` survive parsing untouched. This preserves the project's established passthrough-of-optional-fields convention.

### 8. Prompt doc: steer toward markdown-tables-in-markdown-blocks as the default tabular shape

In `block-kit-formatting.md`, document a clear hierarchy for tabular data:

1. **Default:** write a markdown table inside a `markdown` block. No 1-per-message limit (markdown blocks can repeat), simpler authoring, full formatting in cells.
2. **Escalate to the `table` parameter when** column alignment matters, wrap control matters, or cells need rich-text elements (mentions, links rendered as inline buttons).

For prose:
- **Prefer `markdown`** when the response is mostly long-form text, headers, code blocks, or task lists.
- **Use `section`** when you need `fields`, accessory elements, or short snippets where mrkdwn is sufficient.

Update `submit-response.md` to (a) drop `table` from the curated `blocks` subset reference, (b) document the new top-level `table` parameter and its `post_to` sibling, (c) point to `block-kit-formatting.md` for tabular-data guidance.

**Why:** Without explicit guidance, Claude will reach for the `table` parameter for every list, even when a markdown table would be simpler. The markdown-table-first heuristic matches what Claude does naturally and reserves the structural shape for cases where its alignment/wrap/rich-text affordances actually matter.

## Risks / Trade-offs

- **Per-cell text limit is unpublished.** A 2000-char default may be too generous (slow rendering) or too restrictive (cuts off legit content). → **Mitigation:** Start at 2000, adjust based on production observation. Easy to tune since it's one constant.
- **Markdown block changes user-visible formatting.** A response that was previously rendered as mrkdwn-section text would render slightly differently as a markdown block (real headers, inline code spacing, etc.). → **Mitigation:** This is opt-in per-block; Claude only emits `markdown` when explicitly choosing to. No existing response paths flip silently.
- **Sibling-parameter shape changes the `submit_response` MCP surface description.** Older user-override prompts that taught Claude to put `table` in `blocks` will produce a Zod parse error rather than rendering. → **Mitigation:** The default prompt files in this change correctly teach the new shape; user overrides update on their schedule. The Zod error message names the offending field, so the failure is diagnosable.
- **Two surfaces (`submit_response` and `post_to`) carry the new field.** Risk of one surface drifting. → **Mitigation:** The shared `messageContentFields` fragment in `submitResponse.ts` declares the field once and spreads into both surfaces, so the surfaces stay in lockstep by construction.

## Migration Plan

The intermediate table-as-block implementation in commit `a311e08` is replaced in-place as part of this change. Before this change archives:

1. Remove `"table"` from `BlockSchema` and `ALLOWED_BLOCK_TYPES`.
2. Drop the `case "table"` from the `prepareBlocks` and `validateBlocks` switches.
3. Drop the multi-table payload-scope check from `validateBlocks`.
4. Add the optional `table` field to `messageContentFields`, propagate through `DeliverFn`/`ResponseSnapshot`/snapshot persistence.
5. Append the prepared `table` to outgoing `blocks` at the `chat.postMessage` boundary.
6. Migrate existing tests; update prompt files.

Rollback: revert the diff. No persisted artifacts depend on either intermediate or final block types.

## Open Questions

- **Per-cell text length limit for `table`.** 2000 chars is a starting guess based on the section-field cap. Should we instrument or pick a different number? Resolve based on production observation post-archive.
- **Should `prepareTable` enforce trim/whitespace conventions on string cells?** Lean: no — passthrough, let Claude author exact strings.
