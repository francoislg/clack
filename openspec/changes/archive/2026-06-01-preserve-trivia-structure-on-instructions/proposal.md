## Why

Admin free-text instructions (`instructions` / `additionalInstructions`) are meant to shape tone and content, but the generation prompt tells Claude to apply them to "phrasing, content choice, tone, **and any other aspect of the question**" — wording broad enough that a non-structural instruction like *"keep the preamble short"* silently mutates the post's structure (Claude drops the question card or skips the leaderboard table). The prompt has no rule distinguishing an instruction that *deliberately* asks for a layout change from one that doesn't, so structural drift happens by accident. We want admins to keep their structural contracts by default while still being able to change layout when they explicitly ask for it.

## What Changes

- Rewrite the generation-path ADMIN GUIDANCE clause: remove the open-ended "any other aspect of the question" language; add an explicit-intent rule — an admin instruction changes the post's *structure* only when it explicitly calls for a structural change (add / remove / replace / reorder a block, omit the leaderboard table); otherwise the block skeleton is preserved exactly and the instruction applies only to the content/tone of the block(s) it names (or overall tone if it names none).
- Rewrite the reveal-path admin-instruction clause with the same explicit-intent rule, and state that the leaderboard table is omittable when an instruction explicitly asks for its removal.
- Establish the "independent, individually-addressable block" framing so an instruction targeting one block (e.g. the preamble) does not bleed into others.
- Note the single floor: the answer buttons appended by `post_questions` are tool-owned and NOT removable by instruction.
- Tighten block #2's label in the question-card layout so admin terms like "preamble" / "opener" / "warm-up" reliably map to the warm-up patter `section`.

Scope: trivia plugin prompt text only. No schema, cascade, config, or tool-contract changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-scheduled-prompts`: add a requirement governing how admin `instructions` / `additionalInstructions` interact with the prompt's structural block layout — structure is preserved by default and changed only on explicit structural intent, in both the generation and reveal prompts.

## Impact

- `src/plugins/trivia/prompts/scheduledPrompts.ts` — the generation ADMIN GUIDANCE clause (~line 47), the reveal admin-instruction clause (~line 638), and the FOUR-BLOCK layout label for the warm-up patter block (~line 455).
- No data-model, config, migration, or tool-schema impact. Observable behavior change is confined to how Claude honors admin instructions during scheduled trivia posts and reveals.
