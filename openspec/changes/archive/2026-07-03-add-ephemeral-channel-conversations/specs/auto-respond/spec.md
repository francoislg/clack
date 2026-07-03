# auto-respond (delta)

## MODIFIED Requirements

### Requirement: Auto-Respond Rule Persistence

The system SHALL persist standing auto-respond rules in `data/state/auto-respond.json` and ephemeral rules in `data/state/auto-respond-ephemeral.json`, with in-memory caching. `loadRules()` SHALL merge both sources (ephemeral first). Both readers SHALL be graceful/permissive zod loaders.

#### Scenario: Rule file structure
- **WHEN** rules are saved
- **THEN** the standing file contains a JSON object with a `rules` array
- **AND** each standing rule has: `id` (string), `channels` (string[]), `userFilters` (string[], optional), `keywords` (string[], optional), `extraContext` (string, optional), `preAnalysisContext` (string, optional), `enabled` (boolean)
- **AND** each ephemeral rule additionally has `kind: "ephemeral"`, `expiresAt` (number), `attentionLevel`, `sessionIds` (string[]), `anchorText` (string), and optionally `followUpContext` (string)

#### Scenario: Load rules on first access
- **WHEN** rules are accessed for the first time
- **THEN** the system reads both `data/state/auto-respond.json` and `data/state/auto-respond-ephemeral.json`
- **AND** caches the merged result in memory
- **AND** returns an empty rules array if neither file exists

#### Scenario: Persist rules on change
- **WHEN** a rule is created, updated, or deleted
- **THEN** the system writes the updated rules to the file matching the rule's kind
- **AND** updates the in-memory cache

#### Scenario: Concurrent rule modifications
- **WHEN** two admins modify rules simultaneously
- **THEN** last-write-wins semantics apply
- **AND** each file is always valid JSON (no partial writes or corruption)

#### Scenario: Rollback safety
- **WHEN** a pre-change binary runs against state written by this change
- **THEN** it reads only `auto-respond.json` and never observes ephemeral rules
- **AND** no ephemeral rule can act as a standing match-everything channel rule

#### Scenario: Per-file corruption isolation
- **WHEN** one of the two files is corrupt or unparseable and the other is valid
- **THEN** `loadRules()` returns the valid file's rules, logs the failure, and treats the corrupt file as empty (graceful reader — never throws, never wipes the valid file)

### Requirement: Auto-Respond Rule Matching

The system SHALL evaluate incoming messages against active auto-respond rules, filtering out non-message events and triggering on the first matching rule only. Ephemeral rules SHALL be evaluated before standing rules, and at most one rule fires per message.

#### Scenario: Match by channel only (no user filters)
- **WHEN** a top-level message arrives in a channel that matches a rule with no `userFilters`
- **AND** the rule is enabled
- **THEN** the system triggers a response (subject to pre-analysis if configured)

#### Scenario: Match by channel and user filter
- **WHEN** a top-level message arrives in a channel that matches a rule with `userFilters`
- **AND** the message author's `user` is in `userFilters`
- **AND** the rule is enabled
- **THEN** the system triggers a response (subject to pre-analysis if configured)

#### Scenario: No match when user filter excludes author
- **WHEN** a message arrives in a channel that matches a rule with `userFilters`
- **AND** the message author's `user` is not in `userFilters`
- **THEN** the system does NOT trigger a response

#### Scenario: Disabled rule does not match
- **WHEN** a message arrives in a channel that matches a disabled rule
- **THEN** the system does NOT trigger a response

#### Scenario: Ignore own messages
- **WHEN** a message is posted by Clack itself (matching the bot's own user ID)
- **THEN** the system does NOT trigger a response regardless of rules

#### Scenario: Ignore message subtypes
- **WHEN** a message event has a subtype (e.g., `message_changed`, `message_deleted`, `channel_join`, `bot_message`)
- **THEN** the system does NOT trigger a response
- **AND** only messages with no subtype (regular new messages) are evaluated against rules

#### Scenario: Thread replies bypass rule matching
- **WHEN** a message event has a `thread_ts` field (indicating it is a reply in a thread)
- **THEN** the system does NOT evaluate the message against auto-respond rules
- **AND** instead follows the thread auto-respond path (session-based, see Thread Auto-Respond requirement)

#### Scenario: First matching rule wins
- **WHEN** a message matches multiple active rules (e.g., one channel-only rule and one channel+user rule)
- **THEN** the system triggers exactly one response
- **AND** stops evaluating further rules after the first match

#### Scenario: Ephemeral rule outranks standing rule
- **WHEN** a top-level message arrives in a channel that has both an ephemeral rule and a matching standing rule
- **THEN** the ephemeral rule is evaluated first (through the channel-continuation judge)
- **AND** the standing rule is only evaluated if no ephemeral rule exists for the channel (including when the ephemeral rule was just deleted by its own verdict handling for this message)

#### Scenario: Ephemeral match routes to continuation
- **WHEN** an ephemeral rule's judge returns `respond`
- **THEN** the system routes the message through the anchor-session continuation path (see `ephemeral-channel-conversations`) instead of spawning a fresh session

#### Scenario: No deduplication of similar messages
- **WHEN** multiple messages in the same channel match the same rule within a short time window (e.g., Sentry posting the same error 10 times)
- **THEN** each message triggers an independent response
- **AND** no deduplication is applied (deduplication is explicitly out of scope for v1)
