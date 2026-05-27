## Why

The bot supports a `language` config (`en`/`fr`), but a swath of user-facing text still renders in English when `language: "fr"`. The gaps fall into three modes: strings that never go through `t()`/`sdk.t()` (e.g. DM confirmations, change-workflow notices, trivia validation errors), interpolated literals that were never keyed (`Working on ${branch}`), and "fake translations" where a FR dictionary value is identical to its EN value (e.g. `Auto-Respond`). The last mode is invisible to existing audits because the key *is* wired through `t()` — only the translation content is missing.

## What Changes

- Establish an explicit, spec-level boundary: **every string on the DIRECT-to-Slack path** (rendered to Slack without passing back through Claude's `submit_response`) MUST be localized; **VIA-CLAUDE tool result strings** (`textResult`/`errorResult` envelopes Claude re-renders under the LANGUAGE directive) intentionally stay English.
- Route the leaked core direct-to-Slack strings through `t()`: change-action/DM/config/retry/newQuery handler notices and confirmations, error-report blocks in `messagesApi`, and streaming thinking-card titles (`Working on {branch}`, `Analyzing…`, `Continuing previous stream…`).
- Route the leaked trivia plugin direct-to-Slack strings through `sdk.t()` (freeform validation errors, "Answers are closed", owner cheat-report DM), adding the keys to the plugin's own dictionary.
- Localize the `scheduleReminder` `🔔 Reminder from …` prefix (the one genuine direct-to-user tool string).
- Write real French values for entries currently left as the English term (`Auto-Respond` and any other FR==EN duplicates surfaced by the new guard).
- Add a **translation-completeness guard** to the parity test: fail the build when a FR value equals its EN value, with an explicit allowlist for legitimately-identical entries (brand names, emoji-only, pure `{var}` strings).
- Reframe the i18n rule in `CLAUDE.md` from "tool strings stay English" to the DIRECT-vs-VIA-CLAUDE path distinction.

## Capabilities

### New Capabilities
<!-- None — this extends the existing localization capability. -->

### Modified Capabilities
- `localization`: add a **Direct-to-Slack String Coverage** requirement defining the DIRECT vs VIA-CLAUDE boundary and mandating `t()` (core) / `sdk.t()` (plugins) for the direct path while exempting VIA-CLAUDE tool results; and extend the **Dictionary File Layout and Placeholder Parity** requirement with a translation-completeness check (no FR value may equal its EN value unless allowlisted).

## Impact

- **Code (core):** `src/slack/handlers/{changeThreadActions,changeAction,dmActions,configUpdateAction,retry,newQuery,handlerResponse}.ts`, `src/slack/messagesApi.ts`, `src/streaming/slackStreamer.ts`, `src/tools/actions/scheduleReminder.ts`.
- **Dictionaries:** `src/i18n/strings/en.ts` + `fr.ts` (≈25 new keys; real FR values for `home.auto_respond.*` / `home.workers.auto_respond_label` and any other FR==EN duplicates).
- **Tests:** extend `src/i18n/parity.test.ts` (or sibling) with the FR==EN guard + allowlist.
- **Plugin (trivia):** `src/plugins/trivia/i18n/strings.ts` (+ `fr`), `answerTypes/{freeform,clickHandlerInstaller}.ts`, `tools/answers/saveCheating.ts`.
- **Docs:** `CLAUDE.md` i18n convention rewrite.
- **No behavioral change when `language` is absent or `"en"`** — all new keys resolve to their existing English text.
