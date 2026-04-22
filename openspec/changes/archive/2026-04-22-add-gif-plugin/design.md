## Context

Clack responses are plain text today. Adding a GIF capability lets Claude add visual punch in playful contexts (DMs, @mentions) without risking hallucinated URLs — a real API call grounds every GIF URL. The existing plugin system (used by `trivia`) already provides the right primitives: an in-process MCP server, SDK-registered tools, and cascaded instructions injected into the system prompt. This change rides that system rather than extending it.

## Goals / Non-Goals

**Goals:**
- Expose a single simple tool (`find_gif`) that Claude can call when a GIF would land.
- Guarantee every GIF URL Claude emits is real (SFW, from Tenor) — no hallucinated URLs.
- Keep the integration zero-ceremony: one Node plugin, one env var, one instruction file.
- Respect Slack UX: render via Block Kit `image` blocks (reliable), no file uploads.
- Respect Tenor ToS (attribution) and workplace norms (strict SFW filter, no ephemeral GIFs).

**Non-Goals:**
- No curated/local GIF library — Tenor only.
- No image uploads to Slack (`files.uploadV2`) — Block Kit `image` blocks only.
- No GIPHY or multi-provider abstraction.
- No per-user/per-channel enable/disable — one global toggle (plugin listed in `data/config.json` or not).
- No rating/safety configuration surface — SFW is hard-coded.
- No mid-session lazy loading via `attach_integration` — this ships as an always-on plugin.

## Decisions

### Decision: Ship as an always-on plugin (not a lazy integration)
**Choice:** Register through `src/plugins/registry.ts` and `data/config.json → plugins: ["gif"]`, mirroring `trivia`.

**Rationale:** The user wants it always available. Plugins are the existing pattern for in-process, Node-backed tools with Cascade-injected instructions. The alternative — lazy loading via `attach_integration` — would require either an external MCP server or extending the plugin SDK to support topic-scoped registration. Both are more work than the feature warrants.

**Alternatives considered:**
- Lazy topic via `mcpServers` registry: would keep the baseline prompt leaner but costs plugin-SDK changes or an external process. Rejected on scope.
- External MCP stdio server under `data/mcp.json`: viable but adds a subprocess for zero benefit over in-process.

### Decision: Tenor as the single provider
**Choice:** Tenor (`https://tenor.googleapis.com/v2/search`), Google-owned, free API key.

**Rationale:** Bigger catalog than GIPHY's developer tier, generous quotas without needing production-key review, strong SFW filtering via `contentfilter=high`. GIPHY requires app review for production keys, which is friction we don't need.

**Alternatives considered:**
- GIPHY: comparable catalog but dev keys are rate-limited and production keys need review.
- Curated/local library: rejected by user.
- Hybrid curated + Tenor: rejected by user.

### Decision: Tool shape returns an array of 1
**Choice:** `find_gif({ query: string, limit?: number })` returns `Array<{ url, previewUrl, title }>` with a default `limit` of 1.

**Rationale:** Keeps the call site future-compatible if we ever want to let Claude pick among candidates, without changing the return type. Default `limit: 1` keeps token cost minimal and sidesteps "pick-from-titles-blindly" problems.

### Decision: Randomize results server-side
**Choice:** Include `random=true` (Tenor's `/v2/search` supports it) so repeated identical queries return variety.

**Rationale:** Tenor's top-1 is otherwise deterministic — "celebrate" would always return the same GIF. Server-side randomization gives variety with zero client-side state.

### Decision: Hard-code `contentfilter=high`
**Choice:** The parameter is fixed in the HTTP client; tool arguments cannot override it.

**Rationale:** Workplace Slack. Misuse is catastrophic. Tenor's `high` filter is explicitly "SFW and family-friendly". No business case for relaxing it today.

### Decision: API key via environment variable
**Choice:** Read `GIF_TENOR_API_KEY` from `process.env`, load `data/auth/.env` through existing mechanisms. The non-secret `client_key=clack` is hard-coded.

**Rationale:** Matches how every other secret in Clack is handled (`SLACK_BOT_TOKEN`, `GITHUB_APP_PRIVATE_KEY`, etc.). No new config surface. Missing key → tool returns a helpful error string, plugin still loads.

### Decision: Scope GIFs by trigger mode via instructions, not code
**Choice:** The baseline instructions say "do not include GIFs in ephemeral (reaction-trigger) responses." No runtime enforcement.

**Rationale:** Delivery-mode awareness already flows into the prompt (`delivery-context` capability). Instruction-level scoping is cheaper than plumbing a trigger flag into every tool call, and consistent with how other mode-aware behaviors are steered.

**Trade-off:** Claude might violate the rule. If this becomes a problem, a second pass could strip GIF URLs from reaction-mode `submit_response` payloads at the tool boundary.

### Decision: Render with a Block Kit `image` block (not URL unfurl)
**Choice:** Claude emits a Block Kit `image` block inside `submit_response.blocks`, using the Tenor URL as `image_url` and a short description as `alt_text`.

**Rationale:** Initial URL-unfurl approach failed in practice — Slack did not unfurl `media.tenor.com` links reliably, so the GIF showed up as a bare link. Block Kit `image` blocks always render. The existing `submit_response` schema already accepts `image` blocks (see `src/slack/blockSchema.ts`), so no infrastructure change is needed.

**Trade-offs:** Slightly more instruction surface area — Claude has to build a block rather than drop a URL. Mitigated by providing a concrete example in the baseline instructions.

### Decision: Attribution is enforced via instructions
**Choice:** The baseline instructions require the string "via Tenor" in any message containing a GIF.

**Rationale:** Tenor's ToS requires visible attribution. The instruction-level enforcement matches how other response-formatting rules are steered. No runtime post-processing needed.

## Risks / Trade-offs

- **[Hallucinated URLs]** → Instructions explicitly forbid pasting any GIF URL not returned by `find_gif`. Tool returns exactly the URLs Tenor provides. Random (made-up) URLs are therefore impossible if Claude follows instructions — same enforcement strength as `submit_response` being mandatory.
- **[Claude overuses GIFs]** → The baseline instructions cap at one GIF per message and scope usage to "when the moment fits". Follow-up tuning can tighten the tone (e.g., only on acknowledgements/celebrations).
- **[Tenor API downtime / quota]** → The tool returns a clear error message; Claude is instructed to gracefully continue without a GIF rather than retry or apologize at length.
- **[Reaction-mode violation]** → Instruction-only scoping. If Claude slips, we can add tool-boundary enforcement later.
- **[Attribution missed]** → Same risk class as any instruction-following gap. Visible in output, so regressions are easy to spot.
- **[NSFW leak]** → Mitigated by Tenor's `contentfilter=high`, hard-coded. No override surface.
- **[Key leakage]** → The key is read from `data/auth/.env` (already gitignored) and only used server-side; the tool return value never echoes it.
