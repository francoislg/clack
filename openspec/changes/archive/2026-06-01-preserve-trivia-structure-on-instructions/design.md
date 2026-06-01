## Context

The trivia plugin injects admin free-text into the scheduled prompts via two payload fields resolved by `src/plugins/trivia/domain/instructions.ts`:

- `instructions` — replace-cascade (`slot → season → game → workspace`), highest tier wins.
- `additionalInstructions` — cumulative-cascade, every tier stacks, each segment labeled.

Both are surfaced to Claude through `get_ideas` (generation) and `process_reveal_answers` (reveal), and the prompt clauses in `scheduledPrompts.ts` tell Claude how to honor them. The structural contracts Claude must produce — the FOUR-BLOCK question card layout, the answer buttons appended by `post_questions`, the reveal block layout, and the leaderboard `table` param — are hard-coded inline in the same prompt because they couple to tool output schemas.

The defect: the generation clause (~line 47) says honor instructions "throughout the run — apply it to phrasing, content choice, tone, **and any other aspect of the question** you generate." That open-ended phrasing authorizes Claude to reinterpret a tone instruction (*"keep the preamble short"*) as a structural mandate, dropping the card or the table. The reveal clause (~line 638) lists the surfaces an instruction touches but offers no preservation backstop. Nothing in the prompt distinguishes a deliberate structural instruction from an incidental tone one.

## Goals / Non-Goals

**Goals:**

- An admin instruction that is NOT about layout preserves the block structure exactly and applies only to the content/tone of the block(s) it names.
- An admin instruction that EXPLICITLY asks for a structural change (add / remove / replace / reorder a block, omit the leaderboard table) makes exactly that change and takes priority over the default layout.
- An instruction naming one block (e.g. "preamble") does not bleed into sibling blocks.
- Zero data-model, config, cascade, migration, or tool-schema change.

**Non-Goals:**

- No new structured/zone-scoped instruction schema (`{ zone, text }[]`). The block names already present in the prompt are reused as the addressing vocabulary in free text.
- No second free-text channel. The existing `instructions` / `additionalInstructions` fields keep their current cascade semantics; only the prompt's interpretation guidance changes.
- No change to the core (non-trivia) query path.
- No attempt to make the tool-appended answer buttons removable.

## Decisions

**Decision: Default-preserve with explicit-override, expressed as a decision test in the prompt.**
Both ADMIN GUIDANCE clauses gain the same rule: on each instruction, decide whether it explicitly calls for a layout change. If yes → make exactly that change; it wins over the default layout. If no → preserve the skeleton and apply only to content/tone of the named block(s). This is the minimal wording that satisfies both the *"keep preamble short"* (preserve) and *"don't use a card"* / *"don't include the leaderboard table"* (override) cases.
*Alternative considered:* a hard lock ("never alter structure"). Rejected — it breaks legitimate explicit overrides the admin is entitled to make.
*Alternative considered:* zone-scoped instruction schema. Rejected as out of scope — heavier (schema + cascade + tools + migration) for the same observable outcome, and the prompt already names every block.

**Decision: Reuse existing block names as the free-text addressing vocabulary.**
The prompt labels its blocks (header, warm-up patter, card, closer; reveal verdict, voter-bucket commentary, closer, leaderboard intro/table). Teaching Claude to map admin terms ("preamble"/"opener"/"warm-up" → the patter `section`) onto those names gives per-block targeting without a data model. Block #2's label is tightened so "preamble" maps unambiguously.

**Decision: One explicit floor — the answer buttons.**
`post_questions` appends the `actions` block mechanically regardless of the `blocks` array, so an instruction cannot remove the answer buttons. The clause states this single exception. The leaderboard table is NOT a floor — Claude passes it as the `table` param, so an explicit "don't include the leaderboard table" instruction is honored by omitting the param.

**Decision: Home the requirement in `trivia-scheduled-prompts`.**
The behavior is a property of the prompt contracts (generation + reveal), both authored in `scheduledPrompts.ts` and already specced under `trivia-scheduled-prompts`. The admin-instruction-vs-structure interaction was not previously a spec requirement, so this is an ADDED requirement, not a MODIFIED one.

## Risks / Trade-offs

- **[Free-text intent classification is probabilistic]** → Claude must judge "is this a structural ask?" from prose; an ambiguous instruction could be misclassified. Mitigation: the decision test biases toward *preservation* (only an explicit add/remove/replace/reorder triggers a structural change), so the failure mode degrades toward keeping structure — the safe direction — rather than dropping it.
- **[Block-name vocabulary may not cover every admin phrasing]** → an admin term that maps to no named block falls back to "overall tone, structure preserved." Acceptable: worst case is the same safe default, never structural drift.
- **[No automated test asserts prompt prose]** → this is prompt text, hard to unit-test. Mitigation: spec scenarios document the expected behavior as the contract; verification is by reading the rendered prompt and spot-checking live posts.
