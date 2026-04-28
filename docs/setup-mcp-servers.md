# MCP Server Setup

Clack supports two shapes for stdio MCP servers in `data/mcp.json`: **pinned** (recommended) and **legacy npx** (still works, warns once at boot).

## Pinned shape (recommended)

```json
"asana": {
  "package": "@roychri/mcp-server-asana",
  "version": "1.8.0",
  "env": { "ASANA_ACCESS_TOKEN": "${ASANA_ACCESS_TOKEN}" }
}
```

Both `package` and `version` are required together. At boot, Clack runs:

```
npm install --install-strategy=nested --prefix data/mcp_packages/<name> <package>@<version>
```

Then spawns the binary directly via `node`, bypassing `npx`. The `--install-strategy=nested` flag disables npm's flat hoisting, which sidesteps a class of bugs where multiple ancestors in a dep tree request the same transitive package at overlapping ranges and npm produces a partial top-level "shadow" install that breaks the spawn.

### Where files go

`data/mcp_packages/<name>/` — one subdirectory per pinned MCP, with its own `node_modules` tree and `package-lock.json`. The directory is gitignored and lives under the volume-mounted `data/` dir, so it persists across container restarts.

### Bumping a version

Edit `version` in `data/mcp.json` and restart. Clack reads `<install-dir>/node_modules/<package>/package.json#version`, sees the mismatch, wipes `data/mcp_packages/<name>/`, and reinstalls.

### Forcing a clean reinstall

```
rm -rf data/mcp_packages/<name>
```

Next restart triggers a fresh install.

### Install failures

A failed install (wrong package name, yanked version, network blip) does not crash boot. The MCP is added to the failed set and surfaces in the Home tab; other MCPs are unaffected. Check container logs for the npm error.

## Legacy npx shape

```json
"hubspot": {
  "command": "npx",
  "args": ["-y", "@hubspot/mcp-server"],
  "env": { "PRIVATE_APP_ACCESS_TOKEN": "${HUBSPOT_ACCESS_TOKEN}" }
}
```

Still works. At boot, Clack logs once per server: `MCP '<name>' uses npx — consider migrating to package/version for reliable installs`. Migrate when you see this — the `npx -y` cache is shared at `data/.npm/_npx/<hash>/` and is the source of the hoisting bug that motivated pinned installs.

## HTTP/SSE shape

```json
"statsig": {
  "type": "http",
  "url": "https://api.statsig.com/v1/mcp",
  "headers": { "statsig-api-key": "${STATSIG_CONSOLE_API_KEY}" }
}
```

No install path. Pass through to the SDK unchanged.

## Validation

If `package` is set without `version` (or vice versa), boot fails fast with a clear error identifying the entry. A partial pin is a config error, not a fallback.
