## Context

Question generation lives entirely in `src/plugins/trivia/prompts/scheduledPrompts.ts`. The substantive guidance is factored into a set of **shared gates** (`DUPLICATE_CHECK_GATE`, `DIFFICULTY_GATE`, `STATEMENT_CHOICES_NON_OVERLAP_GATE`, `HINT_DRAFTING_GATE`, `EMOJI_SELECTION_GATE`) that are defined once and referenced from each of the six per-slot **path bodies** (text/visual × boolean/choice/freeform) via "apply the X GATE". The `TOPICAL_MODIFIER` layers on top of any path body when `questionType === "topical"`. The same `PER_SLOT_GENERATION_PATHS` block is shared verbatim by PREP and POST prompts.

Several anti-tell concerns are currently scattered: `AVOID YEAR/DATE ANCHORING` lives only inside the boolean path body (`QUESTION_FLOW_STEPS`); the difficulty levers in `DIFFICULTY_GATE` express difficulty as *obscurity*; the topical FALSE-statement lever tells Claude to "swap a date … or a number" — directly contradicting the year/date-anchoring rule and the "Current News" frame; topical event selection filters only on recency, not audience relevance. There is no single step where Claude evaluates whether the question is a good *puzzle* for its difficulty.

## Goals / Non-Goals

**Goals:**
- One shared, format-agnostic reasoning gate that forces Claude to judge puzzle quality before saving.
- Reframe difficulty as *doubt resolvable by knowledge*, not obscurity/recall — across all formats.
- Make topical questions reason-solvable: salient events, substance-based falsity, never date/number tells.
- Keep net prompt context roughly flat by absorbing/compressing the rules the gate subsumes.

**Non-Goals:**
- No changes to stored records, `save_question`/`get_ideas`/`post_questions` schemas, or reveal flows.
- No re-weighting of generation axes (the earlier "down-weight topical×boolean" idea is dropped).
- No new MCP tool, config field, or cascade axis.
- Not trying to make every question perfect — the gate's escape hatch is "re-roll," not "force a fix."

## Decisions

**1. A single shared `PUZZLE_QUALITY_GATE` const, referenced before SAVE on every path — not per-format copies.**
Mirrors the existing shared-gate pattern (define once, reference N times). The gate is format-agnostic; check 2 (surface tell) names the per-format manifestation inline (boolean parity / choice distractor standout / freeform telegraph). Alternative considered: a boolean-only gate — rejected because the user's insight is that the principle is universal and true/false merely exposes it most; a boolean-only gate would leave choice/freeform unprotected and duplicate logic later.

**2. The gate mandates explicit reasoning, not a checklist.**
Wording instructs Claude to "reason explicitly … don't just assert pass." A checklist invites rubber-stamping; the whole point is metacognition about puzzle quality. Trade-off: a few more generation tokens per question, accepted because a re-roll of a bad question costs far more (a weak question ships to the whole channel).

**3. Difficulty stays a strict-membership band check; the gate owns the *meaning* of difficulty.**
`DIFFICULTY_GATE` keeps its `[min,max]` self-rating mechanics (unchanged — other code paths and tests depend on it). We only reframe its lever wording from obscurity to doubt and let puzzle-gate check 3 state the principle once. Alternative: rebuild the difficulty gate around doubt — rejected as too invasive for a prompt-quality change and risks the cascade/parity tests.

**4. Absorb `AVOID YEAR/DATE ANCHORING` into the gate rather than leave both.**
Its principle == gate check 1 ("solvable by knowing, not an unverifiable datum"). Folding it in deletes a ~5-line boolean-only block, extends the protection to choice/freeform, and keeps net context flat. One worked example is retained inside the gate so nuance isn't lost.

**5. Topical falsity = substance swap, never date/number — fix the contradiction at its source.**
Rewrite the `TOPICAL_MODIFIER` boolean lever (`:253`). This is not new behavior layered on; it removes a rule that contradicts both `AVOID YEAR/DATE ANCHORING` and the `:578` "no date stamp in topical statement" rule and the "Current News" card frame. The spec already claims "all other gates apply identically to the fact path" — this makes the prompt actually honor it, so the spec becomes *more* accurate.

**6. Salience bar at event-selection time, not only at the gate.**
The salience requirement is enforced both up front (so Claude doesn't research a "who cares" event then reject it) and as gate check 5 (final backstop). Prefer salience over recency; fall back to the fact path or re-search. Reuses the existing topical fallback path — no new control flow.

**7. Flavor-leak reuses the existing NO-SPOILER GATE — no new prose.**
A comprehensive post-time `NO-SPOILER GATE` already exists (`scheduledPrompts.ts` step 9, ~line 565): a hard constraint spanning the opener, header, patter, card title/subtitle, closer, every emoji, and altText, with a pre-post self-check. Patter/subtitle are authored in that format/post section, not at generation time. So gate check 4 is a brief *pointer* to the NO-SPOILER GATE, not a second body of flavor-leak prose — this keeps the puzzle-gate's reasoning complete while avoiding redundant context. (Earlier drafts proposed adding a sibling one-liner to the format/post section; the existing gate already covers it, so that addition is dropped.)

## Risks / Trade-offs

- **[Prompt bloat despite intent]** → Absorb year-anchoring + compress difficulty levers + replace (not add) the topical lever; target net-neutral and verify by diffing rendered prompt length. Keep the gate terse; examples live in the absorbed rules.
- **[Gate rubber-stamping]** → Phrase as mandatory written reasoning with a "re-roll beats shipping weak" instruction; anchor each check with a concrete fail example.
- **[More re-rolls → slower/occasionally empty slots]** → Bound it: revise-once-then-reroll, no infinite loop; PREP's fill loop already tolerates re-rolls, and POST falls back to staged pool / inline gen.
- **[Spec/prompt-content tests break]** → Expected; update `scheduledPrompts` content assertions in lockstep and add coverage for the new gate.
- **[Two-phase flavor check missed in PREP]** → Acceptable: PREP doesn't write patter, so there's nothing to leak there; the POST flavor line covers the only phase where patter exists.
