## REMOVED Requirements

### Requirement: `update_question` persists authored reveal blocks

**Reason**: The tool is renamed `set_reveal_narrative` — the old name promised a general question editor that never existed (it only ever wrote `revealBlocks`), which misled operators during a real incident. Behavior is unchanged.
**Migration**: Covered by "`set_reveal_narrative` persists authored reveal blocks" below.

## ADDED Requirements

### Requirement: `set_reveal_narrative` persists authored reveal blocks

The trivia plugin SHALL register an `admin`-tier MCP tool `set_reveal_narrative` (callable as `mcp__trivia__set_reveal_narrative`, replacing the former `update_question`) taking `{ game: string, questionId: string, revealBlocks: KnownBlock[] }`. The tool SHALL write `revealBlocks` onto the named question's record in `games/<game>/questions.json` and SHALL perform NO Slack write (consistent with `refresh_question_cards` being the sole card editor in the reveal flow). The write SHALL be idempotent — re-calling replaces the stored blocks rather than appending. The tool SHALL reject the call (returning an error, writing nothing) when `resolveIncludeRevealInQuestions` for the question's game/workspace is `"no"`.

#### Scenario: Tool registers under the new name

- **WHEN** the trivia plugin loads
- **THEN** `set_reveal_narrative` is registered on the trivia MCP server with `minRole: "admin"`
- **AND** no tool named `update_question` is registered

#### Scenario: Persists blocks when axis is yes

- **GIVEN** a game resolving `includeRevealInQuestions: "yes"`
- **WHEN** `set_reveal_narrative({ game, questionId: "Q1", revealBlocks: [<blocks>] })` is called
- **THEN** `Q1`'s record carries those `revealBlocks` and no Slack message is edited

#### Scenario: Re-calling overwrites

- **WHEN** `set_reveal_narrative` is called twice for the same question with different blocks
- **THEN** the record holds only the second call's blocks

#### Scenario: Rejected when axis is no

- **GIVEN** a game resolving `includeRevealInQuestions: "no"`
- **WHEN** `set_reveal_narrative({ game, questionId: "Q1", revealBlocks: [<blocks>] })` is called
- **THEN** the call returns an error and `Q1`'s record gains no `revealBlocks`

## MODIFIED Requirements

### Requirement: Reprocessing an already-posted batch re-authors the per-card narrative

When an admin reprocesses an already-posted batch (`compute_answers` reprocess mode followed by `refresh_question_cards`), the reprocess runbook SHALL instruct Claude to re-author each reprocessed question's per-card narrative via `set_reveal_narrative` BEFORE calling `refresh_question_cards`, exactly as the fresh-reveal flow does — but ONLY when `includeRevealInQuestions` resolves to `"yes"` for the game. The re-authored narrative SHALL conform to the question's now-current `revealResponses` mode (e.g. it MUST NOT quote a player's typed answer that the current mode hides) and to the verdicts re-derived by the reprocess (e.g. it MUST NOT assert a player was correct when the re-judge flipped that verdict to incorrect).

When `includeRevealInQuestions` resolves to `"no"`, the runbook SHALL NOT call `set_reveal_narrative` during reprocess (cards stay facts-only), matching the fresh-reveal flow.

This is a prompt-only requirement: it adds an authoring step to the runbook in `triviaCheckInstruction.ts` ("Correcting an already-posted batch") and introduces no new tool, payload field, or code path.

#### Scenario: revealResponses dropped to just-correctness then reprocessed

- **GIVEN** a posted freeform batch whose cards were revealed with `revealResponses: "yes"` and whose narrative quotes a player's typed answer ("you said Swiss")
- **AND** the game resolves `includeRevealInQuestions: "yes"`
- **WHEN** an admin changes `revealResponses` to `"just-correctness"` and reprocesses the batch
- **THEN** the runbook instructs Claude to call `set_reveal_narrative` for each reprocessed card before `refresh_question_cards`
- **AND** the re-authored narrative no longer quotes the player's typed answer

#### Scenario: Reprocess with includeRevealInQuestions no does not author narrative

- **GIVEN** a posted batch on a game that resolves `includeRevealInQuestions: "no"`
- **WHEN** an admin reprocesses the batch
- **THEN** the runbook does NOT instruct Claude to call `set_reveal_narrative`
- **AND** the cards remain facts-only after `refresh_question_cards`
