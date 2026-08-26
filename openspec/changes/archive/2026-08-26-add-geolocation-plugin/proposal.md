## Why

Claude has no way to turn an IP address into a location when a user asks "where is this IP from?". A small, isolated plugin closes that gap using a free, local, in-memory database — no API keys, no per-lookup network calls, and no IP ever leaving the deployment.

## What Changes

- Add a new isolated `geolocation` plugin (`src/plugins/geolocation/`) modeled on `giphy`: a single MCP tool, a `sdk.t()` label, a usage instruction. No cron, no Slack surface.
- Register a `geolocate_ip` query tool (member tier) that validates an IP and returns country-level geolocation from an in-memory reader.
- Data source is a local **DB-IP Country Lite** `.mmdb` (CC-BY 4.0), loaded once at plugin init into an in-memory `mmdb-lib` `Reader`. The CC-BY license lets the file ship in-tree under `data/plugins/geolocation/`; a missing file degrades gracefully (tool returns a clear "admin: install the DB" result).
- Add one dependency: `mmdb-lib` (pure `Buffer` → `Reader`, no filesystem coupling). IP validation uses the `node:net` built-in — no extra dependency.
- Wire the plugin into the built-in registry (`src/plugins-core/registry.ts`) and enable it via `config.plugins`.
- **Extend the plugin SDK** with `sdk.readFileBuffer(path): Promise<Buffer | null>` — a raw-bytes counterpart to the text-only `sdk.readFile`, scoped to `data/plugins/<name>/` with the same path-traversal protection. Required to load a binary `.mmdb` through the SDK boundary rather than reaching past it with raw `node:fs`; reusable by any future binary-asset plugin.

## Capabilities

### New Capabilities
- `geolocation-plugin`: an isolated plugin exposing the `geolocate_ip` MCP tool that resolves a public IP to country-level location data from a local in-memory database, degrading gracefully when the database file is absent or the IP is non-public.

### Modified Capabilities
- `clack-plugins`: the plugin-scoped file API gains `sdk.readFileBuffer(path)` for reading binary plugin-data assets as a `Buffer`, alongside the existing text `readFile`/`writeFile`/`readFileOrSeed`.

## Impact

- **New code**: `src/plugins/geolocation/**` (index, tool, lookup/reader wrapper, types, usage instruction, tests).
- **Core touch points** (small, expected): `src/plugins-core/registry.ts` (registry entry), the plugin SDK surface (`src/plugins-sdk/sdk.ts` + `plugins-sdk/internal/**` factory wiring for `readFileBuffer`), and `config.plugins` to enable it.
- **New dependency**: `mmdb-lib`.
- **Data**: a `dbip-country-lite.mmdb` under `data/plugins/geolocation/` (shipped in-tree under CC-BY; deploy script mirrors it to the VM).
- **Non-goals (v1)**: automatic monthly DB refresh, city/lat-lon granularity, reverse geocoding, and any cron or Slack surface.
