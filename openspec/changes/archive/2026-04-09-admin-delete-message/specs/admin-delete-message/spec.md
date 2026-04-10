## ADDED Requirements

### Requirement: Delete Clack Message by URL
The system SHALL provide an `admin_delete_message` tool that allows admin users to delete a message posted by Clack, identified by its Slack permalink URL.

#### Scenario: Successful deletion of a top-level message
- **WHEN** an admin calls `admin_delete_message` with a valid Slack permalink to a top-level message posted by Clack
- **THEN** the system fetches the message from the channel's history
- **AND** verifies that `message.bot_id` matches Clack's own bot ID (from `auth.test()`)
- **AND** calls `chat.delete({ channel, ts })` to remove the message
- **AND** returns a success result

#### Scenario: Successful deletion of a thread reply
- **WHEN** an admin calls `admin_delete_message` with a Slack permalink that includes a `thread_ts` query parameter
- **THEN** the system fetches the message from the thread's replies
- **AND** verifies ownership via `bot_id`
- **AND** calls `chat.delete({ channel, ts: messageTs })` to remove the reply
- **AND** returns a success result

#### Scenario: Message not found (not in history)
- **WHEN** an admin calls `admin_delete_message` with a URL whose message does not appear in `conversations.history` or `conversations.replies`
- **THEN** the system returns an error: message not found, noting that ephemeral messages cannot be deleted via the API

#### Scenario: Message not posted by Clack
- **WHEN** an admin calls `admin_delete_message` with a URL pointing to a message whose `bot_id` does not match Clack's bot ID
- **THEN** the system returns an error indicating the message was not posted by Clack

#### Scenario: Message already deleted
- **WHEN** `chat.delete` returns `message_not_found`
- **THEN** the system returns an error indicating the message was already deleted

#### Scenario: Bot not in channel
- **WHEN** the fetch call fails with `not_in_channel`
- **THEN** the system returns an error indicating Clack must be a member of the channel to delete messages from it

#### Scenario: Invalid URL
- **WHEN** an admin calls `admin_delete_message` with a string that is not a valid Slack permalink
- **THEN** the system returns an error indicating the URL could not be parsed as a Slack message link
