## ADDED Requirements

### Requirement: Isolated Geolocation Plugin

The system SHALL provide a `geolocation` plugin that registers exactly one query tool, `geolocate_ip`, at the `member` role tier. The plugin SHALL declare no cron jobs and no Slack surface (no buttons, DMs, or Home Tab sections), and SHALL import only its own folder, the plugins-sdk façade, third-party packages, and node built-ins.

#### Scenario: Plugin registers a single member-tier tool

- **WHEN** the `geolocation` plugin is loaded
- **THEN** it registers the `geolocate_ip` tool on its own MCP server (`mcp__geolocation__geolocate_ip`) at the `member` tier
- **AND** it registers no cron jobs and no Slack action or view handlers

#### Scenario: Plugin enabled via config

- **WHEN** `config.plugins` includes `"geolocation"`
- **AND** `"geolocation"` maps to the plugin function in the built-in registry
- **THEN** the plugin loads and its tool becomes available to Claude in query mode

### Requirement: IP Geolocation Tool Returns Country-Level Data

The `geolocate_ip` tool SHALL accept a single `ip` string argument and, for a public IP present in the local database, SHALL return a success result containing at least the country name and ISO country code, plus continent and European-Union membership when available. Result payloads SHALL be English (consumed by Claude), and only the tool's task-card label SHALL be resolved through `sdk.t()`.

#### Scenario: Known public IP resolves to a country

- **WHEN** Claude calls `geolocate_ip` with a public IP present in the database
- **THEN** the tool returns a success result with `found: true`
- **AND** the result includes `countryCode`, `country`, `continent`, `continentCode`, and `isEU`

### Requirement: Non-Public or Unknown IP Is Reported, Not an Error

When the supplied IP is syntactically valid but has no entry in the database (private, reserved, or unknown addresses), the tool SHALL return a success-shaped result indicating no location was found, together with a brief reason. It SHALL NOT return an error result in this case.

#### Scenario: Private IP yields a not-found result

- **WHEN** Claude calls `geolocate_ip` with a private or reserved address (e.g. `10.0.0.1`)
- **THEN** the database lookup returns no record
- **AND** the tool returns a result with `found: false` and a reason
- **AND** the tool does not return an error result

### Requirement: Invalid IP Input Is Rejected

The tool SHALL reject an `ip` argument that is not a syntactically valid IPv4 or IPv6 address before any database lookup, using the `node:net` address check.

#### Scenario: Malformed address rejected

- **WHEN** Claude calls `geolocate_ip` with a value that is not a valid IP (e.g. `"not-an-ip"`)
- **THEN** the tool rejects the input as invalid
- **AND** performs no database lookup

### Requirement: Local In-Memory Database Lookup

The plugin SHALL load its geolocation database once at initialization into an in-memory reader and SHALL perform every lookup against that reader with no per-lookup network request. The database SHALL be a local DB-IP Country Lite `.mmdb` read through the SDK's binary file API from the plugin's data directory.

#### Scenario: Database loaded once, lookups are local

- **WHEN** the plugin initializes and its database file is present
- **THEN** the plugin reads the file via `sdk.readFileBuffer` and constructs an in-memory reader once
- **AND** each `geolocate_ip` call resolves against the in-memory reader without any network I/O

### Requirement: Missing Database Degrades Gracefully

When the database file is absent at initialization, the plugin SHALL still load successfully and the `geolocate_ip` tool SHALL return an error result explaining that the database is not installed and naming the expected location. A missing database SHALL NOT crash plugin load or the bot.

#### Scenario: Absent database file

- **WHEN** the plugin initializes and `sdk.readFileBuffer` returns `null` for the database file
- **THEN** the plugin loads without error and constructs no reader
- **AND** a subsequent `geolocate_ip` call returns an error result stating the database must be installed and where it is expected
