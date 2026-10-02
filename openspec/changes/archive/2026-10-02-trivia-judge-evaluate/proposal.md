## Why

The freeform reveal judge only decides whether a typed answer matches the stored answer key. On a riddle ("The more you take from me, the bigger I grow" → `hole`), a player's "Credit/Loan" satisfies the riddle just as well and is rejected as `materially-different`, and no existing lever changes that: `judgeLeniency: "lenient"` only loosens how the text may match the key, and `additionalInstructions` never reaches the judge (it feeds question generation and the reveal post author only). Admins need a judging mode that evaluates an answer on its own merits, plus a way to give the judge their own instructions.

## What Changes

- Add a fourth `judgeLeniency` preset, `"evaluate"`: the expected answer is a reference solution, and the judge accepts any single committed answer that satisfies every clue of the question as stated, whether or not it matches the key.
- `evaluate` questions are judged by a Sonnet-tier model; the other presets keep the Haiku judge.
- Add a `judgeInstructions` cascade axis: admin free text, cumulative across tiers, injected into the freeform judge prompt. Under `evaluate` it can widen or narrow what counts as a fit; under the other presets it refines accepted forms and never overrides the answer key.
- Judge each distinct answer once per question and share the verdict across every player who typed it (all presets).
- An answer accepted off the key carries the verdict reason `alternate-solve`; the reveal payload flags it and the reveal post names it as an accepted alternate.
- Correct the management tool descriptions and the trivia admin instruction: `additionalInstructions` does not reach the judge; `judgeInstructions` and `judgeLeniency` are the judging levers.

## Capabilities

### New Capabilities
- `trivia-judge-instructions`: the `judgeInstructions` cascade axis — tiers, cumulative resolution, reveal-time resolution, injection into the freeform judge prompt, and its management-tool surface.

### Modified Capabilities
- `trivia-judge-leniency`: the preset set grows to four; adds the `evaluate` judging basis, its model, and the `alternate-solve` verdict reason narrated at reveal. Its tier wording is aligned with the six-tier cascade, and `list_seasons` surfaces it.
- `trivia-freeform-questions`: reveal-time judging makes one call per distinct normalized answer (shared verdict), selects the model from the preset, and carries `judgeInstructions` in the prompt.
- `trivia-reveal-processor`: freeform `voters.correct[]` entries carry `alternateSolve: true` for answers accepted off the key.
- `trivia-cascade-registry`: `judgeInstructions` is the 17th `CascadeAxes` member and the fourth custom (cumulative) axis.

## Impact

- `src/plugins/trivia/freeform/judge.ts` (prompt assembly, model selection, grouping by distinct answer) and `freeform/normalize.ts`.
- `src/plugins/trivia/answerTypes/freeform.ts` + `answerTypes/types.ts` (reveal deps carry the resolved judge instructions; voters flag alternates).
- `src/plugins/trivia/core/cascadeAxes.ts`, `core/configTypes.ts`, `core/configParsers/*`, `core/configBridge.ts`, `domain/resolveCascade.ts` (new axis, new preset value).
- `src/plugins/trivia/tools/reveal/computeAnswers.ts` (resolves `judgeInstructions` per question, documents the payload flag), `tools/games/*`, `tools/seasons/*` (write/read surface).
- `src/plugins/trivia/prompts/scheduledPrompts.ts` and the trivia admin instruction (reveal wording for alternates, judging levers).
- `CLAUDE.md` and `.claude/skills/add-trivia-attribute/SKILL.md`.
- Cost: one Sonnet call per distinct non-exact answer on `evaluate` questions only. No migration; records and config without the new values behave exactly as today.
