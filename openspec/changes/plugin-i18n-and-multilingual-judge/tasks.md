## 1. Plugin SDK i18n

- [x] 1.1 Add `Lang` re-export from `../i18n/languages.js` to `src/plugins/sdk.ts` (type only, for plugin authors). *(Decision: imported `Lang` for internal use only; not re-exported — plugin authors use the concrete `{ en, fr? }` dictionary shape and don't need the `Lang` type.)*
- [x] 1.2 Define `PluginDictionary` shape (`{ en: Record<string, string>; fr?: Record<string, string> }`) and `PluginVars` (`Record<string, string | number>`) types in `src/plugins/sdk.ts`.
- [x] 1.3 Extend `ClackSdk` interface with `registerDictionary(dictionaries: PluginDictionary): void` and `t(key: string, vars?: PluginVars): string`.
- [x] 1.4 In `createClackSdk`, allocate a per-instance `dictionary: PluginDictionary | null = null` and a per-key `fallbackWarned: Set<string>`; implement both methods so dictionary and warnings are scoped to the plugin.
- [x] 1.5 Read active language at lookup time: try `getConfig().language`, default to `"en"` on throw / missing (mirror `src/i18n/t.ts`'s try/catch pattern).
- [x] 1.6 `t()` semantics: throw a descriptive Error if `registerDictionary` was never called; throw if key missing from `en`; resolve from active language's table with EN fallback; log a once-per-(plugin,key) warning on FR→EN fallback via `sdk.logger.warn`.
- [x] 1.7 Interpolation: replace every `{name}` with `String(vars.name)` for each `name` in `vars`. Reuse the same logic as `src/i18n/t.ts`.
- [x] 1.8 Write `src/plugins/sdk.i18n.test.ts` covering: read own dictionary, FR-key-missing falls back to EN with one-time warn, EN default when language unset, variable interpolation, missing-key throws, before-register throws, per-plugin isolation (two SDK instances), last-write-wins on second `registerDictionary` call.

## 2. Trivia plugin: localize the live-roster footer

- [x] 2.1 Create `src/plugins/trivia/i18n/strings.ts` exporting an `en` table (source-of-truth) and `fr` table. Cover every user-facing TS-rendered string in the plugin: roster footer keys, boolean TRUE/FALSE buttons, freeform `Answer` button, and the full freeform modal surface (titles, buttons, input label/placeholder/hint, question header, and four verdict lines). FR values authored by hand.
- [x] 2.2 Create `src/plugins/trivia/i18n/t.ts` indirection (mirror `core/pluginLogger.ts`): module-level singleton initialized by `setTriviaT(sdk.t)` at plugin init, no-op fallback returns the key itself OR resolves against the EN table directly so tests that bypass init still get EN strings.
- [x] 2.3 Wire it up in `src/plugins/trivia/index.ts`: call `sdk.registerDictionary({ en, fr })` from `i18n/strings.ts`, then call `setTriviaT(sdk.t)` before any tool/handler registration so other modules see a live `t`.
- [x] 2.4 Replace the four literal "📝 *Answered:*" / "(no answers yet)" sites in `src/plugins/trivia/freeform/roster.ts` with `t("roster.answered_label")` / `t("roster.no_answers_yet")`.
- [x] 2.5 Update `src/plugins/trivia/freeform/roster.test.ts`: keep the existing EN regex assertions (the test bypasses init, so it gets EN). Add a focused test that calls `setTriviaT` with a stub returning FR values and verifies the rendered context block carries those FR strings end-to-end.
- [x] 2.6 Add `_resetTriviaT()` test helper symmetrical with `_resetTriviaLogger()` and call it in test `afterEach` where needed to keep tests isolated.
- [x] 2.7 Replace literal labels in `src/plugins/trivia/freeform/modal.ts` (titles, buttons, input label/placeholder/hint, question header, four verdict lines) with `t(...)` calls; thread `answer` and `category` through as interpolation variables. *(Existing `modal.test.ts` continues to pass against the EN fallback resolver.)*
- [x] 2.8 Replace literal TRUE/FALSE labels in `src/plugins/trivia/answerTypes/boolean.ts` with `t("button.true")` / `t("button.false")`.
- [x] 2.9 Replace literal `Answer` label in `src/plugins/trivia/answerTypes/freeform.ts` with `t("button.answer")`.

## 3. Trivia plugin: multilingual freeform judge

- [x] 3.1 In `src/plugins/trivia/freeform/judge.ts`, extend `SYSTEM_PROMPT` with one new bullet near the existing leniency rules: ACCEPT an `answerText` that is an unambiguous translation of `expectedAnswer` or any `acceptableAnswers` entry into any natural language (named entities like "Empire romain" ↔ "Roman Empire", common nouns, and direct translations of free-form descriptors). Spell out that this DOES NOT override the multi-guess / too-broad / out-of-tolerance / ambiguous-match rules.
- [x] 3.2 Update `src/plugins/trivia/freeform/judge.test.ts` system-prompt assertions: add `/translation/i` and `/named entit/i` regex checks proving the new rule wording is present; keep all existing assertions (multi-guess, qualifier, DATE FORMS, DATE SPANS) intact.

## 4. Verification

- [x] 4.1 `npx tsc` — type check passes.
- [x] 4.2 `npx oxlint <touched files>` — no lint errors.
- [x] 4.3 `npx oxfmt <touched files>` — formatted.
- [x] 4.4 `npm test` — full suite green (4454 passed, 3 skipped), including the new SDK i18n tests, roster FR assertion, and judge-prompt assertions. Also fixed two pre-existing homeTab.test.ts failures (mock implementations that ignored their argument) and added the missing `capabilities` forward in `sdk.test.ts`'s `makeSdk` helper.
- [x] 4.5 `openspec validate plugin-i18n-and-multilingual-judge --strict` — spec deltas validate.
