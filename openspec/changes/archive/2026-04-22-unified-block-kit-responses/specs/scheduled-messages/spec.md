## ADDED Requirements

### Requirement: Scheduled Cron-Job Prompt Format Guidance Uses Blocks Vocabulary

Scheduled cron-job prompt text (the `jobs[].prompt` field of `data/state/cron-jobs.json`) SHALL, when it references response formatting, layout, or markdown patterns, use the blocks vocabulary defined in the `clack-tool-response` capability (`header`, `section`, `context`, `divider`, `image`, `fields`). Prompts that do not reference formatting remain free-text instructions for Claude to run at fire time, with delivery handled by `submit_response` as for any other Claude run.

There is no schema change on the `CronJob` type — the `prompt` field remains `string`. This requirement governs the *content* of prompts with format guidance, not the storage shape.

#### Scenario: format-agnostic prompt runs without special handling

- **GIVEN** a cron job whose `prompt` text does not reference response formatting (e.g., "Ask the channel what they worked on yesterday")
- **WHEN** the cron scheduler fires the job
- **THEN** Claude runs with the prompt as input and calls `submit_response` with blocks as with any other trigger
- **AND** the scheduler does not inject any format-specific guidance

#### Scenario: format-guided prompt drives block-aware response

- **GIVEN** a cron job whose `prompt` text references block types (e.g., "Open with a header block summarizing the week; follow with one section per topic")
- **WHEN** the cron scheduler fires the job
- **THEN** Claude runs with the prompt as input and produces a `submit_response` call whose `blocks` array matches the prompt's intent
- **AND** the response is delivered through the standard `submit_response` path

#### Scenario: cron job fires before the enhancement migration has rewritten its prompt

- **GIVEN** a freshly-deployed Clack instance where the enhancement migration has started but not yet processed job `J`
- **AND** job `J`'s `prompt` still contains legacy format guidance (e.g., "respond with bullet points")
- **WHEN** the cron scheduler fires job `J`
- **THEN** Claude receives the legacy prompt text as-is
- **AND** Claude still produces a valid block-based response (the new instruction files teach blocks vocabulary regardless of prompt wording)
- **AND** the response is delivered through `submit_response` with the same block validation as any other trigger
- **AND** the migration eventually reaches job `J` on a subsequent scheduler cycle, rewriting the prompt; the in-flight run is unaffected

### Requirement: Automatic Migration Of Pre-Existing Scheduled Prompts

An enhancement migration SHALL iterate every `jobs[].prompt` entry in `data/state/cron-jobs.json` and, for prompts that reference response formatting, layout, or markdown patterns, rewrite the prompt text so its format guidance uses the new blocks vocabulary. Format-agnostic prompts SHALL be left untouched byte-for-byte. The migration is fully automatic, Claude-powered, runs in enhancement (background) priority, and is idempotent.

#### Scenario: format-agnostic prompt is untouched

- **GIVEN** a persisted cron job with `prompt: "Ask the channel what they worked on yesterday."`
- **WHEN** the enhancement migration runs
- **THEN** the output is byte-for-byte identical to the input
- **AND** the persisted prompt on disk is unchanged

#### Scenario: format-specific prompt is rewritten

- **GIVEN** a persisted cron job with `prompt: "Respond with a bold title and bullet points for each item."`
- **WHEN** the enhancement migration runs
- **THEN** the output replaces "bold title" with a reference to a `header` block (or a titled section), and replaces "bullet points" with a reference to a `section` block containing a markdown list
- **AND** the rewritten text no longer mentions bare markdown/mrkdwn formatting patterns as response guidance
- **AND** the rewritten prompt is persisted back to `data/state/cron-jobs.json` with the rest of the `CronJob` record unchanged
- **AND** the semantic intent (what Claude should communicate) is preserved — only the format guidance is restated in block terms

#### Scenario: migration is idempotent

- **GIVEN** a cron job whose `prompt` already references block types (`header`, `section`, `context`, `divider`)
- **WHEN** the enhancement migration runs a second time on the same prompt
- **THEN** the output is byte-for-byte identical to the input
- **AND** no extra rewrite passes are performed

#### Scenario: migration skips ambiguous prompts safely

- **GIVEN** a prompt where the migration engine cannot determine with confidence whether format guidance is present (e.g., mixed semantic and formatting content, or prompts in non-English text the engine cannot analyze)
- **WHEN** the migration runs
- **THEN** the prompt is left unchanged (migration defaults to preserving intent when uncertain)
- **AND** the skip is logged for observability

#### Scenario: migration continues on per-prompt failure

- **GIVEN** a migration run where one cron job's prompt causes a migration engine failure (e.g., model timeout, parse failure on the engine's response)
- **WHEN** the migration processes prompts sequentially
- **THEN** the failed prompt is logged with its job `id` and error reason
- **AND** the `jobs[].prompt` field on disk is left untouched for that job (no partial write)
- **AND** the migration continues to the next job rather than aborting the whole run
- **AND** on the next startup the migration re-attempts any prompts that previously failed

#### Scenario: migration runs without admin intervention

- **WHEN** the enhancement migration phase starts after startup
- **THEN** the migration executes against all persisted cron-job prompts without prompting administrators
- **AND** does not expose an opt-out per prompt
- **AND** logs its activity for observability but does not surface a summary UI
