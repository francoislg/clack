## MODIFIED Requirements

### Requirement: Per-Message Payload Shape

Each entry in `additional_messages`, `thread_replies`, `post_to.additional_messages`, and `post_to.thread_replies` SHALL be a `MessagePayload` object with the following shape: `blocks: Block[]` (required, at least one), `table?: TableBlock`, `actions?: Action[]`, `reactions?: string[]`. The fields `message`, `post_top_level`, `attention_level`, `skip_response`, and `suppress_unfurls` SHALL NOT be present on `MessagePayload` — they are session-level signals carried only on the primary `submit_response` payload. `MessagePayload` is defined as a strict (`.strict()`) zod object so unknown keys produce an "unrecognized key" error at the schema boundary.

#### Scenario: MessagePayload accepts blocks plus optional fields

- **WHEN** an `additional_messages[i]` entry has `{ blocks, table, actions, reactions }`
- **THEN** the schema accepts the entry
- **AND** each optional field is validated by the same validators that handle the corresponding primary-level field

#### Scenario: MessagePayload rejects primary-only fields

- **WHEN** an `additional_messages[i]` entry includes `message`, `post_top_level`, `attention_level`, or `skip_response`
- **THEN** zod rejects with an "unrecognized key" error naming the offending field and the entry index

#### Scenario: MessagePayload requires non-empty blocks

- **WHEN** an `additional_messages[i]` entry has `blocks: []`
- **THEN** zod rejects with the standard "array too short" error naming the field path and the minimum of 1
