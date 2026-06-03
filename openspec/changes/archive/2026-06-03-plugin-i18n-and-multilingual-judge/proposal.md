## Why

Plugin code that renders user-facing text directly (not via Claude) has no path to localize today — the bot's `t()` helper lives outside the plugin import boundary. As a result the trivia plugin's live "📝 *Answered:*" footer renders in English even when the workspace is configured for French. Separately, the trivia freeform judge has no instruction to accept correct answers expressed in a different language than the question, which penalizes bilingual players.

## What Changes

- Add plugin-scoped i18n support to the plugin SDK:
  - `sdk.registerDictionary({ en, fr? })` — register a string table; `en` is required and authoritative, other languages partial with EN fallback.
  - `sdk.t(key, vars?)` — look up the active workspace language's translation from THIS plugin's dictionary (auto-scoped by `pluginName`, mirroring `actionId`/`addInstruction`/etc.). Supports `{name}` interpolation.
  - Active language is the same `getConfig().language` source the core `t()` reads from.
- Localize every user-facing TS-rendered string in the trivia plugin via the new SDK methods:
  - The freeform live-roster footer ("Answered" label and "no answers yet" empty-state).
  - The freeform answer modal: titles (active + locked), submit/cancel/close buttons, question header, input label, placeholder, hint, and all four verdict lines (no-submission, awaiting-reveal, correct, incorrect).
  - The boolean question card buttons (`👍 TRUE` / `👎 FALSE`).
  - The freeform question card `Answer` button.
- Update the trivia freeform judge's system prompt: accept correct answers regardless of the language they're typed in. Translations of named entities and direct translations of free-form answers should be treated as a valid form of `expectedAnswer` / `acceptableAnswers`.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `clack-plugins`: Add plugin-scoped i18n SDK surface (`registerDictionary`, `t`) so plugin TS-rendered text can be translated using the workspace's `config.language` without violating the plugin import boundary.
- `trivia-freeform-questions`: Roster footer renders in the configured workspace language; the freeform judge accepts correct answers regardless of the language the user types them in.

## Impact

- `src/plugins/sdk.ts` — new SDK methods + internal per-plugin dictionary store; reads `getConfig().language`.
- `src/plugins/trivia/index.ts` — register the trivia dictionary at plugin init.
- `src/plugins/trivia/i18n/` — new strings module (en + fr) and small `t.ts` indirection (mirrors `core/pluginLogger.ts`).
- `src/plugins/trivia/freeform/roster.ts` — replace 4 literal "Answered" strings with `t(...)`.
- `src/plugins/trivia/freeform/modal.ts` — replace all hard-coded modal labels with `t(...)`.
- `src/plugins/trivia/answerTypes/boolean.ts` — replace TRUE/FALSE button labels.
- `src/plugins/trivia/answerTypes/freeform.ts` — replace the `Answer` button label.
- `src/plugins/trivia/freeform/judge.ts` — extend `SYSTEM_PROMPT` with a cross-language acceptance rule.
- Tests:
  - SDK i18n: unit tests for `registerDictionary` / `t` behavior (per-plugin isolation, FR fallback to EN, interpolation, missing-key error, language read from config).
  - Trivia roster: update existing regexes in `roster.test.ts` to cover the active dictionary; add a FR-language case.
  - Judge: assert system prompt mentions cross-language acceptance.
- No config schema changes. No data migrations. No new dependencies.
