## 1. Foundation: helper, dictionaries, config

- [x] 1.1 Create `src/i18n/languages.ts` exporting the `Lang` type and the language metadata registry (`{ en: { native: "English", english: "English" }, fr: { native: "Français", english: "French" } }`).
- [x] 1.2 Create `src/i18n/strings/en.ts` with an `as const` object literal exporting `en = { ... }`. Start empty (single placeholder key) — populated incrementally per migration group.
- [x] 1.3 Create `src/i18n/strings/fr.ts` typed as `Record<keyof typeof en, string>` and import the type. Start empty (same single placeholder key) — populated in section 6.
- [x] 1.4 Create `src/i18n/t.ts` implementing `t<K>(key, ...args)` with template-literal-typed `Vars<S>` and `Args<S>` helpers; resolve language via `getConfig().language ?? "en"`; fall back to `en[key]` on missing FR; log a dev-mode warning at most once per key via a Set.
- [x] 1.5 Add `t.test.ts` covering: no-placeholder lookup, single placeholder, multiple placeholders, numeric coercion, missing-FR fallback to EN, pre-config-load tolerance.
- [x] 1.6 Add `parity.test.ts` walking every non-EN dictionary and asserting (a) identical key sets vs `en` and (b) identical `{var}` placeholder token sets per key. Use a regex to extract placeholder tokens from each string.
- [x] 1.7 Add the `language?: "en" | "fr"` field to the config schema in `src/config.ts`. Validate value is in the supported set; on invalid code, fail load with a descriptive error listing the supported codes. Default behavior when absent is `"en"`.
- [x] 1.8 Add a config-loader test for: absent field → effective `"en"`; `"en"` → unchanged; `"fr"` → accepted; invalid code → load fails with descriptive error.
- [x] 1.9 Type-check the whole project (`npx tsc`) and run the full test suite (`npm test`). All existing tests must pass with no production behavior change (since `en.ts` and `fr.ts` are empty placeholders, no call sites have flipped yet).

## 2. Language directive in prompt composition

