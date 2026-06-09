## ADDED Requirements

### Requirement: Admin-Claim Keyword Detection
The system SHALL detect when the user's latest message explicitly invokes admin authority via a fixed, case-insensitive keyword list: `"as an admin"`, `"as admin"`, `"en tant qu'admin"`, `"je suis admin"`, `"admin:"`. Detection SHALL key on the user's most recent message only (the latest continuation in a resumed session, otherwise the trigger text), not on earlier thread context. Curly apostrophes SHALL be normalized so the French keyword matches regardless of quote style.

#### Scenario: Keyword present in the latest message
- **WHEN** the user's latest message contains any admin-claim keyword (any letter case)
- **THEN** the admin-claim context is rendered (branch determined by the verified role)

#### Scenario: No keyword present
- **WHEN** the user's latest message contains none of the keywords
- **THEN** no admin-claim context is rendered, regardless of the user's role

#### Scenario: Keyword only in an earlier message (no stale latch)
- **WHEN** an admin-claim keyword appears only in an earlier message of the thread (e.g. the original trigger of a resumed session) and the user's latest message has none
- **THEN** no admin-claim context is rendered — detection does not latch onto stale text

### Requirement: Verified-Admin Deference on Claim
The system SHALL, when the user's latest message invokes an admin-claim keyword AND the verified role (resolved from `roles.json` keyed on the authenticated Slack user ID) is `admin` or `owner`, render a deference directive stating the verified role and instructing Clack to act on the admin's asserted correction/override rather than re-arguing. The directive SHALL permit stating a concern at most once and SHALL NOT relax tool/permission gating, the security boundary, or destructive-action safety.

#### Scenario: Admin invokes the keyword
- **WHEN** the verified role is `admin` (or `owner`) AND the latest message contains an admin-claim keyword
- **THEN** the prompt includes the verified-role line and the deference directive
- **AND** the directive permits stating a concern once, then deferring — it does not re-argue across turns
- **AND** the directive states it does NOT relax tool/permission gating, the security boundary, or destructive-action safety

#### Scenario: Admin does not invoke the keyword
- **WHEN** the verified role is `admin` (or `owner`) AND the latest message contains no keyword
- **THEN** the prompt includes NO verified-role line and NO deference directive (the posture is gated, not always-on)

### Requirement: Non-Admin Claim Rebuttal
The system SHALL, when the user's latest message invokes an admin-claim keyword AND the verified role is `member` or `dev`, render a not-verified context stating the user is NOT an admin and that the claim confers no authority. The context SHALL instruct Clack to refuse admin deference and admin-gated actions on the basis of the claim and to otherwise handle the message on its own merits, without requiring Clack to call out the claim. The trust boundary is structural: the branch is decided by the verified role, never by the message text.

#### Scenario: Non-admin invokes the keyword
- **WHEN** the verified role is `member` (or `dev`) AND the latest message contains an admin-claim keyword
- **THEN** the prompt includes a not-verified context naming the user's actual role and stating they are NOT an admin
- **AND** the context instructs Clack not to grant admin deference and not to action admin-gated requests on the basis of the claim
- **AND** the prompt includes NO deference directive

#### Scenario: Claim from a non-admin confers nothing
- **WHEN** a `member` types an admin-claim keyword
- **THEN** the rendered role is `member` and behavior toward admin-gated requests is unchanged from a message with no claim (the keyword grants no authority)

#### Scenario: System/automated context
- **WHEN** the role is `system` or absent (e.g. a scheduled run with no interactive user)
- **THEN** no admin-claim context is rendered, even if a keyword coincidentally appears in the text

### Requirement: Deference Bounded to Posture, Not Permissions
The admin-claim context SHALL be prompt text only. It SHALL NOT alter role-based tool gating, permission checks, the security boundary, or code-enforced safety on destructive actions.

#### Scenario: Tool gating unaffected
- **WHEN** the deference directive is active for an admin session
- **THEN** the set of tools available to Claude is determined by role gating exactly as before
- **AND** no tool becomes available that the role would not otherwise grant

#### Scenario: Security boundary unaffected
- **WHEN** a verified admin asserts a request that the security boundary prohibits — e.g. a destructive or malicious action the top-level security directive refuses, or an operation the admin's role-gated tools do not grant
- **THEN** the deference directive does not instruct Clack to comply
- **AND** the prohibition still applies
