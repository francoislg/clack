## MODIFIED Requirements

### Requirement: Send to Thread Action Type

The system SHALL support a `send_to_thread` action type that posts specific content to a channel thread. Each button carries its own content, persisted at creation time.

#### Scenario: send_to_thread action with content

- **WHEN** Claude calls `submit_response` with `{ type: "send_to_thread", content: "<text>" }` and optional `label`
- **THEN** the system persists the `content` as a dedicated entry in session snapshots keyed by a unique ID
- **AND** the Slack UI renders a primary-styled button (default label: "Send to thread")
- **AND** the button value encodes the session ID and the content entry ID

#### Scenario: send_to_thread content is required

- **WHEN** Claude calls `submit_response` with a `send_to_thread` action that omits `content`
- **THEN** the tool returns a validation error indicating `content` is required
- **AND** delivery is NOT attempted

#### Scenario: Multiple send_to_thread buttons with different content

- **WHEN** Claude calls `submit_response` with multiple `send_to_thread` actions, each with distinct `content`
- **THEN** each action gets its own persisted content entry with a unique ID
- **AND** clicking any button posts only that button's content, not the full response

#### Scenario: send_to_thread action rendering

- **WHEN** a response includes a `send_to_thread` action
- **THEN** the button is rendered with action_id `clack_dm_send_to_thread`
- **AND** the button value encodes the session ID and content entry ID

## REMOVED Requirements

### Requirement: Response-wide snapshot creation

**Reason**: Replaced by per-button content entries. The response-wide snapshot caused two bugs: all buttons shared the same content, and stale session state at click time could post wrong content.
**Migration**: Claude uses the `content` field on `send_to_thread` actions instead of relying on automatic snapshots. The `snapshotId` return value from `submit_response` is removed. The `snapshot` field on `send_to_thread` (for cross-turn references) is removed.
