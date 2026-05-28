## Context

The `revealResponses` axis (`core/configTypes.ts`) already cascades `slot → season → game → workspace → "yes"` via `revealResponsesResolver.ts`, is stamped per-question at `post_questions` time, and drives a discriminated-union `voters` payload (`tools/reveal/types.ts`) that each answer-type handler assembles by switching on `question.revealResponses` (`answerTypes/{boolean,choice,freeform}.ts`). The reveal renderer (`prompts/scheduledPrompts.ts`) branches on `voters.revealResponses`. The architecture's deliberate stance (see `types.ts` doc comment) is to **physically omit data the mode must not disclose** rather than ask Claude to mask it — that's why `"no"` drops the bucket arrays entirely.

This change adds a fourth rung, `"just-winners"`, that names the correct voters but reduces the missers to anonymous counts. Nearly all the machinery exists; the work is one new enum value + one new union variant + the matching assemble branch in three handlers + one render branch.

## Goals / Non-Goals

**Goals:**
- A `"just-winners"` mode that names `correct` voters, exposes anonymous `incorrectCount` + `noAnswerCount`, and keeps `reactions`.
- Preserve "everyone got it wrong!" and "N missed it" flair without naming any misser.
- Accept the value through the full cascade and surface it in the read tools.

**Non-Goals:**
- No change to `"yes"`, `"just-correctness"`, or `"no"` behavior.
- No `roundSummary` / "This Round" leaderboard row support for the new mode (stays gated to all-`"yes"` batches, like the other restricted modes).
- No data migration; the enum is additive and per-question stamped.

## Decisions

**1. New union variant carries anonymous counts, not a flag.**
```ts
| { revealResponses: "just-winners";
    correct: Voter[];          // named; freeform correct voters KEEP answerText
    incorrectCount: number;    // anonymous tally
    noAnswerCount: number;     // anonymous tally
    reactions: ReactorEntry[] }
```
Rationale: counts strictly dominate a boolean — they enable "2 nailed it, 3 missed" *and* "everyone got fooled!" (`correct` empty + `incorrectCount > 0`), whereas a flag only enables the latter. The cost is one extra integer. _Alternative considered_: reuse `just-correctness` and instruct Claude to hide the incorrect names — rejected because it violates the physical-omission stance and risks leaks.

**2. Freeform correct voters keep `answerText`.** The privacy concern is about *missers*, who are never named. Quoting the winner's correct answer ("Alice said *Paris* — bullseye!") is celebratory and on-theme. _Alternative_: strip it for symmetry with `just-correctness` — rejected as needless; the right answer is about to be revealed anyway.

**3. `correct` is still the named bucket the renderer can iterate.** When `correct` is empty, the renderer reads `incorrectCount + noAnswerCount` to produce the "everyone missed it" closer. The render branch lives alongside the existing `"no"`/`"just-correctness"` branches in both single- and multi-question layouts.

**4. Resolver and `allYes` gate need no change.** `resolveRevealResponses` is value-agnostic. `processRevealAnswers`'s `roundSummary` gate already keys on `=== "yes"`, so `"just-winners"` is excluded automatically. Only `roundSummary.ts`'s per-bucket loop needs a guard, since the new variant has no `incorrect`/`noAnswer` arrays to read.

## Risks / Trade-offs

- **[Renderer infers nothing it shouldn't]** → The payload physically omits misser identities; Claude cannot name them even by mistake. The prompt branch explicitly forbids speculating about who missed.
- **[`roundSummary.ts` crashes reading absent arrays]** → Add an explicit `if (buckets.revealResponses === "just-winners") continue;` (or fold into the existing `=== "no"` skip) alongside a regression test.
- **[Config surfaces drift]** → The enum value flows through a shared `REVEAL_RESPONSES_VALUES` array; surfaces that validate against it pick up the new value automatically. Only human-facing description strings need manual edits.
- **[Name collision with `just-correctness`]** → `"just-winners"` was chosen specifically to be unmistakable in config files and code review.
