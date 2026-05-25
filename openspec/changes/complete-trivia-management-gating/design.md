## Context

Two parallel changes shipped on 2026-05-25:

- `add-plugin-topic-instructions` introduced `sdk.addTopicInstruction(role, topic, filename, content)` and the `CronJobSpec.attachedTopics` mechanism. Plugin-contributed instructions can now be loaded only when a topic is active.
- `add-trivia-game-cascade-tier` introduced the `trivia_management` integration: a catalog entry in `data/config.json`, three tools (`upsert_game`, `delete_game`, `set_workspace_config`), and an admin-facing instruction documenting them.

The two changes were coordinated explicitly. `add-trivia-game-cascade-tier/proposal.md:66` reads: "For now this change registers the `trivia_management` instruction eagerly under the admin role (via existing `sdk.addInstruction`). The parallel change can later flip it to `sdk.addTopicInstruction` for true lazy loading without breaking the tools." And `design.md:26` labels tool-side gating "a future primitive."

Neither follow-up ever shipped. The `add-trivia-game-cascade-tier` design accepted the half-built state as a known limitation (`design.md:102,115`). The result today:

- `data/config.json:167-170` advertises `trivia_management` with `alwaysLoad: false`.
- `src/plugins/trivia/index.ts:69` registers the management instruction as **baseline** (`sdk.addInstruction(...)`), so it loads for every admin session regardless of attach state.
- `src/plugins/trivia/index.ts:115-121` registers the three management tools unconditionally; `src/plugins/trivia/index.ts:137-143` does the same for the four season tools (themselves admin-tier but never claimed by `trivia_management`).
- `src/tools/server.ts:448-468` filters plugin tools only by `meetsMinimumRole`. There is no consultation of `session.attachedIntegrations`.
- `src/tools/query/attachIntegration.ts:141,161-165` correctly resolves topic instructions and adds the integration to `session.attachedIntegrations` — but since no `addTopicInstruction("admin", "trivia_management", ...)` call exists and no tools are topic-gated, the attach is a no-op that returns the misleading message "instructions were loaded, no new tools arrive" (which, in this case, is literally true: nothing happened).

The user-visible bug: when an admin says "update the trivia game config," Claude often calls `upsert_season` instead of `upsert_game`. The season tool is freely available and the catalog framing for the management tools reads as gated, so Claude takes the path of least resistance. The fix is to make the gating real **and** to expand the integration so all seven config-mutation tools sit behind it as a coherent toolkit.

Tools that should NOT move into the integration:
- **Runtime tools** called inside cron-fired flows (`get_ideas`, `save_question`, `post_questions`, `get_question_history`, `submit_answers`, `process_reveal_answers`, `check_season_status`, `save_cheating`). Topic-gating these would break scheduled fires.
- **Read-only inspection tools** (`list_games`, `list_seasons`, `find_previous_questions`, `retrieve_scores`). Gating them would force a roundtrip attach for harmless lookups.

## Goals / Non-Goals

**Goals:**
- Make `trivia_management` a real gate: the seven config-mutation tools are hidden from the assembled catalog until `attach_integration("trivia_management")` is called for the session.
- Make the management instruction load only when the topic is active (`addInstruction` → `addTopicInstruction`).
- Widen the integration to cover all seven admin-initiated config-mutation tools, so "management" is a coherent toolkit instead of an arbitrary slice of three.
- Add the SDK primitive — extend `ClackSdk` so plugins can topic-gate their tools at registration time, matching the existing topic-gating mechanism for instructions.
- Update the catalog description and the admin instruction so the documented surface matches the live surface.

**Non-Goals:**
- No changes to the tool implementations themselves (signatures, behavior, persistence shape). The seven affected tools' handlers do not change.
- No data migration. No persisted state (`config.json`, `seasons.json`, `categories.json`, sessions) is touched.
- Not gating runtime tools or read-only inspection tools (see Context — would break cron flows or worsen ergonomics).
- Not introducing a second integration (e.g., `trivia_questions_admin`). One coherent management surface is enough.
- Not auto-attaching `trivia_management` for admin sessions. The catalog → `attach_integration` flow is the documented contract for lazy MCP loading; this change extends that contract to plugin-registered tools, it does not bypass it.
- Not changing how `attach_integration` behaves for MCP-backed integrations. The MCP-backed branch in `src/tools/query/attachIntegration.ts:146-160` is unchanged.

## Decisions

