# pinned-mcp-installs Specification

## Purpose

Replace `npx -y`-based MCP server spawning with pinned, isolated installs to eliminate npm hoisting bugs that produce partial top-level "shadow" copies of transitive dependencies. Each stdio entry in `data/mcp.json` may declare `package` + `version`; Clack installs the package into `data/mcp_packages/<name>/` with `--install-strategy=nested` (no hoisting) at boot, then spawns the resolved binary via `node`. Existing `npx`-shaped entries keep working with a one-time migration warning. HTTP/SSE entries are unaffected.
## Requirements
### Requirement: Pinned Install Schema for stdio MCP Entries

The system SHALL accept two new optional fields on stdio entries in `data/mcp.json`: `package` (the npm package name) and `version` (the exact version to install). Both fields MUST be specified together. An entry that sets one without the other is a configuration error and MUST cause boot to fail with a message identifying the entry.

#### Scenario: Both fields present

- **GIVEN** `data/mcp.json` has `"asana": { "package": "@roychri/mcp-server-asana", "version": "1.8.0", "env": { ... } }`
- **WHEN** the bot loads config
- **THEN** validation passes
- **AND** the entry is treated as pinned (the install path is used; any `command`/`args` on the same entry are ignored)

#### Scenario: `package` without `version`

- **GIVEN** `data/mcp.json` has `"asana": { "package": "@roychri/mcp-server-asana", "env": { ... } }`
- **WHEN** the bot loads config
- **THEN** boot fails with an error identifying `asana` and noting that `package` requires `version`

#### Scenario: `version` without `package`

- **GIVEN** `data/mcp.json` has `"asana": { "version": "1.8.0", "env": { ... } }`
- **WHEN** the bot loads config
- **THEN** boot fails with an error identifying `asana` and noting that `version` requires `package`

#### Scenario: HTTP/SSE entries unaffected

