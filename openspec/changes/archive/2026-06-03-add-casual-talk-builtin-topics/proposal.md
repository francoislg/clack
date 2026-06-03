## Why

A fresh casual-talk deployment ships with `smallTalkTopics: []`, so until an admin manually seeds a topic list the bot never opens fresh small talk — it only chips into already-active threads, and otherwise skips. Plugin users shouldn't have to curate a fallback list just to get the feature's headline behavior. Shipping a built-in default topic set makes the plugin useful with zero configuration.

## What Changes

- Add a `BUILTIN_FALLBACK_TOPICS` constant (a small curated, workplace-safe, English list) inside the casual-talk plugin.
- Add a config flag `useBuiltinFallbackTopics: boolean` (default `true`) to `CasualTalkConfig` and its Zod schema (`z.boolean().default(true)` so pre-existing on-disk configs keep parsing).
- **Augment semantics**: when the flag is on, the effective fallback topics fed to the prompt are `dedupe([...BUILTIN_FALLBACK_TOPICS, ...smallTalkTopics])` (built-ins first, then custom, duplicates removed). When the flag is off, the effective list is exactly `smallTalkTopics` — **identical to today's behavior in every cell**.
- Add an admin tool `toggle_builtin_fallback_topics({ enabled: boolean })` on the on-demand management server; idempotent, soft-restarts on change.
- Extend the bulk `set_casual_talk_config` tool's input schema with the new field.
- Add i18n tool-result strings (EN + FR) and a tool-label entry for the new tool.
- **BREAKING (behavioral, opt-out-able):** on upgrade, existing deployments gain the built-in topics by default (flag defaults `true`), so idle channels that were silent will start getting generic openers. Admins restore the prior silence by toggling the flag off.

## Capabilities

### New Capabilities
<!-- none — this extends the existing casual-talk-plugin capability -->

### Modified Capabilities
- `casual-talk-plugin`: the config schema gains `useBuiltinFallbackTopics`; prompt assembly consumes an *effective* topic list (built-ins ∪ custom when enabled) rather than `smallTalkTopics` verbatim; a new management tool toggles the flag; the bulk config-replace tool accepts the field.

## Impact

- **Code:** `src/plugins/casual-talk/` — new `fallbackTopics.ts` (constant + resolver), `types.ts` (config field), `config.ts` (schema + `DEFAULT_CONFIG`), `index.ts` (resolver wired into `buildPrompt`, new tool registered), `tools/toggle.ts` (new tool), `tools/setConfig.ts` (schema field), `i18n/strings.ts` (EN/FR result strings).
- **Tool-label config:** the management tool's display label.
- **Persisted config:** `data/plugins/casual-talk/config.json` gains a field; `.default(true)` makes existing files forward-compatible (field materializes on next save).
- **No core changes**, no new dependencies, no migration system involvement (plugin config handles its own defaults via Zod).
