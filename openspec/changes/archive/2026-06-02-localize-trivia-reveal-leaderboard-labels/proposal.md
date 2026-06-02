## Why

In a French-configured workspace the trivia reveal leaderboard renders its row labels — `This Round`, `Current Season`, `All Time` — in English, and the season-finale podium shows `First place` / `Second place` / `Third place` in English too. These labels live in the reveal prompt as fixed English literals that Claude is told to place verbatim into Slack `table` cells / podium lines. Claude faithfully copies the dictated token, so it never gets translated — the LANGUAGE directive only re-renders free prose, not a "use this exact string" instruction. The labels are effectively direct-to-Slack strings in disguise, and the project convention for that path is `sdk.t()`, not "let Claude translate." Today the code-rendered reveal-card footer/modal already localize via `sdk.t()`; the Claude-authored leaderboard labels should share that same dictionary.

## What Changes

- The reveal prompt localizes its structural label tokens through the trivia i18n dictionary instead of hardcoding English. `PROCESS_REVEAL_INSTRUCTIONS` becomes `buildProcessRevealInstructions()`, a function whose labels resolve via the plugin's module-level translator (`t`, wired to `sdk.t` at init). In a FR workspace the built prompt literally contains `Saison en cours` and Claude copies that verbatim — turning the current failure mode (verbatim copy) into the delivery mechanism.
- New dictionary keys (en + fr) for: `This Round`, `Current Season`, `All Time`, `First place`, `Second place`, `Third place`, and the `Participation` tail label. The worked table/podium examples in the prompt are localized from the same keys so Claude can't anchor on English examples.
- Free prose around the labels (closers, transitions, per-question verdicts, the all-time-table intro line) keeps relying on the LANGUAGE directive — only the fixed structural labels are pre-localized.
- `buildGameSpecs` calls the new builder; because the prompt uses the module-level translator (already wired before `buildGameSpecs` runs), no signature change and no `index.ts` change are needed.
- No behavioral change for English workspaces — the English dictionary values equal today's literals, so English output is byte-stable. No data, config, or migration impact.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-scheduled-prompts`: the "Reveal table leads with This Round" requirement currently mandates the label cell hold the literal text `"This Round"`; it changes to require the reveal prompt localize its leaderboard row-label cells (`This Round`, `Current Season`, `All Time`, seasons-off labels) through the trivia i18n dictionary, so the built prompt carries the configured language's label and Claude copies it verbatim.
- `trivia-seasons`: the "Season-finale reveal layout" requirement currently dictates literal English podium labels (`🥇 First place`, etc.) and participation-tail label; it changes to require those labels be sourced from the trivia i18n dictionary, localized by configured language (medals, `String(...)` values, and free-prose transition/closer lines unchanged).

## Impact

- `src/plugins/trivia/prompts/scheduledPrompts.ts` — `PROCESS_REVEAL_INSTRUCTIONS` becomes the `buildProcessRevealInstructions()` builder; LEADERBOARD TABLE labels, examples, and SEASON FINALE LAYOUT labels resolve via the dictionary (module-level `t`).
- `src/plugins/trivia/domain/buildGameSpecs.ts` — calls `buildProcessRevealInstructions()` instead of the removed const (no signature change).
- `src/plugins/trivia/i18n/strings.ts` — new en/fr keys for the labels.
- `openspec/specs/trivia-scheduled-prompts/spec.md` and `openspec/specs/trivia-seasons/spec.md` — requirement text that pins the literal labels.
- Tests: prompt-builder tests asserting FR/EN label substitution. No source-code path outside trivia, no data/config/migration impact. English-workspace output is unchanged.