### 1. Extend `sdk.registerTool` with an options-object 4th argument

Signature becomes `registerTool(minRole, tool, mapping, options?: { topic?: string })`. Omit `options` (or pass `{}`) for always-available behavior — identical to today. Pass `{ topic: "trivia_management" }` to topic-gate the tool.

**Why an options object, not a positional `topic?: string`:** future-extensible. Other registration knobs (e.g. hidden-from-catalog, runtime-only, alternate display group) can land alongside without rippling through every call site.

**Why a single method, not a separate `registerTopicTool`:** the precedent of `addInstruction` / `addTopicInstruction` exists because for instructions the loading semantics are bulk-content and the call-site change ("always-loaded" vs "on-demand") is genuinely subtle. For tools the topic name is right there in the call (`{ topic: "trivia_management" }`) and is self-documenting. A single method keeps the SDK surface smaller, and the options-object shape removes any "fourth positional string changes everything" foot-gun.

**Alternative considered:** Separate `registerTopicTool` method mirroring the instruction-side precedent. Rejected — for tools, the call-site change is already explicit; doubling the surface area buys nothing.

**Alternative considered:** Extending the `ToolMapping` object with a `topic` field. Rejected — `mapping` is visual-display metadata; routing the gating decision through it conflates layers.

**Implementation:** `RegisteredTool` gains an optional `topic?: string` field. `registerTool` reads `options?.topic` and propagates it onto the record. Existing call sites that omit `options` produce `RegisteredTool` records with `topic: undefined`, identical to today.

### 2. Gating filter lives in `src/tools/server.ts`, alongside the existing role filter

The plugin tool assembly at `src/tools/server.ts:452-453` already filters by `meetsMinimumRole(ctx.role, registered.minRole)`. The topic filter is the natural neighbor: skip the tool when `registered.topic !== undefined` AND `(ctx.session.attachedIntegrations ?? []).indexOf(registered.topic) === -1`. Both filters are local to the same loop, and a tool is included only when both pass.

The `ctx.session` shape already carries `attachedIntegrations` (used by `attach_integration` at `src/tools/query/attachIntegration.ts:169-179` and by resume logic). No new context field is needed.

**Alternative considered:** Computing a `visibleTopics` set up front and pre-filtering the plugin's `tools` array before the role loop. Rejected as premature optimization — the role filter already runs per tool per session; adding a single set-lookup alongside it is constant-time and keeps the gating logic co-located.

### 3. The seven tools move into `trivia_management`

Tools (and the rationale for each being management, not runtime):

| Tool | Why it's management |
|---|---|
| `upsert_game` | Mutates `config.json games[]`; admin-initiated lifecycle. |
| `delete_game` | Same. |
| `set_workspace_config` | Mutates `config.json` workspace-tier defaults. |
| `upsert_season` | Mutates per-game `seasons.json`; admin-initiated. Cron flows never call it. |
| `delete_season` | Same. |
| `add_categories` | Mutates global `categories.json` or per-season pools. Admin-initiated. |
| `remove_categories` | Same. |

The cron-fired runtime tools (`get_ideas` etc.) stay always-available because they are called by Claude inside a scheduled session that has no easy way to know it should attach a management integration — and shouldn't have to.

**Alternative considered:** Putting `add_categories` / `remove_categories` in a separate `trivia_categories` integration. Rejected — the user-facing distinction "game lifecycle vs categories" doesn't exist; admins say "add the 'Quebec history' category" in the same breath as "set up next month's season." Two integrations would mean two attach calls for a single management session.

### 4. Instruction registration flips to `addTopicInstruction("admin", "trivia_management", "trivia-management", ...)`

Today: `sdk.addInstruction("admin", "trivia-management", TRIVIA_MANAGEMENT_INSTRUCTION)`.
After: `sdk.addTopicInstruction("admin", "trivia_management", "trivia-management", TRIVIA_MANAGEMENT_INSTRUCTION)`.

The override path admins use changes from `data/configuration/admin/trivia__trivia-management.md` (baseline) to `data/configuration/admin/topics/trivia_management/trivia__trivia-management.md` (topic). Since the file is plugin-shipped (no admin currently overrides it), this is invisible to operators.

The instruction body is also rewritten to enumerate all seven tools (currently lists three) and to include the explicit dispatch heuristic. The rewrite is purely content; it does not change the registration mechanism beyond the flip above.

