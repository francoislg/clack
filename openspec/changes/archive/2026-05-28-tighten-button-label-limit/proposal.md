## Why

Slack action-button labels longer than ~40 characters get visually truncated in the Slack UI, hiding the meaningful part of the label from users. Today the `submit_response` schema accepts arbitrary-length strings for every `label` field and only validates against Slack's 75-char API limit at render time, so Claude can author labels that parse and deliver successfully yet are unreadable in the client.

## What Changes

- **BREAKING (Claude-facing tool contract):** Every action-button `label` field on `submit_response` actions SHALL be capped at 40 characters at the schema level (Zod `.max(40)`). Tool calls with longer labels are rejected at parse time so Claude sees the error and retries with a shorter label.
- Each affected field's `describe()` text SHALL state the 40-char maximum so Claude has the constraint up front.
- The runtime `validateActionButtonLabels` validator SHALL tighten its threshold from 75 → 40 as a belt-and-suspenders check for any code path that bypasses the Zod schema (including hardcoded defaults from `defaultActionLabel`).
- A unit test SHALL assert that every string returned by `defaultActionLabel` is ≤ 40 characters, so future default-label edits cannot regress.
- Scope: the 10 `label` fields on `submit_response` action schemas (`followup`, `choice`, `post_to`, `change`, `config_update`, `update`, `skill_create`, `skill_update`, `skill_disable`, `skill_restore`). Dev-authored buttons elsewhere in the app (Home Tab, retry, change-thread actions) are out of scope — they are statically tested and already short.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `clack-tool-response`: action-button label length requirement tightens from 75 chars to 40 chars; constraint moves from render-time validator only to schema-level rejection plus render-time validator.

## Impact

- **Code:** `src/tools/presentation/submitResponse.ts` (10 label fields + shared helper), `src/slack/blocks.ts` (`SLACK_BUTTON_LABEL_LIMIT` constant, `validateActionButtonLabels`).
- **Tests:** new schema-rejection tests for each label field, new test for `defaultActionLabel` lengths, updated `validateActionButtonLabels` tests.
- **Claude tool contract:** the JSON schema Claude sees for `submit_response` will include `maxLength: 40` on every `label` field and updated `describe` text. No spec-driven downstream consumers (Claude is the sole consumer of this schema).
- **No data migration, no config changes, no API changes.**
