## 1. Shared puzzle-quality gate

- [x] 1.1 Add a `PUZZLE_QUALITY_GATE` const in `src/plugins/trivia/prompts/scheduledPrompts.ts`, alongside the other shared gates, with the five reasoning checks. The gate MUST instruct Claude to reason explicitly about each check (not merely assert "pass") — the goal is to prevent rubber-stamping and force genuine metacognition — and that re-rolling beats shipping a question that can't be fixed. Kept terse. (Covers design D1 + D2; also covers flavor-leak phase 1 — generation-controlled fields statement/hint/emojis/altText — via check 4.)
- [x] 1.2 Reference the gate (`apply the PUZZLE QUALITY GATE`) immediately before the SAVE step in each of the six path bodies: `QUESTION_FLOW_STEPS` (boolean), `CHOICE_FLOW_STEPS`, `FREEFORM_FACT_FLOW_STEPS`, `VISUAL_BOOLEAN_FLOW_STEPS`, `VISUAL_CHOICE_FLOW_STEPS`, `VISUAL_FREEFORM_FLOW_STEPS`.
- [x] 1.3 Render the gate definition into the `SHARED GATES` block of `PER_SLOT_GENERATION_PATHS` so it is defined exactly once.

## 2. Absorb year/date anchoring + difficulty-as-doubt

- [x] 2.1 Remove the boolean-only `AVOID YEAR/DATE ANCHORING` block from `QUESTION_FLOW_STEPS` step 2; fold its principle into puzzle-gate check 1 (retain one worked example inside the gate).
- [x] 2.2 Reframe the `DIFFICULTY_GATE` boolean reframe levers to dial difficulty by adjusting statement plausibility (more recognizable/plausible for easier, more subtle/ambiguous-either-way for harder) — never by selecting a more obscure fact. Leave the `[min,max]` strict-membership mechanics untouched.

## 3. Topical fixes

- [x] 3.1 In `TOPICAL_MODIFIER`, rewrite the boolean FALSE lever to swap the event's substance (person/place/what-happened/consequence), never a date or raw number; cite the recency frame.
- [x] 3.2 Add the salience bar to the `TOPICAL_MODIFIER` event-selection step (relevance over recency) and the fallback to the fact path / re-roll when nothing salient surfaces.

## 4. Flavor-leak (reuse existing NO-SPOILER GATE)

- [x] 4.1 Do NOT add new flavor-leak prose: the existing post-time `NO-SPOILER GATE` (`scheduledPrompts.ts` step 9, ~line 565) already covers patter/header/title/subtitle/closer/emoji/altText leakage with a self-check. Make puzzle-gate check 4 a brief pointer that references the NO-SPOILER GATE rather than restating it. Verify no second body of flavor-leak prose is introduced.

## 5. Tests & verification

- [x] 5.1 Update/add prompt-content tests in `src/plugins/trivia/prompts/scheduledPrompts.test.ts` (and `scheduledPrompts.choice.test.ts` / `scheduledPrompts.visual.test.ts` as relevant) asserting: PUZZLE QUALITY GATE defined exactly once and referenced before save in all six path bodies — (1) `QUESTION_FLOW_STEPS`, (2) `CHOICE_FLOW_STEPS`, (3) `FREEFORM_FACT_FLOW_STEPS`, (4) `VISUAL_BOOLEAN_FLOW_STEPS`, (5) `VISUAL_CHOICE_FLOW_STEPS`, (6) `VISUAL_FREEFORM_FLOW_STEPS`; difficulty levers target doubt not obscurity; topical substance-swap-not-date; salience-over-recency preference; check 4 references the NO-SPOILER GATE (no duplicate flavor prose); `AVOID YEAR/DATE ANCHORING` block removed and its principle present in the gate with a worked example.
- [x] 5.2 Run `npx tsc` (no template breakage) and the trivia test suites (`scheduledPrompts`, cascade-parity) — all green.
- [x] 5.3 Diff rendered prompt length before/after to confirm net context stays roughly flat; trim if it grew materially.
- [x] 5.4 Run `npx oxlint` + `npx oxfmt --check` on the touched file.

## 6. Spec sync & archive

- [x] 6.1 After implementation, sync the delta specs into `openspec/specs/` and archive the change (`/opsx:archive`), bundling spec deltas + code in one commit.
