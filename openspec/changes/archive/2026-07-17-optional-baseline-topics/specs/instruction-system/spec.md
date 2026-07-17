## MODIFIED Requirements

### Requirement: Default Configuration Directory

The system SHALL ship default instruction files in role directories under `data/default_configuration/`. Slack rendering guidance (Block Kit formatting, Slack formatting, response style, rich submit-response composition) SHALL ship under the built-in topic folder `user/topics/response-rendering/` rather than as baseline files; the baseline `user/submit-response.md` SHALL be the contract stub defined by the `builtin-topics` capability.

#### Scenario: Default files included in repository
- **WHEN** the project is checked out
- **THEN** `data/default_configuration/user/` exists with baseline files (identity, submit-response contract stub, URLs, changes)
- **AND** `data/default_configuration/user/topics/response-rendering/` exists with the rendering-guidance files (Block Kit formatting, Slack formatting, response style, rich submit-response guidance)
- **AND** `data/default_configuration/dev/` exists with topic files (GitHub, changes)
- **AND** `data/default_configuration/admin/` exists with topic files (config updates)

#### Scenario: Default files copied to Docker image
- **WHEN** the Docker image is built
- **THEN** the `data/default_configuration/` directory including all role subdirectories is included in the image

#### Scenario: Re-homed operator override wins over shipped topic default
- **GIVEN** an operator override of a moved file re-homed at `data/configuration/user/topics/response-rendering/block-kit-formatting.md`
- **WHEN** a session with `response-rendering` attached assembles its prompt
- **THEN** the cascade resolver loads the operator's version in preference to the shipped file at `data/default_configuration/user/topics/response-rendering/block-kit-formatting.md`
