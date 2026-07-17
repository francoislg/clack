## ADDED Requirements

### Requirement: Built-In `response-rendering` Topic

The system SHALL ship a built-in topic `response-rendering` at `data/default_configuration/user/topics/response-rendering/` containing the Slack rendering guidance previously shipped as baseline files: Block Kit formatting, Slack mrkdwn formatting, response style, and the rich-composition portion of the submit-response guidance. Operator overrides for these files SHALL resolve through the standard topic cascade path (`data/configuration/{role}/topics/response-rendering/`).

#### Scenario: Topic content loads only when attached
- **WHEN** a session is built without `response-rendering` attached (pre-attached or mid-session)
- **THEN** the assembled system prompt contains none of the moved rendering-guidance files
- **AND** the baseline still contains the submit-response contract stub

#### Scenario: Attached session sees full rendering guidance
- **WHEN** a session has `response-rendering` attached
- **THEN** the topic's files (Block Kit formatting, Slack formatting, response style, rich submit-response guidance) are present in the prompt content

### Requirement: Auto-Attach By Trigger Type

The system SHALL automatically pre-attach `response-rendering` at session start for every interactive trigger type: `directMessages`, `mentions`, `reactions`, `autoRespond`, `threadReply`, and `channelReply`. Sessions with trigger type `scheduled` SHALL pre-attach only the topics declared on the firing cron job (`CronJob.attachedTopics`). The trigger→topic mapping SHALL be a core constant, not operator-configurable. Auto-attached topics SHALL be merged (deduplicated) with any caller-supplied pre-attached topics. Worker mode is unaffected (it does not load the instruction cascade).

#### Scenario: Interactive trigger gets the topic automatically
- **WHEN** a session is created for a DM, mention, reaction, auto-respond, or thread-reply trigger
- **THEN** `response-rendering` is included in the session's pre-attached topics without any configuration

#### Scenario: Auto-attached topic deduplicates with caller-supplied topics
- **GIVEN** an interactive session whose caller already supplies `response-rendering` in pre-attached topics
- **WHEN** the built-in auto-attach merges its topics
- **THEN** the final pre-attached topics list contains `response-rendering` exactly once

#### Scenario: Scheduled fire without declaration stays lean
- **GIVEN** a cron job whose `attachedTopics` does not include `response-rendering`
- **WHEN** the job fires
- **THEN** the session's prompt does not contain the rendering-guidance topic files

#### Scenario: Scheduled fire with declaration gets the topic
- **GIVEN** a cron job with `attachedTopics: ["response-rendering"]`
- **WHEN** the job fires
- **THEN** the rendering-guidance topic files are present in the prompt

#### Scenario: Worker mode ignores trigger-based auto-attach
- **GIVEN** a worker-mode session executing a change
- **WHEN** the worker's system prompt is assembled
- **THEN** the prompt is built without the instruction cascade and `response-rendering` is never attached, regardless of the originating trigger type

### Requirement: Instructions-Only Catalog Entry

The shipped MCP registry SHALL include a `response-rendering` entry with a description and no MCP server, so `attach_integration("response-rendering")` succeeds via the existing instructions-only attach path and injects the topic's instruction files mid-session. The description SHALL make clear the entry provides guidance only (no tools).

#### Scenario: Mid-session self-attach
- **GIVEN** a session without `response-rendering` attached
- **WHEN** Claude calls `attach_integration("response-rendering")`
- **THEN** the attach succeeds with outcome `instructions_only` and the tool result contains the topic's instruction content

#### Scenario: Duplicate attach on an interactive session is a no-op
- **GIVEN** an interactive session where `response-rendering` was auto-attached at session start
- **WHEN** Claude calls `attach_integration("response-rendering")`
- **THEN** the idempotent duplicate path returns a brief success without re-injecting instructions

### Requirement: Baseline Submit-Response Contract Stub

The baseline `user/submit-response.md` SHALL retain only the tool contract every session needs (submit_response must be called; `skip_response` semantics; multi-message field gating) plus a single hint instructing Claude to call `attach_integration("response-rendering")` before composing rich visible output (tables, Block Kit layouts, multi-section messages) when the topic is not already loaded. Rendering guidance SHALL NOT remain in the baseline stub.

#### Scenario: Stub retains the contract
- **WHEN** any query session's prompt is assembled
- **THEN** the baseline contains the submit-response must-call contract, `skip_response` semantics, and the multi-message field gating rules (`additional_messages` / `thread_replies`)

#### Scenario: Stub hints before composition
- **WHEN** a session without the topic reads the baseline stub
- **THEN** the stub directs Claude to attach `response-rendering` before composing rich output
