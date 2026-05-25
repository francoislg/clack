## Context

The cascading-config-resolver already supports two layers of instruction content:

- **Baseline** — `{role}/*.md` files, always loaded for the active role chain.
- **Topics** — `{role}/topics/<topic>/*.md` files, loaded only when a topic is "active" for the session. Today, topics are activated mid-session by Claude calling the `attach_integration` tool — the only registered topics live in `data/config.json` under `mcpServers: { <name>: { alwaysLoad, description } }`, and a topic name maps 1:1 to an MCP server.

The resolver also accepts **virtual defaults** — a `Map<role, Map<filename, content>>` that plugins populate via `sdk.addInstruction`. The resolver merges virtual defaults with on-disk defaults during cascade resolution, and lets `data/configuration/{role}/{filename}.md` override them. Plugin instructions registered today are baseline-only — their virtual-default keys never start with `topics/`.

Two existing pieces in the resolver already anticipate plugin-driven topics:

- `resolveTopicFiles` (src/cascadingConfigResolver.ts:166) reads virtual-default keys of the form `topics/<topic>/<filename>.md` and merges them into the per-topic cascade.
- `resolveInstructions` (src/cascadingConfigResolver.ts:66) accepts an `activeTopics: Set<string>` input and emits a `=== TOPIC: <name> ===` header for each.

What's missing is the plumbing to (a) let plugins write to the topic-keyed virtual-default slots, and (b) drive `activeTopics` from a source other than `attach_integration` runtime activation — specifically, from a plugin's own scheduled (cron) runs.

The Trivia plugin is the motivating use case. Its question-generation and reveal cron jobs deliver a hardcoded prompt (`SEND_QUESTIONS_INSTRUCTIONS`, `PROCESS_REVEAL_INSTRUCTIONS` in `src/plugins/trivia/prompts/scheduledPrompts.ts`) as the `messageText`, with the persona, reveal-tone hints, and season-finale wrap-up wording inlined as TypeScript string constants. Admins cannot tweak any of that without editing source. Some adjacent content in those files — cheating-detection guidance and block-layout contracts that couple to specific MCP tool schemas — must stay hardcoded.

## Goals / Non-Goals

**Goals:**

- Add a plugin SDK surface (`addTopicInstruction`) that lets plugins ship topic-scoped instruction content as virtual defaults.
- Let plugins declare, per cron job, which topics should be auto-attached when that job fires — so plugin-owned scheduled runs load plugin-owned topic content without Claude needing to call `attach_integration`.
- Propagate that declaration end-to-end: `CronJobSpec` → persisted `CronJob` → `cronScheduler.executeDynamicJob` → `processMessage` → `loadInstructions` → resolver `activeTopics`.
- Preserve the existing override semantics: a file at `data/configuration/{role}/topics/<topic>/<plugin>__<filename>.md` overrides the plugin-shipped virtual default.
- Migrate Trivia's `GAME_SHOW_PERSONA`, reveal-tone wording, and season-finale wrap-up tone into a `trivia` topic, leaving cheating-detection text and block-layout rules inline.

**Non-Goals:**

- Reworking how `attach_integration` (the MCP-driven topic mechanism) activates topics mid-session. The runtime activation path stays exactly as it is today.
- Coupling plugin topics to MCP server registration. A plugin topic is just a name; it does not require an entry in `config.json → mcpServers`.
- Per-game or per-season override files. A `trivia` topic file applies to every game/season run; per-game or per-season tuning is already handled by `themeExtras`, `contexts`, and the four-axis config in `config.trivia`. Layering per-game topic overrides on top of those is out of scope.
- Letting members register topic instructions or override them. Topic instruction override is a `data/configuration/` file edit — same admin-gated path as baseline instruction overrides.
- Moving cheating-detection text, FIVE-BLOCK question layout, reveal block layout, or Round Summary format out of `scheduledPrompts.ts`. These couple to tool contracts (`post_questions`, `process_reveal_answers`) and must not drift per workspace.
- Tooling for admins to author or edit topic files via the Home Tab UI. Out of scope; admins use file edits like they do for baseline instructions.

## Decisions

### 1. Reuse the existing `topics/<topic>/<filename>.md` virtual-default key shape

`resolveTopicFiles` already keys topic virtual defaults as `topics/<topic>/<filename>.md` and `listRoleDirFiles` already skips topic keys when scanning the baseline. Adopting the same key shape means zero changes to the resolver internals — the SDK just has to build the key correctly.

**Alternative considered:** A separate `topicVirtualDefaults` map alongside `virtualDefaults`, keyed by `(role, topic, filename)`. Cleaner conceptually, but doubles the wiring through `buildVirtualDefaults`, `resolveInstructions`, and every list/topic-scan helper. The single-map design with a path-style key wins on minimal churn.

