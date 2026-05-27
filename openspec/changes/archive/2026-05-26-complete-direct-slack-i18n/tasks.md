## 1. Core dictionary keys

- [x] 1.1 Add EN keys to `src/i18n/strings/en.ts` for the handler/messagesApi/streaming strings in groups 2–4 below (suggested prefixes: `changes.*`, `dm.*`, `errors.*`, `streamer.*`); set each EN value to the current English literal
- [x] 1.2 Add matching FR keys to `src/i18n/strings/fr.ts` with real French translations (keep `{var}` tokens identical to EN)

## 2. Core handlers → `t()`

- [x] 2.1 `src/slack/handlers/configUpdateAction.ts:50,75` — permission-denied + expired notices via `t()`
- [x] 2.2 `src/slack/handlers/changeThreadActions.ts:163,188,200` — permission-denied, expired, "No active change found" notices via `t()`
- [x] 2.3 `src/slack/handlers/dmActions.ts` — session-expired (91,415), "Failed to post" (343), modal title/buttons/label "Edit before sharing"/"Share"/"Cancel"/"Answer" (428–441), and confirmations "Answer shared."/"Answer posted…"/"Original post updated."/"New reply posted…"/"Edited answer posted…"/"Got it, discarded." (333,392,496,516,556,599) via `t()`
- [x] 2.4 `src/slack/handlers/newQuery.ts:171` — "couldn't read the message" notice via `t()`
- [x] 2.5 `src/slack/handlers/retry.ts:40` — session-expired notice via `t()`
- [x] 2.6 `src/slack/handlers/handlerResponse.ts:461` — "Response ready! Need anything else?" via `t()`

## 3. messagesApi error-report blocks → `t()`

- [x] 3.1 `src/slack/messagesApi.ts:184,192,226` — error-report header, body, and plain-text fallback via `t()`

## 4. Streaming thinking-card titles (Mode C interpolation + Mode A)

- [x] 4.1 `src/slack/handlers/changeAction.ts:127` and `src/slack/handlers/changeThreadActions.ts:108` — replace `` `Working on ${branch}` `` with `t("streamer.working_on", { branch })`
- [x] 4.2 `src/streaming/slackStreamer.ts:109` — default thinking title `"Analyzing…"` via `t()`
- [x] 4.3 `src/streaming/slackStreamer.ts:70` — `"Continuing previous stream…"` continuation title via `t()`

## 5. Genuine direct-to-user tool string

- [x] 5.1 `src/tools/actions/scheduleReminder.ts:58` — localize the `🔔 Reminder from <@{user}>:` prefix via `t()` (keep the user mention interpolation); leave all `errorResult`/`textResult` strings English

## 6. Trivia plugin direct-to-Slack strings → `sdk.t()`

- [x] 6.1 Add EN+FR entries to `src/plugins/trivia/i18n/strings.ts` for the four strings below (plus the owner cheat-report DM)
- [x] 6.2 `src/plugins/trivia/answerTypes/clickHandlerInstaller.ts:134` — "Answers are closed for this round." via the plugin's `t()`/`sdk.t()`
- [x] 6.3 `src/plugins/trivia/answerTypes/freeform.ts:440,451,459` — "Type an answer before submitting." / "This question no longer exists." / "Answers are now closed for this question." via the plugin's `t()`/`sdk.t()`
- [x] 6.4 `src/plugins/trivia/tools/answers/saveCheating.ts:94` — owner cheat-report DM "🚨 Trivia cheat report" via the plugin's `t()`/`sdk.t()`

## 7. Mode B — fake translations (FR == EN)

- [x] 7.1 One-time scan: list every key where `fr[k] === en[k]` (script or quick test) and review each
- [x] 7.2 Write real FR values for `home.auto_respond.header`, `home.workers.auto_respond_label`, and any other reviewed non-allowlist duplicates (e.g. `Auto-Respond` → idiomatic French aligned with existing `home.auto_respond.*` body terminology)
- [x] 7.3 Build the `IDENTICAL_OK` allowlist from the scan: include only legitimate identicals (brand/proper names, emoji-only, pure-`{var}` values)

## 8. Mode B guard in parity test

- [x] 8.1 Extend the parity test (`src/i18n/parity.test.ts` or sibling) to fail when `fr[k] === en[k]` and `k` is not in `IDENTICAL_OK`
- [x] 8.2 Add the two new parity scenarios: FR==EN non-allowlisted fails; allowlisted identical passes

## 9. Docs

- [x] 9.1 Rewrite the i18n rule in `CLAUDE.md` (and `src/plugins/CLAUDE.md` if it restates it) from "tool strings stay English" to the DIRECT-to-Slack vs VIA-CLAUDE path distinction; note `sdk.t()` for the plugin direct path

## 10. Verification

- [x] 10.1 `npx tsc` clean (typed keys catch misspellings/missing vars)
- [x] 10.2 `npm test` green, including the extended parity test (key, placeholder, and FR==EN checks)
- [ ] 10.3 Manual smoke with `language: "fr"`: confirm a change-workflow thinking card shows the translated "Working on …", an `Auto-Respond` Home Tab label is French, and a trivia freeform validation error is French — REQUIRES a live French Slack workspace; cannot be run in this environment (user to verify post-deploy)
- [x] 10.4 Confirm EN-mode output is unchanged (no key resolves differently when `language` is absent/`"en"`)
- [x] 10.5 `openspec validate complete-direct-slack-i18n --strict` passes
