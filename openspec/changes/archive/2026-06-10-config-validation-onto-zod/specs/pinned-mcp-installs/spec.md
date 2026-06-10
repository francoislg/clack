## ADDED Requirements

### Requirement: Pinned-MCP stdio entry validation is schema-driven

`parseStdioEntry` SHALL validate a stdio MCP entry against a zod schema rather than hand-rolled `typeof` checks, while preserving its fail-fast contract: a partial pin (exactly one of `package` / `version` set) and other malformed entries SHALL still throw with an equivalent message. The discriminated pinned-vs-legacy result SHALL be unchanged.

#### Scenario: Partial pin still throws

- **WHEN** an `mcp.json` stdio entry sets `package` without `version` (or vice versa)
- **THEN** `parseStdioEntry` throws an error naming the entry, equivalent to the pre-migration message

#### Scenario: Valid pinned and legacy entries parse unchanged

- **WHEN** a fully-pinned entry (`package` + `version`) or a legacy entry is parsed
- **THEN** the returned discriminated result matches the pre-migration shape