### 5. Plugin-declared integrations are namespaced `<plugin>:<key>` and registered via `sdk.registerTopic`. The integration is renamed `trivia_management` → `trivia:management`. The `data/config.json` entry is deleted.

Today, `data/config.json:mcpServers.trivia_management` exists as a catalog-only virtual entry (no actual MCP server config). The trivia plugin depends on it for `attach_integration("trivia_management")` to validate. This is a leaky abstraction — a plugin-owned concept living in bot-level config.

**Namespacing convention:** plugin-declared integrations are conventionally named `<pluginName>:<key>` (e.g., `trivia:management`). Matching the existing `sdk.reconcileCronJobs(ownerKey, specs)` shape (`src/plugins/sdk.ts:508`), the plugin types the full name as a string and the SDK does not validate the prefix. The plugin's own integration tests catch typos. The colon-prefix convention self-documents the integration's owner and structurally avoids cross-plugin collisions when followed (plugin names are unique — enforced by `src/plugins/registry.ts`).

**New primitive:** `sdk.registerTopic(name, { description, alwaysLoad? })`. Plugins call this during init to declare catalog-only virtual integrations. The contribution lands on the `PluginLoadResult` and is merged into the effective MCP registry by `resolveEffectiveRegistry()` at boot (after plugin load, before session creation).

**MCP-backed plugin integrations are out of scope.** Today `loadMcpServer(name)` reads `data/mcp.json` for actual server configs — plugins can't ship MCP server commands through the SDK. Plugin-declared integrations are catalog-only (the `instructions_only` branch in `attach_integration` always fires). If a future plugin needs to ship an MCP server, that's a separate primitive (`sdk.registerMcpServer` or similar) — not in this change.

**Result:** the trivia plugin's init grows one line — `sdk.registerTopic("trivia:management", { description: "...", alwaysLoad: false })`. The `data/config.json` entry is deleted. The integration is everywhere now called `trivia:management` (not `trivia_management`): in `sdk.addTopicInstruction`, in the seven `registerTool` `{ topic }` options, in the on-disk override path (`data/configuration/admin/topics/trivia:management/...`), and in Claude's `attach_integration` calls. `manager.knowsServer("trivia:management")` returns true at runtime because the resolver-merged registry contains the plugin's contribution.

**On-disk dir name with a colon.** The cascading config resolver builds paths like `topics/${topic}/<file>` (see `src/plugins/sdk.ts:431` and `src/cascadingConfigResolver.ts:154`). On Linux/macOS, a colon in a directory name is legal. The bot's Docker image runs Linux; the dev environment runs macOS. Windows-on-bare-metal would break, but that target is not shipped.

**Alternative considered:** Have the SDK auto-prepend `<pluginName>:` so the plugin only passes `"management"`. Rejected — that diverges from the `reconcileCronJobs(ownerKey, ...)` shape where the plugin types the owner key explicitly. Consistency with the existing SDK contract matters more than the small typo-savings.

**Alternative considered:** Boot-time collision check + duplicate-registration check enforced by the SDK. Rejected as redundant — the namespacing convention makes collisions structurally avoidable, and the resolver-merge step's natural "last write wins" + clear logging is enough.

### 6. Catalog description content (now inside the plugin call)

Inside `sdk.registerTopic("trivia_management", { description: "..." })`, the description enumerates all seven tools by name: `upsert_game`, `delete_game`, `set_workspace_config`, `upsert_season`, `delete_season`, `add_categories`, `remove_categories`.

The catalog description is what Claude reads when deciding to call `attach_integration` (`src/claude/integrationsCatalog.ts:20-38`). Listing all seven tools by name is the primary discovery surface — Claude scans descriptions for the tool it needs.

### 7. `attach_integration` behavior is unchanged

The flow at `src/tools/query/attachIntegration.ts:48-204` already does the right thing for plugin-only (non-MCP-backed) integrations: it resolves topic instructions (`:141`), takes the `instructions_only` branch when there's no MCP server (`:161-165`), adds the topic to `session.attachedIntegrations` (`:169-179`), and returns the resolved instructions to Claude.

