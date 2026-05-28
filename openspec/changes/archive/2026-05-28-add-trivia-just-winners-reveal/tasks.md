## 1. Type + enum plumbing

- [x] 1.1 Add `"just-winners"` to `RevealResponsesMode` in `core/configTypes.ts` and update the doc comment to describe the new rung
- [x] 1.2 Add `"just-winners"` to `REVEAL_RESPONSES_VALUES` in `core/configParsers/axes.ts`
- [x] 1.3 Add the new variant to the `VoterBuckets` union in `tools/reveal/types.ts`: `{ revealResponses: "just-winners"; correct: Voter[]; incorrectCount: number; noAnswerCount: number; reactions: ReactorEntry[] }`

## 2. Bucket assembly (the behavior)

- [x] 2.1 `answerTypes/boolean.ts`: add the `just-winners` branch in `assembleBooleanVoters` — populate `correct`, tally `incorrectCount` + `noAnswerCount`, keep `reactions`
- [x] 2.2 `answerTypes/choice.ts`: add the matching `just-winners` branch in its assemble function
- [x] 2.3 `answerTypes/freeform.ts`: add the `just-winners` branch — correct voters KEEP `answerText`, missers reduced to counts (never their text)
- [x] 2.4 `tools/reveal/roundSummary.ts`: skip the `just-winners` variant in the per-bucket loop (no `incorrect`/`noAnswer` arrays to read)
- [x] 2.5 `tools/reveal/processRevealAnswers.ts`: update the tool-description text from three variants to four (the `allYes` gate already excludes non-`"yes"`)

## 3. Rendering

- [x] 3.1 `prompts/scheduledPrompts.ts`: extend the payload `voters` description with the `just-winners` variant
- [x] 3.2 `prompts/scheduledPrompts.ts`: add the `just-winners` branch to the SINGLE-question layout — name `correct`, render anonymous miss line from counts, "everyone missed it" when `correct` empty, keep reactions, forbid naming missers
- [x] 3.3 `prompts/scheduledPrompts.ts`: add the `just-winners` branch to the MULTI-question layout teaser, sharing the `roundSummary`-absent / no-"This Round"-row gate

## 4. Config surfaces

- [x] 4.1 `tools/games/upsertGame.ts` + `setWorkspaceConfig.ts`: confirm the value validates (shared enum) and update any human-facing description strings
- [x] 4.2 `tools/seasons/upsertSeason.ts`: same — accept `"just-winners"` and update description text
- [x] 4.3 `tools/games/listGames.ts` + `tools/seasons/listSeasons.ts`: confirm the value surfaces (per-game / workspace / season / slot)
- [x] 4.4 `core/configParsers/{format,games}.ts`: confirm slot/game parsers accept the value via the shared enum

## 5. Tests

- [x] 5.1 `answerTypes/*.test.ts` (boolean, choice, freeform): add `just-winners` cases — winners named, miss counts correct, missers absent, freeform winner keeps answerText
- [x] 5.2 `processRevealAnswers.test.ts`: add a `just-winners` end-to-end case incl. the "everyone missed" (empty `correct`, positive `incorrectCount`) case and the `roundSummary`-omitted assertion
- [x] 5.3 `roundSummary.test.ts`: regression — a batch containing a `just-winners` entry does not crash and omits the summary
- [x] 5.4 axes parser test: `"just-winners"` parses; an invalid value still rejects

## 6. Verification

- [x] 6.1 `tsc --noEmit` clean (union exhaustiveness across the three handlers, renderer references)
- [x] 6.2 `npx oxlint` + `npx oxfmt --check` clean on touched files
- [x] 6.3 `npm test` — just-winners suites green (4 unrelated failures belong to the in-progress hint feature)
- [x] 6.4 `openspec validate add-trivia-just-winners-reveal --strict` passes
