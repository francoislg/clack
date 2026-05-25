## 1. Extend list_seasons

- [x] 1.1 Update `src/plugins/trivia/tools/seasons/listSeasons.ts` to map `theme`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, and `format` from each `SeasonEntry` into the response — each conditionally included via `...(entry.<field> !== undefined ? { <field>: entry.<field> } : {})`.
- [x] 1.2 For `format.questions[i]`, surface per-slot `label`, `categories`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty` with the same "include-only-when-set" rule.
- [x] 1.3 Update the tool's DESCRIPTION string to:
  - List the new fields and their "explicitly set only" semantics
  - Spell out the cascade rule explicitly: `slot → season → workspace → built-in default`
  - Point Claude at `list_games` for the workspace tier

## 2. Extend list_games

- [x] 2.1 Add `questionCron: string` and `revealCron: string` to the per-game entries returned by `src/plugins/trivia/tools/games/listGames.ts`.
- [x] 2.2 Compute a `workspaceDefaults` block at the top level of the response, reading from `getConfigFn().trivia` (via the existing config bridge). Include each of `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `choices`, `seasons`, `offDays` only when explicitly set on `config.trivia`. Wire a `getTriviaConfigFn`-style injection so unit tests can fake the workspace tier without going through the real loader.
- [x] 2.3 Always include `workspaceDefaults` key in the response (possibly `{}`) so callers can distinguish "no overrides" from "we forgot the field".
- [x] 2.4 Update the tool's DESCRIPTION string to:
  - Reverse the existing "crons are NOT surfaced" sentence (now they are)
  - Describe `workspaceDefaults` and the per-axis "explicitly set only" rule
  - Spell out the cascade rule and point Claude at `list_seasons` for the slot + season tiers

## 3. Update get_ideas description

- [x] 3.1 Append one sentence to `src/plugins/trivia/tools/questions/getIdeas.ts` DESCRIPTION pointing at `list_seasons` and `list_games` for cascade audits when admins ask about configuration. Do NOT change the rolled-value contract or any return shapes.

## 4. Tests

- [x] 4.1 Extend `src/plugins/trivia/tools/seasons/listSeasons.test.ts` (or create if absent) with cases for: season with NO axes set; season with `freeformAnswerShape` only; season with `theme` only; season with full `format.questions` including a slot that overrides only one axis; verify absent fields are truly absent (not `undefined` keys).
- [x] 4.2 Extend `src/plugins/trivia/tools/games/listGames.test.ts` (or create if absent) with cases for: empty `config.trivia`, partial workspace defaults, fully-set workspace defaults including `offDays`, and that cron expressions surface per game. Ensure `workspaceDefaults` key is present (possibly `{}`) on every response.

## 5. Verification

- [x] 5.1 `npx tsc --noEmit` — clean
- [x] 5.2 `npm test` — full suite passes (no regressions in other trivia tools)
- [x] 5.3 `npx oxlint src/` — 0 warnings, 0 errors
- [x] 5.4 `npx oxfmt --check src/` — clean
- [x] 5.5 `openspec validate surface-trivia-axis-config --strict` — valid

## 6. Documentation

- [x] 6.1 Verify CLAUDE.md's trivia section is still accurate — the new fields don't change the model, just the read-side surface. Update only if a referenced shape changed.
