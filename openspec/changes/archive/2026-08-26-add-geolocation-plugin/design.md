## Context

Clack plugins are isolated modules that may import only their own folder, the plugins-sdk façade, third-party packages, and node built-ins (see `src/plugins/CLAUDE.md`). The simplest live example is `giphy`: one MCP tool, a `sdk.t()` label, a usage instruction — no cron, no Slack surface. Enablement is a `BUILTIN_PLUGINS` entry plus a name in `config.plugins`.

The goal is a `geolocation` plugin that resolves an IP to a location entirely locally: a free, redistributable database read into memory once, with lookups doing zero network I/O. The one friction point is that today's plugin-scoped file API (`sdk.readFile`) returns `string | null` — it cannot carry a binary `.mmdb`, and the SDK exposes no absolute-path accessor. Per the plugin rules, the correct response is to **grow the SDK**, not bypass it with raw `node:fs` into `data/`.

## Goals / Non-Goals

**Goals:**
- A single `geolocate_ip` MCP tool returning country-level geolocation.
- Fully local, in-memory lookups: no API key, no per-lookup network call, IP never leaves the box.
- Stay 100% on the SDK surface; the plugin folder imports only its own files, the SDK façade, and npm/node built-ins.
- Graceful degradation: absent DB file or non-public IP returns a clear, non-error result — never a crash.

**Non-Goals:**
- Automatic database refresh/updates (operator/ops concern for v1).
- City-level detail, lat/lon, timezone, ASN, or reverse geocoding.
- Any cron job or Slack surface (buttons, DMs, home tab).
- A generic pluggable multi-provider abstraction — one local source only.

## Decisions

**1. Local in-memory DB-IP Country Lite over a free public API.**
Chosen for privacy (IP stays local), no rate limits, and no external dependency at call time. Alternative — a keyless free API (ip-api.com / ipwho.is) — was rejected: it sends the IP to a third party, imposes rate limits, and carries non-commercial terms on some providers. The trade is a ~few-MB binary asset and a small SDK addition.

**2. DB-IP Country Lite (CC-BY 4.0) over GeoLite2 (MaxMind).**
DB-IP Lite is redistributable with attribution, so the `.mmdb` can ship in-tree under `data/plugins/geolocation/` — zero operator setup. GeoLite2 needs a MaxMind account + EULA and forbids shipping a stale copy, which would force manual operator placement. Attribution is surfaced in the usage instruction. Country granularity keeps the file small (~few MB) and the privacy footprint minimal.

**3. `mmdb-lib` over `maxmind`.**
`mmdb-lib` exposes a pure `Reader` constructed from a `Buffer` — no filesystem coupling, so the plugin loads bytes through the SDK and hands them to the reader. `maxmind` wraps `mmdb-lib` but adds fs `open()`/watch we don't want (the SDK owns file access). IP validation uses `node:net`'s `isIP()` (returns 0/4/6) — no extra dependency.

**4. Extend the SDK with `readFileBuffer(path): Promise<Buffer | null>`.**
A raw-bytes counterpart to `readFile`, scoped to `data/plugins/<name>/` with identical path-traversal/absolute-path rejection. This is the sanctioned "grow the SDK" move rather than reaching past it with `node:fs`. It is generic and reusable by any future binary-asset plugin. Wired in `plugins-sdk/internal/factory.ts` and typed on `ClackSdk` in `plugins-sdk/sdk.ts`.

**5. Reader loaded once at init; tool reads from an in-memory closure.**
`index.ts` awaits `sdk.readFileBuffer("dbip-country-lite.mmdb")` and, if present, constructs the `Reader` and passes it into the tool factory (the giphy `deps` injection pattern). A `null` buffer leaves the reader unset; the tool then returns a clear "database not installed" `errorResult` naming the expected path. No file watching — the DB is static for the process lifetime.

**6. Tool contract.**
`geolocate_ip({ ip: string })`. `ip` is zod-validated and refined by `node:net.isIP(ip) !== 0`. On success returns `textResult({ ip, found: true, countryCode, country, continent, continentCode, isEU })`. A private/reserved/unknown IP (reader returns `null`) yields `textResult({ ip, found: false, reason })` — not an error. Description and result payloads stay English (via-Claude path); only the task-card label goes through `sdk.t()`.

## Risks / Trade-offs

- **Database staleness** → DB-IP Lite updates monthly; v1 reads whatever file is present. Mitigation: document the refresh as an operator step; a future cron-based refresh is a clean follow-up enhancement.
- **Binary asset in-repo bloat (~few MB)** → Accepted; CC-BY permits it and it removes all operator setup. Mitigation: Country (not City) DB keeps size down; the deploy script mirrors the same file it already ships from `data/`.
- **New `readFileBuffer` widens the SDK surface** → Small and generic; mirrors an existing method's scoping/traversal guards exactly, so the added surface is minimal and well-precedented.
- **Accuracy limits of a free country DB** → Acceptable for "which country is this IP" questions; explicitly out of scope to promise city precision.
- **Missing DB file at runtime** → Handled as a first-class degraded path (clear tool result), never a boot failure — the plugin loads regardless.
