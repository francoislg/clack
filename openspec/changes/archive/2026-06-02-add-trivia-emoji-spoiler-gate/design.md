## Context

`scheduledPrompts.ts` already factors shared validation logic into named gate constants (`DUPLICATE_CHECK_GATE`, `DIFFICULTY_GATE`, `STATEMENT_CHOICES_NON_OVERLAP_GATE`, `HINT_DRAFTING_GATE`, plus the visual `IMAGE_*`/`VISUAL_*` gates). Each is defined once and invoked from a path step with "apply the X GATE (shared definition above)." Emoji selection is the one user-visible field with a spoiler risk that has no gate — six steps say variants of "Choose emojis relating to the topic." The non-spoiler pattern itself already exists for `media.altText` ("a national flag", not "the flag of Ecuador").

## Goals / Non-Goals

**Goals:**
- Stop topic-literal emojis from leaking the answer in the card title.
- Reuse the existing shared-gate idiom so the rule lives in exactly one place.

**Non-Goals:**
- No `save_question` validation or deterministic emoji rejection (that was option B, declined).
- No data-model, tool, or rendering change. Emoji selection stays Claude's call.

## Decisions

**One shared `EMOJI_SELECTION_GATE` constant, referenced by all six steps** — over inlining the constraint into each step. Matches the established gate pattern, keeps the rule single-sourced, and makes the test assertion trivial (gate text present once, referenced N times).

**Anchor to the category, not a blocklist of emoji** — the gate frames the rule positively ("emojis decorate the category; the card renders `<emoji> <Category>`") and forbids depicting the answer/subject, with the flag case as the canonical example. A literal emoji blocklist would be brittle and miss novel spoilers; the semantic framing generalizes (flags, animals, landmarks, counts, colors).

**Keep the `media.altText` guidance as-is** — it already states the same principle for its own field. The gate cross-references the idea but does not refactor altText.

## Risks / Trade-offs

- [Prompt-only enforcement — Claude may still occasionally pick a spoiler emoji] → Acceptable; the gate sits beside the other soft gates that Claude reliably follows, and emojis are low-stakes decoration. A deterministic backstop can be added later if leakage persists.
- [Six call sites must each be updated — missing one leaves a gap] → The path tests assert each path references the gate, catching an omission.