- **GIVEN** `data/mcp.json` has `"statsig": { "type": "http", "url": "...", "headers": { ... } }`
- **WHEN** the bot loads config
- **THEN** validation passes
- **AND** no install is attempted (HTTP/SSE entries have no `package` field and don't go through the install path)

### Requirement: Hoist-Disabled Install at Boot

The system SHALL, before the MCP test probe runs at startup, ensure each pinned stdio MCP is installed at `data/mcp_packages/<name>/` using `npm install --install-strategy=nested --prefix data/mcp_packages/<name> <package>@<version>`. Reusing an existing install is allowed only when the installed package's version exactly matches the `version` field; otherwise the install directory MUST be wiped and reinstalled.

#### Scenario: First install for a pinned entry

- **GIVEN** `data/mcp.json` has `asana` pinned to `@roychri/mcp-server-asana@1.8.0`
- **AND** `data/mcp_packages/asana/` does not exist
- **WHEN** the bot starts
- **THEN** before the MCP probe runs, `npm install --install-strategy=nested --prefix data/mcp_packages/asana @roychri/mcp-server-asana@1.8.0` is executed
- **AND** the install completes before the MCP probe is invoked

#### Scenario: Existing install with matching version is reused

- **GIVEN** `data/mcp_packages/asana/node_modules/@roychri/mcp-server-asana/package.json` reports `"version": "1.8.0"`
- **AND** `data/mcp.json` pins `asana` to version `1.8.0`
- **WHEN** the bot starts
- **THEN** no `npm install` is invoked for `asana`

#### Scenario: Version drift triggers reinstall

- **GIVEN** `data/mcp_packages/asana/node_modules/@roychri/mcp-server-asana/package.json` reports `"version": "1.7.0"`
- **AND** `data/mcp.json` pins `asana` to version `1.8.0`
- **WHEN** the bot starts
- **THEN** `data/mcp_packages/asana/` is removed
- **AND** a fresh `npm install --install-strategy=nested ... @1.8.0` runs

#### Scenario: Malformed or missing installed `package.json` is treated as drift

- **GIVEN** `data/mcp_packages/asana/node_modules/@roychri/mcp-server-asana/package.json` is missing, unreadable, not valid JSON, or has no `version` field
- **WHEN** the bot starts
- **THEN** the install is treated as mismatched
- **AND** `data/mcp_packages/asana/` is removed and reinstalled

#### Scenario: Install failure marks the MCP failed but does not crash boot

- **GIVEN** `data/mcp.json` pins `asana` to a non-existent version `99.99.99`
- **WHEN** the bot starts
- **THEN** the `npm install` call fails
- **AND** `asana` is added to the failed-MCP set surfaced via `setFailedMcpServers` (visible in the Home tab)
- **AND** the bot continues startup; other MCPs are unaffected

### Requirement: Spawn Config Resolution from Installed Binary

The system SHALL, for each pinned entry, return a spawn config of the form `{ command: "node", args: [<resolved bin path>], env: <entry.env> }`. The bin path SHALL be resolved by reading the installed package's `package.json#bin` and joining the resulting (typically relative) path against `data/mcp_packages/<name>/node_modules/<package>/`. When `bin` is a string, it SHALL be used directly. When `bin` is an object, the entry whose key matches the package's *unscoped name* SHALL be used; if no key matches, the first entry SHALL be used. The unscoped name is the part after the final `/` in a scoped package name (e.g., `@roychri/mcp-server-asana` → `mcp-server-asana`); for unscoped packages the unscoped name is the package name itself.

#### Scenario: String `bin` field

- **GIVEN** `@roychri/mcp-server-asana@1.8.0`'s `package.json#bin` is the string `"dist/index.js"`
- **WHEN** the spawn config is resolved for `asana`
- **THEN** the config is `{ command: "node", args: ["data/mcp_packages/asana/node_modules/@roychri/mcp-server-asana/dist/index.js"], env: <entry.env> }`

#### Scenario: Object `bin` field with matching unscoped name

- **GIVEN** the installed package's `bin` is `{ "mcp-server-asana": "dist/index.js", "asana-cli": "dist/cli.js" }`
- **AND** the package name is `@roychri/mcp-server-asana` (unscoped: `mcp-server-asana`)
- **WHEN** the spawn config is resolved
- **THEN** the bin entry `mcp-server-asana → dist/index.js` is used

#### Scenario: Object `bin` field without matching name falls back to first entry

- **GIVEN** the installed package's `bin` is `{ "alpha": "dist/a.js", "beta": "dist/b.js" }`
- **AND** the unscoped package name does not match either key
- **WHEN** the spawn config is resolved
- **THEN** the first entry (`alpha → dist/a.js`) is used

#### Scenario: Missing `bin` field

- **GIVEN** the installed package's `package.json` has no `bin` field
- **WHEN** the spawn config is resolved
- **THEN** an error is logged identifying the package as missing a `bin` entry
- **AND** the MCP is added to the failed-MCP set; boot continues

### Requirement: Backwards Compatibility for Non-Pinned Entries

The system SHALL preserve the existing behavior of stdio entries that do not set `package`: their `command` and `args` are passed through unchanged to the SDK. On the first boot after this change, the system SHALL log one warning per such stdio entry whose `command` is `"npx"`, suggesting migration to the pinned shape.

#### Scenario: Old npx-shaped entry continues to work

- **GIVEN** `data/mcp.json` has `"hubspot": { "command": "npx", "args": ["-y", "@hubspot/mcp-server"], "env": { ... } }`
- **WHEN** the bot starts
- **THEN** no install is attempted for `hubspot`
- **AND** the entry is passed to the SDK with its original `command` and `args`
- **AND** a one-time warning is logged: `MCP 'hubspot' uses npx — consider migrating to package/version for reliable installs`

#### Scenario: Non-npx command entry is not warned about

- **GIVEN** an stdio entry's `command` is something other than `"npx"` (e.g., a local binary path)
- **WHEN** the bot starts
- **THEN** no migration warning is logged for that entry
- **AND** the entry is passed to the SDK unchanged

#### Scenario: Migration warning fires once per process

- **GIVEN** the bot is already running with an npx-shaped `hubspot` entry that emitted the warning at startup
- **WHEN** any subsequent code path re-resolves the `hubspot` server config (e.g., a config reload)
- **THEN** no additional warning is logged for `hubspot` within the current process

### Requirement: Pinned-MCP stdio entry validation is schema-driven

`parseStdioEntry` SHALL validate a stdio MCP entry against a zod schema rather than hand-rolled `typeof` checks, while preserving its fail-fast contract: a partial pin (exactly one of `package` / `version` set) and other malformed entries SHALL still throw with an equivalent message. The discriminated pinned-vs-legacy result SHALL be unchanged.

#### Scenario: Partial pin still throws

- **WHEN** an `mcp.json` stdio entry sets `package` without `version` (or vice versa)
- **THEN** `parseStdioEntry` throws an error naming the entry, equivalent to the pre-migration message

#### Scenario: Valid pinned and legacy entries parse unchanged

- **WHEN** a fully-pinned entry (`package` + `version`) or a legacy entry is parsed
- **THEN** the returned discriminated result matches the pre-migration shape