- [x] 2.1 In `src/claude/promptBuilder.ts`, introduce a `renderLanguageDirective(lang)` helper that returns `""` when `lang === "en"` and the rendered directive template (using the registry's English + native names) otherwise. The directive template lives in this file as a single string with `{NATIVE_NAME}` and `{EN_NAME}` placeholders.
- [x] 2.2 Modify `buildSystemPrompt` to call `renderLanguageDirective(getConfig().language ?? "en")` and prepend it at the very top of the assembled prompt (before any role-cascaded content). When the directive is empty, the prompt output must be byte-identical to the pre-change output (no extra blank lines, separators, or marker comments).
- [x] 2.3 Identify the pre-analysis prompt assembly path (rule evaluation / intent triage) and confirm it does NOT call `buildSystemPrompt`. If it shares any subroutine, ensure the directive injection is gated to the user-facing path only. Add a test asserting the pre-analysis prompt does NOT contain any language-directive markers when `language === "fr"`.
- [x] 2.4 Add prompt-builder tests: language `"en"` (or absent) produces byte-identical output to current snapshot; language `"fr"` produces output containing the directive with both "French" and "Français" in the rendered text; the directive sits at the very top of the assembled prompt (before any role-cascaded content).
- [x] 2.5 Verify directive presence on representative paths through integration tests or focused unit assertions: Q&A path, change-workflow worker path, scheduled-run path, plugin-triggered path. (No need to add new e2e tests if existing prompt-assembly tests already cover these paths — extend them with a `language: "fr"` variant.)
- [x] 2.6 `npx tsc && npm test` — full green.

## 3. Migrate Home Tab strings to t()

- [x] 3.1 Walk `src/slack/homeTab.ts` top to bottom; for every literal `text:` field, `label:` field, `placeholder:` field, hint string, button label, option label, modal title, and empty-state message, define a corresponding key in `src/i18n/strings/en.ts` (namespace prefix `home.*`) and replace the literal with a `t(...)` call. Use the same key for repeated identical strings.
- [x] 3.2 For Home Tab strings with dynamic values (e.g. "Welcome, {name}", "X repositories"), include the `{var}` placeholder in the EN entry and update the `t(key, vars)` call site accordingly.
- [x] 3.3 Keep dynamic identifiers (repo names, channel mentions, user mentions, plugin names, file paths, ISO timestamps) outside the dictionary — interpolate them via placeholders, never as dictionary lookups.
- [x] 3.4 Update Home Tab snapshot tests as needed (EN output should still match; if any test diffs reveal a string drift, restore the original wording in the dictionary value rather than changing the test expectation).
- [x] 3.5 `npx tsc && npm test` — full green. Existing Home Tab behavior must be byte-identical to pre-change for `language === "en"`.

## 4. Migrate Block Kit modal and shared block strings to t()

- [x] 4.1 Walk `src/slack/blocks.ts` and any other shared block builders (`src/slack/messageBuilder.ts`, `src/slack/blockPrepare.ts`, `src/slack/pluginActionRegistry.ts` if applicable). Replace user-visible literal strings with `t(...)` calls under appropriate namespaces (`blocks.*`, `actions.*`).
- [x] 4.2 Walk `src/slack/dmResponse.ts` (DM-first reaction flow). Replace literal strings with `t(...)` under `dm.*` namespace.
- [x] 4.3 Walk stop-emoji confirmation and reaction-trigger ephemeral messages (`src/slack/stopEmoji.ts`, `src/slack/stopPipeline.ts`, `src/slack/messageReactions.ts` if any user-facing strings). Replace under `stop.*` namespace.
- [x] 4.4 Update related tests; ensure EN output is unchanged.
- [x] 4.5 `npx tsc && npm test` — full green.

## 5. Migrate change-workflow, error-reporting, and assistant strings to t()

- [x] 5.1 Walk `src/changes/` for bot-authored user-visible strings (initial "Setting up workspace…" message in `workflow.ts`, cancellation confirmations, externally-merged / externally-closed notifications in `monitor.ts`, quarantine DM framing in `workers/quarantineNotifier.ts`, Active Workers Home Tab labels). Replace with `t(...)` under `changes.*` namespace.
- [x] 5.2 Walk `src/slack/handlers/` and `src/slack/handlers/core.ts` for bot-authored error toasts, permission-denied messages, validation-rejection messages, "Try Again" button labels. Replace with `t(...)` under `errors.*` namespace.
- [x] 5.3 Walk the migration-failure admin DM path (likely in `src/migrations/` or `src/slack/`) and replace bot-authored framing strings with `t(...)`; keep raw error / stack trace pass-through unchanged.
- [x] 5.4 Walk `src/slack/app.ts` (Assistant registration) — replace `setSuggestedPrompts` literals, `setStatus` literals, fallback `setTitle` literals, and "Send to thread" button label with `t(...)` under `assistant.*` namespace.
- [x] 5.5 Confirm `buildDeliveryContext` produces byte-identical output regardless of configured language — the language directive must be carried by `buildSystemPrompt`, not duplicated here. Add a focused test asserting EN and FR config produce the same delivery-context string for the same session state.
- [x] 5.6 Audit pass: grep `src/slack/`, `src/changes/`, and `src/migrations/` for remaining `text:` and `label:` fields with literal string values. Migrate anything user-visible that was missed. Internal logger calls and developer-facing console messages stay English.
- [x] 5.7 Update tests touched by these migrations; ensure EN output is unchanged.
- [x] 5.8 `npx tsc && npm test` — full green.

## 6. Populate French translations

- [x] 6.1 Translate every key in `src/i18n/strings/en.ts` into `src/i18n/strings/fr.ts`. Maintain `{var}` placeholder names exactly. Write idiomatic French — favor concise, natural phrasing over literal translation.
- [x] 6.2 Confirm `parity.test.ts` passes — every EN key has an FR entry, and placeholder tokens match per key.
- [x] 6.3 Translate any embedded examples in instruction prompts that are likely to leak English style into Claude's French output. Specifically audit (read-only, decide whether to touch): `data/default_configuration/user/response-style.md`, `data/default_configuration/user/personality.md`, and any plugin prompt builder with verbatim example phrasings (`src/plugins/trivia/prompts/scheduledPrompts.ts`). Do not translate the prompts themselves — translate only inline example fragments. Scope: minimal and high-value only.
- [x] 6.4 `npx tsc && npm test` — full green.

## 7. Manual smoke test

- [ ] 7.1 In a dev `data/config.json`, set `"language": "fr"`. Launch `npm run dev`. Open Slack.
- [ ] 7.2 Open the Home Tab — confirm sections, buttons, modals render in French. Capture any English string that slips through; add to dictionary; rerun.
- [ ] 7.3 Trigger a Q&A run (mention, DM, or reaction) and confirm Claude responds in French.
- [ ] 7.4 If the workspace has the Changes Workflow enabled, request a small change and confirm: initial status message in French, Claude's `report_status` messages in French, PR description prose in French.
- [ ] 7.5 If trivia is configured for the workspace, watch a scheduled trivia post and confirm question content is in French. (If quality is poor, document as follow-up — out of scope to fix in this change.)
- [ ] 7.6 Trigger an error path (e.g. invalid command) and confirm the bot-authored error framing is in French.
- [ ] 7.7 Reset `language` back to `"en"` or remove the field; confirm UI flips back to English and no FR strings leak.

## 8. Wrap-up

- [x] 8.1 Run `npx oxlint` and `npx oxfmt` on all touched files. Re-stage if oxfmt makes changes.
- [x] 8.2 `npx tsc && npm test` — full green.
- [x] 8.3 Update `CLAUDE.md` only if a new convention or invariant emerged (e.g. "all new user-facing strings go through `t()`"). Do not pad docs unnecessarily.
- [x] 8.4 Run `openspec validate add-localization --strict` and resolve any reported issues.
- [x] 8.5 Ready for review.
