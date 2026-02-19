## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register tools based on the user's role, current context, and invocation mode.

#### Scenario: Admin user tool set

- **GIVEN** the user has the admin or owner role
- **WHEN** the tool server is built in query mode
- **THEN** it additionally registers `propose_config_update`, `list_config_files`, and `read_config_file`
