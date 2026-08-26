## 1. SDK: binary file read

- [x] 1.1 Add `readFileBuffer(path: string): Promise<Buffer | null>` to the `ClackSdk` interface in `src/plugins-sdk/sdk.ts`, documented alongside `readFile`
- [x] 1.2 Implement it in the SDK factory (`src/plugins-sdk/internal/factory.ts`), reusing the existing scoped-path resolver so traversal/absolute-path protection matches `readFile`; return `null` on `ENOENT`
- [x] 1.3 Expose it on the test-surface fake if plugin tests construct the SDK via `createClackSdk` (so a plugin test can seed a buffer); add a unit test for scoped read, missing-file `null`, and traversal rejection

## 2. Dependency

- [x] 2.1 Add `mmdb-lib` to `package.json` dependencies and install

## 3. Geolocation plugin

- [x] 3.1 Create `src/plugins/geolocation/types.ts` with the `GeoResult` shape (`ip`, `found`, `countryCode?`, `country?`, `continent?`, `continentCode?`, `isEU?`, `reason?`)
- [x] 3.2 Create `src/plugins/geolocation/lookup.ts`: a `Reader`-backed wrapper (`mmdb-lib`) that maps a DB-IP Country record to `GeoResult`, plus an IP validator using `node:net`'s `isIP`
- [x] 3.3 Create `src/plugins/geolocation/geolocate.ts`: `createGeolocateTool(deps)` returning the `geolocate_ip` tool — zod `ip` refined by `isIP`, delegates to the reader, returns `textResult`/`errorResult`; injects the reader via `deps` (giphy pattern), degraded when the reader is absent
- [x] 3.4 Create `src/plugins/geolocation/usageInstruction.ts` with the tool usage note and DB-IP CC-BY attribution string
- [x] 3.5 Create `src/plugins/geolocation/index.ts`: register the `sdk.t()` label dictionary (`label.geolocate`, en+fr), add the usage instruction, load the `.mmdb` via `sdk.readFileBuffer` once at init, and `sdk.registerTool("member", createGeolocateTool({ reader }), sdk.t("label.geolocate"))`

## 4. Wiring & data

- [x] 4.1 Register `geolocation: geolocationPlugin` in `BUILTIN_PLUGINS` (`src/plugins-core/registry.ts`)
- [x] 4.2 Add `"geolocation"` to `config.plugins` (and document it wherever plugin enablement is documented)
- [x] 4.3 Place the DB-IP Country Lite `.mmdb` at the gitignored runtime path `data/plugins/geolocation/dbip-country-lite.mmdb` (CC-BY 4.0, no MaxMind account needed). Done locally + verified end-to-end (8.8.8.8→US, 1.1.1.1→AU, IPv6→CA). The file is runtime data on the VM's persistent mount, NOT auto-mirrored by `gce-update-image.sh` — place it on the VM once via the surgical SSH-tar pattern (same as `worker-settings.json`); the plugin degrades gracefully until then.

## 5. Tests

- [x] 5.1 `lookup.test.ts` — record→`GeoResult` mapping and `isIP` validation (valid v4/v6, invalid string)
- [x] 5.2 `geolocate.test.ts` — known IP → `found: true` with country fields (seed a fake reader); private/unknown IP → `found: false` reason; invalid IP → rejected, no lookup; reader absent → error result naming the expected path
- [x] 5.3 `plugin.test.ts` — plugin registers exactly one member-tier tool, no cron, no Slack handlers; label resolves through `sdk.t()`

## 6. Verification

- [x] 6.1 `npx tsc --noEmit`, `npx oxlint src/plugins/geolocation src/plugins-sdk`, `npx oxfmt` on touched files
- [x] 6.2 `npm test` green (including the plugin-boundary guard and the new tests)
- [x] 6.3 Manual smoke: with the plugin enabled, `geolocate_ip("8.8.8.8")` returns a US country result; with the `.mmdb` removed, it returns the graceful "database not installed" result
