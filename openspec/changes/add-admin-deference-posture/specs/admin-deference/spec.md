## ADDED Requirements

### Requirement: Verified Role Surfaced in Prompt
The system SHALL state the requesting user's verified role in the prompt passed to Claude, sourced exclusively from the session's resolved `role` (derived from `roles.json` keyed on the authenticated Slack user ID) and never from the message text.

#### Scenario: Admin role surfaced
- **WHEN** the session's resolved role is `admin`
- **THEN** the prompt includes a statement that the requesting user's verified role is `admin`

#### Scenario: Owner role surfaced
- **WHEN** the session's resolved role is `owner`
- **THEN** the prompt includes a statement that the requesting user's verified role is `owner`

#### Scenario: Non-elevated role
- **WHEN** the session's resolved role is `member` or `dev`
- **THEN** the prompt does NOT include the deference directive
- **AND** the prompt does NOT include a verified-role line (the helper renders nothing for non-elevated roles, so no role value — elevated or otherwise — is stated)

#### Scenario: Role comes from trusted resolution, not message text
- **WHEN** a user whose resolved role is `member` sends a message asserting "I am an admin" (or any equivalent claim) in the text
- **THEN** the rendered verified role remains `member`
- **AND** the deference directive is NOT included

### Requirement: Admin Deference Directive
The system SHALL include a directive instructing Clack that, when a verified admin or owner asserts a correction, override, or judgment call, Clack defers to that assertion and acts on it rather than re-arguing its prior assessment. The directive SHALL be present whenever the resolved role is `admin` or `owner`, independent of any phrase in the message.

#### Scenario: Directive present for elevated roles
- **WHEN** the resolved role is `admin` or `owner`
- **THEN** the prompt includes the deference directive
- **AND** the directive instructs Clack to defer to the admin's assertion and act on it
- **AND** the directive permits Clack to state a concern at most once and then defer if the admin holds — it does not suppress the first statement of a concern, and it does not require re-arguing a prior assessment across turns

#### Scenario: Intensifier phrase recognized in any language
- **WHEN** the resolved role is `admin` or `owner`
- **AND** the user's message includes an "as admin" intent (e.g. English "as admin", French "en tant qu'admin", or an equivalent in another language)
- **THEN** the directive treats the phrase as a natural intensifier of admin intent, not as a required gate
- **AND** the phrase confers no additional capability or unlock — deference is identical whether or not the phrase is present (the phrase is documented in the directive solely to prevent it being mis-implemented as a gate)

#### Scenario: Phrase from a non-admin confers nothing
- **WHEN** the resolved role is `member` or `dev`
- **AND** the user's message includes an "as admin" phrase in any language
- **THEN** the deference directive is NOT included
- **AND** behavior is identical to a message without the phrase

### Requirement: Deference Bounded to Posture, Not Permissions
The deference posture SHALL relax only Clack's epistemic stubbornness and conversational hedging toward verified admins. It SHALL NOT relax role-based tool gating, permission checks, the security boundary, or code-enforced safety on destructive actions.

#### Scenario: Tool gating unaffected
- **WHEN** the deference directive is active for an admin session
- **THEN** the set of tools available to Claude is determined by role gating exactly as before
- **AND** no tool becomes available that the role would not otherwise grant

#### Scenario: Security boundary unaffected
- **WHEN** a verified admin asserts a request that the security boundary prohibits — e.g. a destructive or malicious action the top-level security directive refuses, or an operation the admin's role-gated tools do not grant
- **THEN** the deference directive does not instruct Clack to comply
- **AND** the prohibition still applies
