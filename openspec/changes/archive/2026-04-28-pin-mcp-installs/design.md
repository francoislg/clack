## Context

`data/mcp.json` declares external MCP servers. stdio entries today look like:

```json
"asana": {
  "command": "npx",
  "args": ["-y", "@roychri/mcp-server-asana"],
  "env": { "ASANA_ACCESS_TOKEN": "${ASANA_ACCESS_TOKEN}" }
}
```

`npx -y` resolves the package against a per-package npx cache directory at `data/.npm/_npx/<hash>/node_modules/`. For dependency trees that share a transitive package across multiple ancestors at overlapping version ranges (e.g., `html-encoding-sniffer` + `jsdom` both pulling `@exodus/bytes`), npm 10.9.7 writes a top-level "shadow" stub at `node_modules/<pkg>/` with only a partial file set and an empty `{}` entry in `.package-lock.json`. The full working install ends up nested deeper in the tree. Node's resolver hits the broken top-level copy first, so spawn crashes with `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND`.

This is reproducible across cache wipes — the same `npx -y` on the same packages produces the same broken layout. It's a function of the dependency tree shape, not transient corruption.

## Goals / Non-Goals

**Goals:**
- Asana and Sentry MCP servers spawn reliably on every attach.
- Operators can pin an exact version per stdio MCP and trust the install across restarts and cache wipes.
- Existing `npx`-shaped `data/mcp.json` entries keep working without edits.

**Non-Goals:**
- First-boot UX, install latency, npm registry availability — out of scope per user direction.
- Auto-migration of existing `mcp.json` entries — operators opt in by editing.
- Pre-warming/pooling MCP processes — that's a separate design conversation.
- Replacing `npx -y` for HTTP/SSE entries (they don't install anything).
- Surfacing install state in the Home tab beyond what `setFailedMcpServers` already covers.

## Decisions

### Schema: add `package` + `version` to stdio entries

When both `package` and `version` are set on a stdio entry, clack ignores any `command`/`args` and uses the pinned-install path. Both must be present together — partial pins are a config error.

**Why both required:**
A pin without a version is just `npx -y` with extra steps. The whole point is determinism.

**Alternative considered:** auto-detect intent from the existing `args` (e.g., `args: ["-y", "@foo"]` → install `@foo` at latest). Rejected — silently changes behavior on existing entries.

### Install command: `npm install --install-strategy=nested --prefix data/mcp_packages/<name>`

`--install-strategy=nested` disables hoisting entirely. Every transitive dep gets its own `node_modules`. This eliminates the bug class.

**Alternatives considered:**
- `pnpm dlx` — sidesteps the bug but adds a new tool to the container and ties install determinism to pnpm's content-addressable store, which behaves differently across versions.
- `--install-strategy=shallow` — only direct deps at the top. Doesn't disable hoisting for transitives, so the bug can still appear on the tail of a tree.
- `overrides` per package — surgical and fragile. Each MCP would need bespoke overrides researched against its current dep tree.

`nested` is the smallest hammer that makes the bug structurally impossible.

### Install location: `data/mcp_packages/<name>/`

Mirrors how `data/.npm/_npx/` already works — under the volume-mounted `data/` directory, gitignored, persists across container restarts. One subdirectory per MCP name keeps trees isolated.

**Alternative considered:** a single shared `data/mcp_packages/node_modules/` with a top-level `package.json`. Rejected — shared install means the hoisting bug can return across MCPs.

### Binary resolution: read `package.json#bin` from the installed package

After install, clack reads `data/mcp_packages/<name>/node_modules/<package>/package.json` and resolves the `bin` field. If `bin` is a string, that's the binary path. If it's an object with multiple entries, clack uses the entry whose key matches the package's unscoped name (e.g., `mcp-server-asana` for `@roychri/mcp-server-asana`); failing that, the first entry. The spawn config becomes `command: "node"`, `args: [<resolved bin path>]`.

**Alternative considered:** require operators to specify the binary path explicitly in `mcp.json`. Rejected — adds boilerplate per server and breaks when upstream renames the bin field.

### Backwards compat: old shape works, warns once

Entries without `package` keep their existing `command`/`args` and spawn unchanged. On the first boot after this lands, clack logs one warning per such stdio entry: `MCP '<name>' uses npx — consider migrating to package/version for reliable installs`. Subsequent boots stay quiet (memoized in process memory; not persisted).

**Why opt-in:** the user explicitly wants no forced cutover. Existing servers that work fine (metabase, hubspot, gcp-observability) shouldn't be touched until the operator chooses.

### Version drift: reinstall when `version` field changes

On every boot, before `testMCP`, clack reads `data/mcp_packages/<name>/node_modules/<package>/package.json#version` and compares to `mcp.json`. Mismatch triggers a reinstall. Match means skip — the directory is reused as-is.

**Why not always reinstall:** we explicitly don't care about install latency, but we also gain nothing by burning network on every restart. Skip-when-matched is cheap and obvious.

**No checksum/integrity check:** out of scope. If an operator wants to nuke and rebuild, `rm -rf data/mcp_packages/<name>` on the next boot reinstalls cleanly.

## Risks / Trade-offs

- **Disk growth.** Nested installs duplicate transitive deps across MCPs. Each MCP install is ~50–200 MB. The current `data/.npm/_npx/` cache is comparable; net cost is similar, but it grows linearly with the number of pinned MCPs.
  → Mitigation: documented; operator can `rm -rf` per-MCP install dirs to reclaim space.

- **Version pinning becomes operator responsibility.** With `npx -y`, operators implicitly tracked latest. With pins, an operator who never bumps `version` may miss security fixes upstream.
  → Mitigation: out of scope for this change; tracked as future work (an "update available" signal in the Home tab is plausible later).

- **Install errors at boot become visible failures.** A wrong `package` name, a yanked `version`, or a network blip during `npm install` means the MCP doesn't come up. With `npx`, the failure was deferred to first attach.
  → Mitigation: install errors are logged and the MCP is marked failed via the existing `setFailedMcpServers` mechanism, surfacing in the Home tab. The bot keeps starting; other MCPs are unaffected.

- **`bin` field ambiguity.** Some packages publish multiple binaries; picking the wrong one is silent breakage.
  → Mitigation: documented resolution rule (match by unscoped package name, fall back to first entry); validated by tests against the asana and sentry packages.
