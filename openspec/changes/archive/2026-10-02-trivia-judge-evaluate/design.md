## Context

The freeform judge (`src/plugins/trivia/freeform/judge.ts`) is a standalone single-turn `askClaude` call per submission, on Haiku. Its system prompt is `SHARED_RULES` + a matching-forgiveness block selected by the question's stamped `judgeLeniency` + a shape block + output rules. The user message carries the statement, expected answer, acceptable variants, `gradingNotes`, and the typed answer. An exact normalized match short-circuits without a model call.

Two facts shape this change:

- `SHARED_RULES` hard-codes key matching ("REJECT when it is materially different", "Notes never override the expected answer"), so no free text placed beside it can make the judge accept an off-key answer.
- `additionalInstructions` is resolved in `get_ideas` and in the `process_reveal_answers` payload. It never reaches the judge.

`judgeLeniency` is stamped at `save_question` and re-stamped from the live cascade by `compute_answers` reprocess mode, which then re-judges every retained answer. `instructions` / `additionalInstructions` are resolved at reveal from the question's stamped season, slot, and phase.

## Goals / Non-Goals

**Goals:**
- A judging mode that accepts a correct answer outside the answer key.
- An admin-authored instruction channel that actually reaches the judge.
- Same answer, same verdict within a question.
- Players can see when an off-key answer was accepted.

**Non-Goals:**
- Generation-time enumeration of alternate solves.
- A new re-judge tool (reprocess mode already covers it).
- Changes to boolean/choice questions, scoring, or the deterministic reveal cards.
- Batching several answers into one judge call.

## Decisions

### D1 — `evaluate` is a fourth `judgeLeniency` value, and the preset selects the judging basis

`SHARED_RULES` splits into two parts: universal integrity rules (case/punctuation insensitivity, qualifiers allowed, multi-guess rejection, too-broad rejection) and a **judging basis** block. The preset picks the basis as well as the forgiveness fragments:

- `strict` / `strict-with-typos` / `lenient` → the key-match basis: today's text, unchanged.
- `evaluate` → the evaluate basis: the expected answer is a reference solution. Accept when the answer matches the key (judged with the `lenient` knows-it rule), OR when the single committed answer independently satisfies **every** clue of the question as stated. Reject when any clue fails, when the fit depends on a stretch, or when the answer is a category rather than an answer.

Under `evaluate` the multi-guess rule carries one clarification: near-synonyms naming one idea ("Credit/Loan") are one answer; two distinct ideas ("hole or debt") are a hedge.

Alternative considered: a separate boolean axis (`evaluateAnswers`). Rejected: it would compose with three text-matching presets into six combinations nobody needs, and the existing axis already has the cascade, stamping, reprocess re-stamp, and tool surface.

### D2 — Model follows the preset

`evaluate` uses a Sonnet-tier model constant; the other presets keep `DEFAULT_JUDGE_MODEL` (Haiku). Fit-the-clues is reasoning, and the exact-match short-circuit plus D4 keep the call count low.

Alternative considered: a configurable judge model axis. Rejected as unneeded configurability.

### D3 — `judgeInstructions` is a cumulative `CascadeAxes` member, resolved at reveal

A new axis sharing `additionalInstructions`' shape: optional string per tier, concatenated across tiers with tier labels, same validator bounds. It is a custom-resolver member of `AXIS_REGISTRY`; the cumulative concat is shared with `additionalInstructions` rather than duplicated.

It is **not stamped**. `compute_answers` resolves it per question, inside the per-question loop, from a cascade context built from that question's own stamped season, slot index, and phase — the `buildCascadeContext(cascadeSeasonFor(question), gameEntry, question.slot?.index ?? null, triviaConfig, { slug: question.phase })` call that reprocess re-stamping already makes, run in default mode too. It is handed to the freeform handler on that question's `ProcessRevealDeps`. The batch-level context used for `instructions` / `additionalInstructions` is anchored on the first target and is not suitable: one batch holds questions from several slots, and a slot-tier value must apply to its own slot only. An admin edit therefore reaches posted-but-unrevealed questions and any reprocess.

Alternative considered: stamping the text at `save_question`. Rejected: it copies a paragraph onto every record and blocks the common case of fixing instructions before the reveal.

Alternative considered: routing `additionalInstructions` into the judge. Rejected: that text is written for the question author (category rotation, length limits) and would be noise, or worse, for the judge.

### D4 — One judge call per distinct answer

`judgeSubmissions` groups submissions by normalized answer text (the normalization `isExactMatch` already uses), judges one representative per group, and fans the verdict out. A group whose retries are exhausted fans out `null` (rows stay pending). Applies to every preset.

### D5 — Authority of `judgeInstructions` depends on the preset

The instructions go in the user message under a labeled heading. The system prompt states their authority:

- `evaluate`: they may widen or narrow what counts as a fit.
- other presets: they refine accepted forms, like `gradingNotes`, and never override the expected answer.

Under every preset they cannot disable the integrity rules or the output format.

### D6 — `alternate-solve` reason, surfaced at reveal

Output rules allow a `reason` on a correct verdict for one label, `alternate-solve`, emitted when an `evaluate` answer is accepted off the key. `judgeReason` already persists on the answer row. The freeform reveal projection flags those correct voters (`alternateSolve: true`) and the reveal prompt tells Claude to name accepted alternates. The deterministic reveal cards are untouched.

### D7 — Reprocess needs no new code path

Reprocess already re-stamps `judgeLeniency` and re-judges. After this change it also re-resolves `judgeInstructions` because that axis is resolved at every reveal. Already-revealed questions are corrected by setting the tier value and running `compute_answers` with `reprocessQuestionIds`.

## Risks / Trade-offs

- [Over-acceptance: the judge accepts a loose fit] → the "every clue, no stretch" bar in the evaluate basis, a stronger model, and judge tests pinning both a valid alternate ("Credit/Loan" for the hole riddle) and a near-miss ("Life insurance" for the coffin riddle).
- [Verdict varies between runs on a borderline answer] → D4 removes variance within a question; a reprocess can still flip a borderline answer, and `override_answer` rows stay admin-authoritative.
- [`evaluate` on a single-valued fact question] → the fit test collapses to the key (only one value satisfies the question); harmless, but costs a Sonnet call per distinct wrong answer.
- [Admin instructions that contradict the key under a non-evaluate preset] → D5 states they cannot override it; the tool description says to switch to `evaluate` for that.
- [Posted-but-unrevealed questions keep their stamped preset] → reveal, then reprocess; documented in the admin instruction.

## Migration Plan

No data migration. Absent `judgeInstructions` and the three existing presets behave exactly as today. Rollback is reverting the commit; a record stamped `judgeLeniency: "evaluate"` would then fail the enum, so on rollback set affected tiers back to `lenient` and reprocess, or keep the enum value accepted.
