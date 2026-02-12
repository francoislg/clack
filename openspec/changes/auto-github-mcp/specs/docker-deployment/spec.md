## ADDED Requirements

### Requirement: GitHub MCP Server Binary

The system SHALL include the `github-mcp-server` binary in the Docker image.

#### Scenario: Binary installed during Docker build
- **WHEN** the Docker image is built
- **THEN** the `github-mcp-server` static binary is downloaded from the official GitHub releases
- **AND** installed to `/usr/local/bin/github-mcp-server`
- **AND** the version is controlled by a build arg `GITHUB_MCP_SERVER_VERSION`

#### Scenario: Binary works on Alpine
- **WHEN** the binary is downloaded
- **THEN** it is the `Linux_x86_64` variant (statically compiled, no glibc dependency)
- **AND** it runs correctly on the `node:18-alpine` base image
