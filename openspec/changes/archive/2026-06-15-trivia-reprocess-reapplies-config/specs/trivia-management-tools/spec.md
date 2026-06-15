## ADDED Requirements

### Requirement: Management instruction covers correcting an already-posted batch

The `TRIVIA_MANAGEMENT_INSTRUCTION` SHALL include guidance for applying a config change to an ALREADY-POSTED batch. The guidance SHALL state that:

- Config edits via `upsert_game` / `upsert_season` / `set_workspace_config` (including `revealResponses` and `judgeLeniency`) take effect for FUTURE batches only — they do NOT retroactively change a batch that is already posted, and that is the default, intended behavior.
- Reprocessing an already-posted batch is a SEPARATE, EXPLICIT, admin-initiated action. The instruction SHALL direct Claude to reprocess ONLY when the admin explicitly asks to update/fix/re-apply something to already-posted questions, and SHALL forbid reprocessing automatically, as a follow-up to a plain config edit, or on Claude's own initiative. After a normal config edit Claude SHALL NOT reprocess — at most it may note the change affects future batches and offer to update the posted batch.
- When the admin explicitly asks, the path is: `compute_answers` in reprocess mode targeting that batch (`reprocessBatchId`, or `reprocessQuestionIds`), then `update_answers_block` with the returned `batchId`. Reprocessing re-stamps the current `revealResponses` / `judgeLeniency` and (for freeform) re-judges the retained answers.
- The reveal cron SHALL NOT be re-run via `run_scheduled_message_now` to apply a config change to a posted batch.
- A change to a posted batch SHALL NOT be reported as done unless it was actually reprocessed (no claiming an effect the tools did not produce).

#### Scenario: Instruction documents the reprocess path and prohibitions

- **WHEN** the assembled `TRIVIA_MANAGEMENT_INSTRUCTION` is inspected
- **THEN** it contains a section on correcting an already-posted batch that names the `compute_answers` reprocess → `update_answers_block` flow
- **AND** it states that config edits only affect future batches
- **AND** it prohibits using `run_scheduled_message_now` to apply a config change to a posted batch
- **AND** it instructs not to claim a posted batch changed unless it was reprocessed

#### Scenario: Instruction gates reprocessing to explicit admin requests only

- **WHEN** the assembled `TRIVIA_MANAGEMENT_INSTRUCTION` is inspected
- **THEN** it states reprocessing a posted batch is a separate, explicit, admin-initiated action
- **AND** it forbids reprocessing automatically or as a follow-up to a plain config edit