Once Decisions 1–6 land, the same code path becomes load-bearing: `manager.knowsServer("trivia_management")` still returns true (the resolver-merged registry now contains the plugin's contribution), the topic instructions actually resolve (because `addTopicInstruction` was called), the persisted `attachedIntegrations` entry is actually consulted by the tool assembler, and Claude's next-turn catalog actually contains the seven tools it didn't see before.

The misleading success message at `src/tools/query/attachIntegration.ts:185-187` (`"This integration has no MCP server — instructions were loaded, no new tools arrive."`) is technically wrong for plugin-topic-gated tools, since new tools DO arrive on the next turn. We update the conditional to emit `"New tools may now be available on the next turn."` (the same string used for the MCP-backed branch) whenever resolved instructions are non-empty OR plugin-registered topic-gated tools exist for this topic.

### 8. Test surface

- **SDK unit tests** (`src/plugins/sdk.test.ts`): `registerTool` with `{ topic }` records a `RegisteredTool` with the right `topic` field; without options, records `topic: undefined`. `registerTopic("foo:bar", { description })` records a `PluginTopic` contribution on the harvest result. A second `registerTopic("foo:bar", ...)` from the same plugin records a second entry (de-dup is resolver behavior, not SDK-enforced).
- **Registry resolver test** (`src/mcp.test.ts` or sibling): `resolveEffectiveRegistry` merges plugin contributions; a plugin contribution colliding with a `config.mcpServers` entry throws with both source names mentioned.
- **Tool assembly integration test** (`src/tools/server.test.ts`): given a plugin that registers tools at two topics + one baseline, an admin session with `attachedIntegrations: ["foo"]` sees only the foo-topic tools and the baseline tool; with `attachedIntegrations: []`, sees only the baseline; with `attachedIntegrations: ["foo", "bar"]`, sees all three.
- **Trivia plugin integration test**: an admin session that has NOT attached `trivia_management` does not see any of the seven tools by full MCP name. After `attach_integration("trivia_management")`, the next session-assembled tool catalog contains all seven. Catalog string assembled by `buildIntegrationsCatalog` contains the trivia_management description (proving plugin-contributed entry made it through).
- **Existing trivia tests continue to pass**: the per-tool unit tests for `upsertGame`, `upsertSeason`, etc. test handler behavior, not registration. They should be untouched.
- **Description content test**: a unit test on the trivia plugin's hard-coded `TRIVIA_MANAGEMENT_DESCRIPTION` (or whatever the constant is named) asserts the string mentions all seven tool names. Guards against description drift.

## Risks / Trade-offs

- **[In-flight admin sessions break across deploy]** Admin sessions started before deploy may have used the management tools without explicitly attaching the integration. Post-deploy, those tools disappear from the catalog. → Mitigation: the catalog framing already prompts Claude to call `attach_integration` for non-always-on integrations; sessions that hadn't attached will simply get a one-turn detour where Claude attaches then proceeds. User-visible impact: slight latency on the first management action per session. Cron-fired sessions are unaffected.

- **[Topic name typos go undetected]** A plugin calling `registerTool(..., { topic: "trivia_managment" })` with a typo would silently never expose the tool (no session would ever attach the typo'd topic). → Mitigation: same risk exists today for `addTopicInstruction` (acknowledged in `add-plugin-topic-instructions/design.md:121`, accepted as "best caught by tests, not runtime checks"). The trivia plugin's own integration tests would catch the case immediately. We do not add a runtime registry-cross-check for the same reason the sibling change rejected one.

- **[The `attach_integration` success message subtly drifts]** Changing the message for plugin-topic-only integrations from "no new tools arrive" to "new tools may now be available" risks a test snapshot breaking somewhere. → Mitigation: grep for the exact string before the change; update any snapshot fixtures alongside the code change.

- **[Stale cross-references in older docs]** The CLAUDE.md sections, OpenSpec capability docs, or worktree README files may reference `trivia_management` as a documented-but-not-real integration. → Mitigation: grep `trivia_management` across `/openspec`, `CLAUDE.md`, `data/default_configuration/`, and `README*.md` during implementation; update or delete stale references in the same PR.

## Migration Plan

No data migration. Code-only deploy.

**Pre-deploy:**
- Land all code changes in a single PR (SDK + server filter + trivia registration flips + instruction rewrite + catalog description + tests).

**At deploy:**
- Restart the bot. On next session creation, the new tool-assembly filter takes effect.
- Existing persisted sessions retain their `attachedIntegrations` array. Sessions that had previously attached `trivia_management` for any reason will see the seven tools immediately on resume; others will need an attach call (handled naturally by the catalog-driven dispatch).

**Rollback:**
- Revert the PR. The SDK additions (`registerTopicTool`, new `topic` field on `RegisteredTool`) are additive; reverting them removes the gating filter and the seven tools become always-available again. No persisted state changes to undo.