### 2. `sdk.addTopicInstruction(role, topic, filename, content)` — separate method, not an overload

A discrete method makes the call site self-documenting and keeps the SDK signature unambiguous. The implementation routes content into the same `instructions` array that `addInstruction` populates, but with a key of `topics/${topic}/${pluginName}__${filename}.md`.

**Alternative considered:** Extending `addInstruction` with an optional `topic` parameter. Rejected because plugins reading the existing call-site pattern would have to learn that a fourth-arg-string changes the loading semantics from "always" to "on-demand" — too subtle for a foot-gun this consequential.

### 3. Plugin auto-attach happens via `CronJobSpec.attachedTopics`

The trivia plugin already knows when it's the trigger — it owns the cron jobs that fire `SEND_QUESTIONS_INSTRUCTIONS` and `PROCESS_REVEAL_INSTRUCTIONS`. Adding `attachedTopics?: string[]` to `CronJobSpec` lets the plugin declare, at reconcile time, "when these jobs fire, treat the `trivia` topic as active." The scheduler persists the field on `CronJob` and forwards it through `executeDynamicJob`.

This is a generic mechanism: any plugin's cron specs can declare any topic name, not just topics the same plugin owns. Cross-plugin attaching is allowed but undocumented — useful for tests, not a feature we'll publicize.

**Alternative considered:** A boolean `attachOwnTopic: true` shortcut that infers the topic name from the plugin name. Less flexible, and "plugin name == topic name" is a convention we don't want to lock in (a plugin might own multiple topics — e.g., `trivia` and `trivia-finale`).

**Alternative considered:** Auto-attach all topics owned by the plugin whenever the plugin's tool is called. Rejected — too magical, hard to reason about, and would burden the resolver with cross-cutting plugin awareness.

### 4. `processMessage` gains a `preAttachedTopics: string[]` option, separate from runtime-attached topics

