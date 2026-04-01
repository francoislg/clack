# admin-env-tools Specification

## Purpose
Secure environment variable management tools that allow admins to set, delete, and list env var keys without ever exposing secret values.

## Requirements

### Requirement: admin_set_env Tool

The system SHALL provide an `admin_set_env` tool that creates, updates, or deletes a single environment variable in `data/auth/.env`.

#### Scenario: Set a new env var
- **WHEN** Claude calls `admin_set_env` with `key` and a non-empty `value`
- **AND** the key does not exist in `.env`
- **THEN** the tool appends `KEY=value` to the file
- **AND** returns confirmation that the key was added

#### Scenario: Update an existing env var
- **WHEN** Claude calls `admin_set_env` with `key` and a non-empty `value`
- **AND** the key already exists in `.env`
- **THEN** the tool replaces the existing line with the new value
- **AND** preserves all other lines, comments, and ordering
- **AND** returns confirmation that the key was updated

#### Scenario: Delete an env var by setting empty value
- **WHEN** Claude calls `admin_set_env` with `key` and an empty or omitted `value`
- **AND** the key exists in `.env`
- **THEN** the tool removes the line for that key
- **AND** returns confirmation that the key was deleted

#### Scenario: Delete non-existent key
- **WHEN** Claude calls `admin_set_env` with `key` and an empty or omitted `value`
- **AND** the key does not exist in `.env`
- **THEN** the tool returns a message indicating the key was not found (no error)

#### Scenario: Reject invalid key format
- **WHEN** Claude calls `admin_set_env` with a key that does not match `[A-Z][A-Z0-9_]*`
- **THEN** the tool returns an error indicating the key format is invalid

#### Scenario: Create .env file if missing
- **WHEN** Claude calls `admin_set_env` with a valid key and value
- **AND** `data/auth/.env` does not exist
- **THEN** the tool creates the file and writes the key-value pair

#### Scenario: Value never returned
- **WHEN** `admin_set_env` completes (set, update, or delete)
- **THEN** the tool response MUST NOT include the value that was set
- **AND** MUST NOT include any other values from the `.env` file

### Requirement: admin_list_env Tool

The system SHALL provide an `admin_list_env` tool that returns the names of configured environment variables without their values.

#### Scenario: List configured keys
- **WHEN** Claude calls `admin_list_env`
- **THEN** the tool returns an array of key names from `data/auth/.env`
- **AND** does NOT include values, only key names
- **AND** excludes comment lines and empty lines

#### Scenario: Empty or missing .env
- **WHEN** Claude calls `admin_list_env`
- **AND** `data/auth/.env` does not exist or contains no key-value pairs
- **THEN** the tool returns an empty array

### Requirement: Tool Role Gating

The system SHALL gate env tools to users with the admin or owner role.

#### Scenario: Admin can use env tools
- **WHEN** the tool server is built for a user with admin or owner role
- **THEN** `admin_set_env` and `admin_list_env` are registered

#### Scenario: Non-admin cannot use env tools
- **WHEN** the tool server is built for a user with member or dev role
- **THEN** `admin_set_env` and `admin_list_env` are NOT registered
