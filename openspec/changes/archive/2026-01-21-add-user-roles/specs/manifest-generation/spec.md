# manifest-generation Specification Delta

## Purpose

Extend manifest generation to include Home tab scopes and events for the user roles feature.

## MODIFIED Requirements

### Requirement: Manifest Generation Script

The system SHALL include Home tab scopes and events in the generated manifest.

#### Scenario: Home tab adds required scopes and events
- **GIVEN** any valid config (Home tab is always enabled for role management)
- **WHEN** the manifest is generated
- **THEN** scopes include `users:read` (for user info and disabled check)
- **AND** events include `app_home_opened`

#### Scenario: Home tab enables app home feature
- **GIVEN** any valid config
- **WHEN** the manifest is generated
- **THEN** `features.app_home.home_tab_enabled` is `true`
- **AND** `features.app_home.messages_tab_enabled` is `false`
- **AND** `features.app_home.messages_tab_read_only_enabled` is `false`
