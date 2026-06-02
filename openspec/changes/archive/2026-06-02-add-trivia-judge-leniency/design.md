## Context

The freeform reveal judge (`src/plugins/trivia/freeform/judge.ts`) builds its prompt from monolithic string blocks: a `SHARED_RULES` header, one shape-specific block (`NAMED_ENTITY_RULES`, `PHRASE_RULES`, `DATE_RULES`, …), and `OUTPUT_RULES`. Leniency is expressed entirely inside `NAMED_ENTITY_RULES` as a fixed edit-distance budget ("~1 character off for short answers (≤5 chars), up to ~2 for longer ones"). There is no admin control and no way to express "the player clearly knew the answer" independent of character distance.

This change adds a cascading `judgeLeniency` axis. It is a **flat-object, stamp-on-record** axis in the taxonomy of the `add-trivia-attribute` skill: it cascades a single value (no weighted roll), and it is stamped on the question record at save time because it changes reveal-time judging. The skill is the canonical touch-point checklist; this design records the decisions specific to leniency.

## Goals / Non-Goals

**Goals:**
- Three named presets — `strict`, `strict-with-typos`, `lenient` — selectable per slot/season/game/workspace.
- Decompose the judge's leniency rules into named fragment constants composed into preset arrays, so presets share fragments by reference and a fourth preset is one array away.
- Default `strict-with-typos` so existing deployments need no migration and keep the typo-tolerant default — identical to prior behavior for named-entity answers; other shapes gain the same typo/loose-writing tolerance.
- Full MCP surface: writable on the three management tools, readable in `list_games`.
- Deterministic: a question is judged by the leniency in effect when it was posed.

**Non-Goals:**
- No algorithmic fuzzy-matching (no Levenshtein in code) — leniency stays prompt-encoded and judged by Haiku.
- No change to the exact-match pre-check, the per-answer retry budget, the cross-language acceptance rule, or any shape-specific value rules (date tolerance, too-broad, multi-guess).
- No per-question MCP knob — Claude does not pick leniency; it is config-driven only.

## Decisions

### 1. Value shape: bare string enum, not `{ mode }` object
`judgeLeniency: "strict" | "strict-with-typos" | "lenient"`. The hint axis wraps its value in `{ mode, minDifficulty }` because it has two coupled fields; leniency is a single scalar, so a bare string is simpler. Validator checks enum membership; zod is `z.enum(JUDGE_LENIENCY_KEYS)`. *Alternative considered:* `{ mode }` object for symmetry with hint — rejected as needless nesting.

### 2. Fragment composition replaces the typo budget
Decompose the leniency rules into named constants and compose presets:

```
CASE_RULE, SUBSTITUTION_RULE (20↔Vingt), DECADE_RULE (2020s↔2020),
PLURAL_RULE (trailing s), TYPO_RULE (1–2 chars), LOOSE_WRITING_RULE
(spacing/punct/accents/homophones), KNOWS_IT_RULE (intent over edit-distance).

strict          = [CASE, SUBSTITUTION, DECADE, PLURAL]
strictWithTypos = [...strict, TYPO, LOOSE_WRITING]   // = today's behavior
lenient         = [KNOWS_IT]
```

`buildSingleJudgePrompt(question, answerText, level)` assembles `SHARED_RULES + LENIENCY_PRESETS[level] + SHAPE_RULES[shape] + OUTPUT_RULES`. The leniency preset and the shape block are **orthogonal**: presets govern matching forgiveness; shape blocks govern value semantics. The `SHARED_RULES` integrity guards (multi-guess, too-broad, materially-different, variants-additive, Notes) stay universal, so even `lenient` cannot accept a hedge or a too-broad answer. The current typo line moves OUT of `NAMED_ENTITY_RULES` into the fragments; the named-entity block slims to synonyms + translation + too-broad.

*Alternative considered:* keep monolithic strings and `if (level === …)`-swap whole blocks — rejected; it duplicates the shared rules across presets and drifts.

### 3. Resolve at `save_question`, stamp on record
`save_question` resolves `judgeLeniency` from the live cascade (`resolveJudgeLeniency(slotIndex, currentSeason, game, workspace)` — mirroring `domain/hint.ts`'s parameter order, since resolver signatures vary per axis and this one is modeled on the flat `hint` axis) and writes it onto the `TriviaQuestion` record. The reveal judge reads the stamp. This is the same determinism guarantee weighted axes get, and it matches the user's intent: judge by the policy in effect when the question was *posed*, not when it happens to be revealed. *Alternative considered:* resolve live at reveal — rejected; a mid-cycle config edit would retroactively re-judge already-answered questions. Absent stamp (legacy questions) reads as `strict-with-typos`.

### 4. No `get_ideas` roll
Unlike weighted axes, leniency needs no random roll and no Claude involvement at generation. `get_ideas` is untouched. The resolve-and-stamp happens entirely inside `save_question`, so Claude never has to carry the value (eliminating the drop-the-field failure mode the hint axis risks).

## Risks / Trade-offs

- **Haiku follows a vaguer `lenient` rule loosely → false-accepts climb** → `lenient` is opt-in and never the default; `KNOWS_IT_RULE` keeps the explicit "could not plausibly mean a DIFFERENT valid answer" guard so distinctiveness, not blanket forgiveness, gates acceptance; structural guards stay universal.
- **Fragment refactor changes the `strict-with-typos` prompt text → behavior drift on the default path** → the refactor MUST keep the typo + loose-writing tolerances on the default path (identical to today for named-entity answers; deliberately extended to the other freeform shapes as a consequence of making forgiveness orthogonal to shape — added rules are redundant with each shape's value rules, so no verdict flip is expected); covered by a judge-prompt assertion test that the default preset still contains the typo + writing tolerances.
- **A tier sets `judgeLeniency` but the question isn't freeform** → harmless; the stamp is only read by the freeform judge. Non-freeform questions ignore it.
- **Missed touch-point (the recurring axis pain)** → mitigated by following the `add-trivia-attribute` skill checklist and the grep-completeness verification step; this axis skips the weighted-roll layer (no `get_ideas`).
