## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register tools based on the user's role and current context.

#### Scenario: Member user tool set

- **WHEN** the user has the member role
- **THEN** the tool server registers query tools (`list_repositories`) and `submit_response`
- **AND** does NOT register action tools (`propose_change`, `propose_config_update`)

#### Scenario: Dev user tool set

- **GIVEN** the changes workflow is enabled for the trigger type
- **WHEN** the user has the dev role (or higher)
- **THEN** the tool server registers all query tools, `propose_change`, and `submit_response`

#### Scenario: Dev user in change thread

- **GIVEN** the current thread has an active change session with a PR
- **WHEN** the user has the dev role (or higher)
- **THEN** the tool server additionally registers `request_review`, `request_merge`, `request_update`, and `request_close`

#### Scenario: Admin user tool set

- **GIVEN** the user has the admin or owner role
- **WHEN** the tool server is built
- **THEN** it additionally registers `propose_config_update`

#### Scenario: Dev instructions include auto-execute guidance

- **GIVEN** the user has the dev role (or higher)
- **WHEN** Claude receives dev instructions
- **THEN** the instructions include guidance on when to use `auto: true` on ref-based actions
- **AND** Claude uses `auto: true` for clear directives and omits it for ambiguous intent
