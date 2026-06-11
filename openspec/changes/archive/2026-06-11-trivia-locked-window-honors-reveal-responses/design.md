## Context

A posted trivia question moves through three phases: **live** (voting open), **locked** (voting frozen via `lock_questions` / `lockCron`, outcome not yet known), and **revealed** (`process_reveal_answers` has run). Two stamped axes already govern disclosure: `liveAnswersVisible` (boolean, live phase) and `revealResponses` (`"yes" | "just-correctness" | "just-winners" | "no"`, reveal phase). Both are resolved through the cascade and stamped on the question record at `post_questions` time.

The single render path for live and locked cards is `editRosterIntoCard` in `src/plugins/trivia/freeform/roster.ts`. Its `answerLocked === true` branch currently strips the answer-actions block and appends only the locked notice — discarding the roster entirely. The motivating gap: for prediction games, the locked window (everyone committed, waiting on the result) is exactly when the vote distribution is most interesting, yet it shows nothing.

`buildRosterBlock` currently reads `question.liveAnswersVisible ?? true` internally to choose between the grouped layout (`renderGroupCompact`/`renderGroupMultiline`) and the flat layout (`renderHidden`).

## Goals / Non-Goals

**Goals:**
- Make the locked card honor the admin's votes-disclosure intent via `revealResponses`: `"yes"` → full grouped distribution, `"just-correctness"`/`"just-winners"` → participation-only, `"no"` → nothing.
- Reuse the two roster layouts that already exist (grouped, flat) rather than inventing a third.
- Keep the live and reveal phases byte-for-byte unchanged.

**Non-Goals:**
- No new config field, cascade axis, schema, or migration — `revealResponses` is already stamped.
- No change to which questions get locked, to the click/modal lockout, or to the reveal footer.
- No attempt to compute correctness during the locked window (the outcome isn't settled).

## Decisions

**1. `revealResponses` is the sole locked-window gate; `liveAnswersVisible` is not consulted while locked.**
Rationale: `liveAnswersVisible: false` is an *anti-bandwagoning* lever — "don't show a running tally while people are still voting." Once voting is frozen that risk is gone, so it should not keep suppressing the locked board. `revealResponses` expresses the durable "will these votes ever be public" intent, which is the right question for the locked window. This matches the user's stated model: `liveAnswersVisible: false` should NOT hide the locked board, but `revealResponses: "no"` should.

**2. Map the four `revealResponses` modes onto the two existing layouts.**
- `"yes"` → grouped layout (the `liveAnswersVisible === true` path): names + picks.
- `"just-correctness"` / `"just-winners"` → flat layout (the `liveAnswersVisible === false` path): names only, no picks. Correctness can't be partitioned pre-outcome, so they degrade to participation-only; their full bucketing still happens at the real reveal.
- `"no"` → no roster (today's locked behavior).

Alternative considered: have `"just-winners"`/`"just-correctness"` also hide during lock (only `"yes"` shows anything). Rejected — the user explicitly wanted these to "just display who voted," and participation-only leaks no picks, so it is consistent with their reveal-time intent (they DO name people at reveal).

**3. Add an explicit render-mode parameter to `buildRosterBlock` instead of reading `liveAnswersVisible` internally.**
`buildRosterBlock` gains a parameter selecting `grouped` vs `flat` (the two existing branches). The unlocked call site passes the mode derived from `liveAnswersVisible` (preserving today's behavior); the locked call site passes the mode derived from `revealResponses`. This keeps the layout primitives in one place and makes the gate the caller's decision. Alternative — duplicate the layout logic in the locked branch — rejected as it would drift from the unlocked renderer.

**4. Hoist the answer-load + cheater-filter + `nameOf` setup so the locked branch reuses it.**
Today that setup lives only in the unlocked branch. The locked branch (for `"yes"`/`just-*`) needs the same filtered answers and `nameOf`. Compute them once before the lock/unlock split; the `"no"` case simply skips appending a roster. The cheater filter and `tagPlayers` handling are thereby shared, so the locked roster can't leak a flagged cheater.

## Risks / Trade-offs

- **Surprise for `liveAnswersVisible: false` + `revealResponses: "yes"`** → picks were hidden live, then appear in full at lock. This is intended (anti-bandwagoning ends at lock) and is documented in the spec, but it is a visible behavior shift for that config combo. Mitigation: it only triggers under an explicit lock, and the disclosure is exactly what `revealResponses: "yes"` already promises at reveal.
- **`buildRosterBlock` signature change** → its existing unit tests and the unlocked call site must pass the new mode arg. Low risk; localized to `roster.ts` and its tests.
- **Empty locked roster** (locked before anyone answered) → the grouped/flat renderers already render a "no answers yet" line; for the locked window that reads naturally. No special-casing needed.