`attach_integration` injects topics mid-session by adding them to session state. Pre-attached topics (from a cron job's declaration) need to be active at the *first* turn, before any tool calls have happened — so they must be applied during the initial `loadInstructions` call. We thread them through as a separate option (`preAttachedTopics`) and `loadInstructions` unions them with runtime-attached topics when computing `activeTopics` for downstream turns.

**Alternative considered:** Seeding the session state with the pre-attached topics so the existing path covers them. This works for downstream turns but not the first one — the first system-prompt assembly happens before session state is fully wired. The explicit option is simpler.

### 5. Topic instruction overrides live at `data/configuration/{role}/topics/<topic>/<plugin>__<filename>.md`

The `<plugin>__` filename prefix is the same convention used for baseline plugin instructions (`src/plugins/sdk.ts:365`). It namespaces overrides so two plugins can both contribute a `persona.md` to the same topic without colliding. Admins who want to override the trivia persona drop a file at `data/configuration/user/topics/trivia/trivia__persona.md`.

**Trade-off:** The path is verbose. We accept it because (a) the `<plugin>__` prefix is already a documented convention admins have seen, (b) only a handful of files at any one path will exist, and (c) collision-free overrides matter more than path brevity.

### 6. Hot reload uses the existing config watcher

The cascading resolver is invoked fresh on every `loadInstructions` call (no cached output between turns). Plugin virtual defaults are rebuilt from `getLoadedPlugins()` each time. File overrides are read on the next turn after the file changes. No additional watcher wiring is needed for the topic path — the existing `configWatcher` already covers `data/configuration/**/*.md`.

### 7. Trivia adoption: extract three files, keep the rest

| Content | Today (scheduledPrompts.ts) | After |
|---|---|---|
| `GAME_SHOW_PERSONA` constant | inlined in both prompt exports | `topics/trivia/persona.md` (virtual default) |
| Reveal-tone hint ("punchy", "use your persona") | inlined in `PROCESS_REVEAL_INSTRUCTIONS` | `topics/trivia/reveal-tone.md` (virtual default) |
| Season-finale wrap-up wording (lines 651, 662) | inlined in `PROCESS_REVEAL_INSTRUCTIONS` | `topics/trivia/finale-tone.md` (virtual default) |
| Cheating-detection text | inlined | **stays inlined** — couples to detection tool contract |
| FIVE-BLOCK question layout | inlined | **stays inlined** — couples to `post_questions` block schema |
| Reveal block layout + Round Summary format | inlined | **stays inlined** — couples to `process_reveal_answers` schema |
| `GAME_CONTEXT_DIRECTIVE` | inlined | **stays inlined** for now — already configurable via `config.trivia.contexts` |

The two exported prompts gain a short reference line at the top: "Your persona, tone, and seasonal finale style are described in the `trivia` topic instructions." Claude reads the topic from its system prompt; the cron-message prompt doesn't need to repeat the content.

### 8. Trivia cron specs declare `attachedTopics: ["trivia"]`

Both `<game>:question` and `<game>:reveal` specs in `src/plugins/trivia/domain/buildGameSpecs.ts` set `attachedTopics: ["trivia"]`. The reconciler in `src/cronJobs.ts` persists it. On the next reconcile (which runs on every plugin init), existing jobs without the field get patched — no migration required.

## Risks / Trade-offs

- **[Risk]** Plugin authors using `addTopicInstruction` without registering the topic anywhere obvious — files are invisible to anyone reading `data/configuration/` and there's no `mcpServers` entry. → **Mitigation:** Surface registered plugin topics in the home-tab "Instructions" listing as a separate "Topics" section, alongside the existing per-role listing. Also document the SDK method with a clear "the file path admins will use to override" example.

- **[Risk]** A plugin declares `attachedTopics: ["foo"]` but never registers virtual defaults for `foo` and no on-disk override exists. → **Result:** the topic resolves to empty content and the only side effect is a `=== TOPIC: foo ===` header with no body. Acceptable; the header on its own is a low-cost diagnostic signal to the plugin author. We will not error on missing-topic-content because admins should be free to delete all topic files for cleanup without breaking the cron job.

- **[Risk]** Removing the inline `GAME_SHOW_PERSONA` from `SEND_QUESTIONS_INSTRUCTIONS` changes the prompt Claude actually sees, even when no admin override exists. The persona moves from "first 80 characters of the user message" to "a paragraph in the system prompt." That could shift generation behavior in subtle ways (tone, ordering, exact phrasing in posted Slack blocks). → **Mitigation:** Keep the exact persona text byte-for-byte; only its delivery path changes. Add a regression test that pins a recent generated-question snapshot against pre/post behavior on a fixed game + season + axis combination. If the snapshot diff is meaningful, iterate on the persona text or re-inline a short anchor line in the user message ("Use the persona from your system instructions").

- **[Risk]** A plugin attaches a topic whose name collides with an `mcpServers` topic (e.g., the runtime adds an MCP server called `trivia`). → **Result:** content from both sources merges in the same `=== TOPIC: trivia ===` section. → **Mitigation:** Reserve topic names per-plugin by convention (prefix with plugin name where ambiguity is a concern). Trivia owns the `trivia` topic name. We'll document this and not enforce uniqueness in code — the resolver merging is harmless.

- **[Risk]** A misnamed `<plugin>__<filename>.md` override file in `data/configuration/` is silently ignored if the prefix doesn't match a registered plugin instruction. → **Mitigation:** This is already the case for baseline overrides; the home-tab listing distinguishes `plugin`, `plugin-customized`, and `custom-only` source labels. We'll extend the topic listing to use the same labels.

- **[Trade-off]** This change adds three new files of plumbing (SDK method, cron-job field, processMessage option) for what is, on the surface, a string-extraction task. The payoff is reusable for every future plugin that wants overrideable on-demand content. If we wired only the trivia case (e.g., a `config.trivia.persona` field), we'd be back here the next time another plugin needs the same shape.

## Migration Plan

- No data migration required. `attachedTopics` is optional; existing persisted `CronJob` entries without the field continue to work and gain the field on next plugin reconcile (which runs on every boot).
- Default `data/configuration/user/topics/trivia/` is empty. Admins opt in to overrides by creating the file.
- Trivia integration tests update to verify the persona content arrives via topic loading rather than as part of the user message. Snapshot tests on `SEND_QUESTIONS_INSTRUCTIONS` content will change; that's expected and the tests will be updated atomically with the source.
- Rollback: revert the trivia source change (re-inline the persona constants); the SDK addition is inert if no plugin uses it.

## Open Questions

- Should the `=== TOPIC: trivia ===` header text be customizable per-topic (e.g., to "PERSONA & TONE" for the trivia case)? → **Tentative answer:** No. The header is a system-prompt structural marker, not user-facing. Keep it as-is.
- Should we surface topic-instruction overrides in the home-tab "Instructions" page as a sibling tab? → **Tentative answer:** Out of scope for this change; track separately. The CLI/file path is sufficient for the first iteration.
- Should `addTopicInstruction` enforce that `topic` names match a registered topic (either MCP-driven or plugin-declared somewhere)? → **Tentative answer:** No. The cron-job `attachedTopics` field is the implicit declaration. Forcing pre-registration adds friction without preventing the failure mode we'd be guarding against (typo'd topic names — best caught by tests, not runtime checks).
