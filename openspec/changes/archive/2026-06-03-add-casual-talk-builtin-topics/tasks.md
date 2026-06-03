## 1. Config schema & types

- [x] 1.1 Add `useBuiltinFallbackTopics: boolean` to the `CasualTalkConfig` interface in `src/plugins/casual-talk/types.ts`
- [x] 1.2 Add `useBuiltinFallbackTopics: z.boolean().default(true)` to `casualTalkConfigSchema` in `src/plugins/casual-talk/config.ts`
- [x] 1.3 Add `useBuiltinFallbackTopics: true` to `DEFAULT_CONFIG` in `src/plugins/casual-talk/config.ts`

## 2. Built-in topics constant & resolver

- [x] 2.1 Create `src/plugins/casual-talk/fallbackTopics.ts` exporting `BUILTIN_FALLBACK_TOPICS` (small, curated, workplace-safe, English-only list) and `resolveFallbackTopics(config)` implementing Augment semantics: `enabled ? dedupe([...builtins, ...smallTalkTopics]) : smallTalkTopics` (built-ins first, first-occurrence dedup)
- [x] 2.2 Add `src/plugins/casual-talk/fallbackTopics.test.ts` covering the 2×2: on/empty, on/custom (union + dedup), off/custom (verbatim), off/empty (empty)

## 3. Wire resolver into the prompt

- [x] 3.1 Import `resolveFallbackTopics` in `src/plugins/casual-talk/index.ts` and pass its result as `smallTalkTopics` into `buildPrompt(...)` (replace the verbatim `config.smallTalkTopics`)
- [x] 3.2 Confirm `buildPrompt`/`prompt.test.ts` remain unchanged (resolver handles selection; prompt renders whatever list it gets)

## 4. Toggle tool

- [x] 4.1 Add `createToggleBuiltinFallbackTopicsTool(sdk)` to `src/plugins/casual-talk/tools/toggle.ts` — `toggle_builtin_fallback_topics({ enabled: boolean })`, idempotent (no soft restart when unchanged), soft-restart on change, result via `sdk.t(...)`
- [x] 4.2 Register the tool on the `management` handle in `src/plugins/casual-talk/index.ts` with label `"Toggling built-in fallback topics — {enabled}"`
- [x] 4.3 Add EN + FR result strings (e.g. `builtin_fallback_on`, `builtin_fallback_off`, `builtin_fallback_already_on`, `builtin_fallback_already_off`) to `src/plugins/casual-talk/i18n/strings.ts`

## 5. Bulk config tool

- [x] 5.1 Add `useBuiltinFallbackTopics: z.boolean().optional()` to the input schema of `set_casual_talk_config` in `src/plugins/casual-talk/tools/setConfig.ts` (schema default fills it when omitted)

## 6. Tests & verification

- [x] 6.1 Add a toggle-tool test (on→off triggers restart; on→on is a no-op no-restart) in the plugin's tools test file
- [x] 6.2 Add/extend a config test asserting a pre-existing config lacking the field parses with `useBuiltinFallbackTopics: true`
- [x] 6.3 Add a `set_casual_talk_config` test asserting `useBuiltinFallbackTopics: false` round-trips, and that omission defaults to `true`
- [x] 6.4 Run `npx tsc`, `npx oxlint src/plugins/casual-talk`, `npx oxfmt src/plugins/casual-talk`, and `npm test` — all green
- [x] 6.5 Run `openspec validate add-casual-talk-builtin-topics --strict`
