# home-tab (delta)

## ADDED Requirements

### Requirement: Followed Conversations in Auto-Respond Section

The Home Tab auto-respond section (admin-only, unchanged visibility) SHALL render two sub-groups: standing rules (existing rendering, unchanged) and followed conversations (ephemeral rules). Each conversation row SHALL show the channel, current attention level, expiry state (`expires in Xm` while within the window; a dormant label such as "dormant — will re-engage if the conversation resumes" past it), linked-session count, and a "Stop following" button. Ephemeral rows SHALL NOT open the standing-rule edit modal. All new strings SHALL go through `t()` with en/fr parity.

#### Scenario: Conversation row rendering
- **WHEN** an admin opens the Home Tab while an ephemeral rule exists within its window
- **THEN** the auto-respond section shows a followed-conversation row with channel, attention level, time to expiry, session count, and a Stop following button

#### Scenario: Dormant rendering
- **WHEN** an ephemeral rule's `expiresAt` has passed and no message has since arrived in the channel
- **THEN** the row renders the dormant label instead of a countdown

#### Scenario: Stop following action
- **WHEN** an admin clicks "Stop following" on a conversation row
- **THEN** the ephemeral rule is deleted and the Home Tab re-renders without the row

#### Scenario: No edit modal for ephemeral rules
- **WHEN** an ephemeral rule is rendered
- **THEN** no Edit button (standing-rule modal) is offered for it
