## Why

Trivia questions — most visibly true/false, but choice and freeform too — too often leak their answer through *surface form* rather than testing knowledge. A statement that is over-specific reads as obviously true; a topical question grabbed from a "who cares" recent event collapses into a coin-flip or a recall test. The generation prompt fights slices of this with scattered micro-rules (`AVOID YEAR/DATE ANCHORING`, the emoji-spoiler gate, the difficulty levers), but there is no single step where Claude reasons about whether the question is a *good puzzle* for its difficulty level. The result is questions players solve by reading the phrasing instead of by knowing the answer.

## What Changes

- Add a shared **PUZZLE QUALITY GATE** — a strong, format-agnostic reasoning step invoked before `save_question` on every generation path (text + visual). Claude must reason explicitly (not box-tick) about five checks: (1) solvable by knowing, not guessing; (2) no surface tell (specificity/length/confidence parity); (3) genuine doubt fits the difficulty bucket; (4) flavor text never leaks the answer; (5) the subject is worth caring about.
- Reframe difficulty as **doubt, not obscurity**: harder means the answer is genuinely ambiguous on the surface and resolvable only by knowledge — not that the question cites a rarer fact or an unverifiable datum.
- **Absorb** the `AVOID YEAR/DATE ANCHORING` block into the gate's "solvable by knowing" check, deleting the boolean-only block and giving choice/freeform the same protection. Net context stays roughly flat — the gate consolidates several scattered rules into one place.
- Constrain **topical** FALSE statements to **substance swaps** (person / place / what-happened / consequence), never a date or raw number — the "Current News" frame already asserts recency and the statement carries no date stamp, so a date swap is both incoherent and a recall-only tell.
- Add a **salience bar** to topical event selection: the event must be one a general audience would plausibly recognize or find interesting; prefer salience over recency; fall back to a fact question (or re-search) when nothing salient surfaces.
- **Reuse** the existing post-time **NO-SPOILER GATE** for flavor leakage (it already covers patter / subtitle / header / closer / emoji / altText) — the gate's "flavor never leaks" check is a brief pointer to it, not new prose. No separate flavor-leak rule is added.

No behavior of stored records, tools, or schemas changes — this is entirely prompt-quality guidance. No `submit_response`/tool contract is touched.

## Capabilities

### New Capabilities

<!-- None — the puzzle-quality gate belongs with its sibling generation gates (difficulty, polarity, emoji) inside the existing trivia-scheduled-prompts capability rather than spawning a thin new spec. -->

### Modified Capabilities

- `trivia-scheduled-prompts`: add the PUZZLE QUALITY GATE requirement invoked before save on every path; reframe the difficulty gate as doubt-not-obscurity; absorb the year/date-anchoring rule into the gate; add a flavor-leak check to the format/post step.
- `trivia-topical-questions`: add a salience bar to topical event selection (relevance over recency, fall back when nothing salient); constrain topical FALSE boolean statements to substance swaps, never date/number, consistent with the "Current News" recency frame.

## Impact

- **Code:** prompt strings in `src/plugins/trivia/prompts/scheduledPrompts.ts` only — new `PUZZLE_QUALITY_GATE` const, one-line references in the six path bodies, edits to `DIFFICULTY_GATE`, `QUESTION_FLOW_STEPS` (remove year-anchoring block), and `TOPICAL_MODIFIER` (salience + substance-swap). The existing NO-SPOILER GATE is reused for flavor leakage (no edit to the format/post section).
- **Tests:** `scheduledPrompts` prompt-content tests asserting gate presence/wording; no logic tests affected.
- **Schemas / tools / data:** none. Stored question records, `save_question`, `get_ideas`, `post_questions`, and reveal flows are unchanged.
- **Specs:** delta to `trivia-scheduled-prompts` and `trivia-topical-questions`.
