## ADDED Requirements

### Requirement: Plugin-Scoped Binary File Read

The `ClackSdk` interface SHALL expose `readFileBuffer(path: string): Promise<Buffer | null>`, a raw-bytes counterpart to `readFile`. The path SHALL resolve relative to the plugin's data directory (`data/plugins/{pluginName}/`) with the same path-traversal and absolute-path protection as `readFile`/`writeFile`. It SHALL return the file's bytes as a `Buffer`, or `null` when the file does not exist. This enables plugins to load binary data assets (e.g. a `.mmdb` database) through the SDK boundary instead of reaching past it with raw `node:fs`.

#### Scenario: readFileBuffer scoped to plugin data directory

- **WHEN** a plugin calls `sdk.readFileBuffer("dbip-country-lite.mmdb")`
- **THEN** the SDK resolves the path to `data/plugins/{pluginName}/dbip-country-lite.mmdb`
- **AND** returns the file content as a `Buffer`

#### Scenario: readFileBuffer returns null for a missing file

- **WHEN** a plugin calls `sdk.readFileBuffer("missing.mmdb")`
- **AND** the file does not exist
- **THEN** the SDK returns `null`
- **AND** does not throw

#### Scenario: readFileBuffer rejects path traversal

- **WHEN** a plugin calls `sdk.readFileBuffer("../other-plugin/data.mmdb")`
- **THEN** the SDK rejects the call with an error
- **AND** does not access files outside the plugin's data directory
