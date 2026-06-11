## Why

Clack can find and re-host existing images (`giphy`, `commons-image-search`, `brave-image-search`) but cannot **create** one. Users want the bot to generate original images from a prompt — and to edit an image they upload — directly from Slack. The Google Gemini image models do both; the `betaflag/imagine` CLI inspired this but is a Go binary with no MCP surface and no editing, so we integrate the Gemini API directly instead.

## What Changes

- New in-process plugin `gemini-image` (sibling of `giphy`), registered on its always-on default server, exposing one member-gated tool `mcp__gemini-image__generate_image`.
- The tool **generates** an image from a text prompt and **edits** an existing image (an uploaded Slack image + a text instruction → an edited image).
- Model selection is exposed as a high-level `quality` enum (`fast` / `best`), never raw model IDs. The tier→model map is plugin config so an admin can repoint it without code changes; the edit path uses an edit-capable model.
- A `deliver` arg (`upload` | `data` | `both`, default `upload`) controls where the result lands: posted to the Slack thread via `files.uploadV2`, returned inline to Claude as image bytes, or both.
- The tool's description and result envelope state unmistakably that the image is **AI-GENERATED, not a photograph of any real subject** — structurally keeping it out of trivia's by-description image-source discovery, and it returns **no** `media`/license metadata block, so it can never satisfy trivia's save gate.
- New dependency `@google/genai`; new env var `GEMINI_API_KEY` (in `data/auth/.env`), read with graceful failure when unset.

## Capabilities

### New Capabilities
- `gemini-image-generation`: a Slack-triggered tool that generates and edits images via the Gemini API, with high-level model tiers, configurable delivery (Slack upload / inline bytes / both), an explicit AI-generated provenance contract, and graceful degradation when the API key is absent.

### Modified Capabilities
<!-- None — this is a self-contained new plugin; no existing spec's requirements change. -->

## Impact

- **New code:** `src/plugins/gemini-image/**` (plugin entry, tool, Gemini client boundary, usage instruction, tier→model config, tests).
- **Plugin registration:** one line wherever plugins are registered (`src/plugins/index.ts` or equivalent).
- **Dependencies:** add `@google/genai` to `package.json`.
- **Config/secrets:** `GEMINI_API_KEY` documented in README and `data/auth/.env`; optional `data/plugins/gemini-image/models.json` tier override (hot-reloaded).
- **No impact** on trivia, the Changes Workflow, or other plugins — removable by deleting the folder and its registration line.
