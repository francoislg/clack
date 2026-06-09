## 1. Active-runs registry: start time + snapshot

- [x] 1.1 Add a `startedAt` timestamp to each registry entry in `src/slack/activeRuns.ts` (stamped at `register()` time)
- [x] 1.2 Add a `snapshot()` accessor returning `{ count, runs: [{ channel, thread, status, ageMs }] }`, reading `status` from the handle and deriving `ageMs` from `startedAt`; leave `size()` and routing untouched
- [x] 1.3 Unit-test `snapshot()` with `vi.useFakeTimers()`: empty registry, one/many active runs, `ageMs` advances, and stale entries are reported but NOT evicted

## 2. Active-changes (worker) snapshot — cross-mode

- [x] 2.1 Add an accessor in `src/changes/activeState.ts` that snapshots in-flight Changes-Workflow runs whose `handle?.status === "running"` → `{ active: number, changes: [{ repo, branch, status, ageMs }] }` (derive `ageMs` from `startedAt`); this is mode-independent (works in disposable AND reusable)
- [x] 2.2 Optionally read `getWorkerPoolSnapshot()` for supplementary reusable-pool busy/idle detail; do NOT use it as the `active` source (empty in disposable mode)
- [x] 2.3 Unit-test the accessor: no changes → `active:0`; a change with a running handle → counted with age; a change at `pr_created` with no running handle → NOT counted

## 3. Status HTTP server

- [x] 3.1 Create a status-server module that starts `http.createServer` bound to `127.0.0.1` on a configurable port (env/config `STATUS_PORT`, default `8787`)
- [x] 3.2 Implement `GET /status` returning `{ version, uptimeSec, activeRuns, workers, busy }` computed live from `activeRuns.snapshot()` + the active-changes snapshot; `version` sourced from the root `package.json` `version` (read once at boot); `uptimeSec` from `process.uptime()`; `busy = activeRuns.count > 0 || workers.active > 0`; return 404 for other paths
- [x] 3.3 Wire the server into the boot sequence (`src/index.ts`); make start failure logged and non-fatal to the bot
- [x] 3.4 Unit-test the handler: idle → `busy:false`; active run present → counted with age + `busy:true`; busy worker → `busy:true`; per-request recomputation

## 4. Deploy script: port publish + drain gate

- [x] 4.1 Add `-p 127.0.0.1:${STATUS_PORT}:${STATUS_PORT}` to the `docker run` in `scripts/gce-update-image.sh`
- [x] 4.2 Add a drain phase before the swap (Phase 1.5): poll `GET /status` every ~5s via `docker exec clack node` (no host curl/jq dependency); proceed on `busy:false`; print `(N runs, M workers) waiting…` while busy; on `maxWait` (~5m) print still-active counts and proceed anyway
- [x] 4.3 Handle status-unreachable (older image / no endpoint): log "drain check skipped" and proceed with the swap
- [x] 4.4 Emit clearly-grepable drain markers (e.g. `Draining`, `(N runs`, `Bot idle — proceeding`) for the skill's Monitor filter

## 5. Deploy skill update

- [x] 5.1 Add the drain markers to the Monitor `grep` filter in `.claude/skills/deploy/SKILL.md` (Step 2)
- [x] 5.2 Add a Step 3 phase-acknowledgement row for the drain phase (e.g. `Draining` → `Draining active runs.`)
- [x] 5.3 Note the drain gate in the skill description/phase list and failure modes (a long drain wait is expected, not a hang)

## 6. Verify

- [x] 6.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` on touched files; `npm test` green
- [x] 6.2 Local smoke: started the real status server on a loopback test port and did a live HTTP `GET /status` → 200 with the spec payload (`busy:false`, empty `activeRuns`/`workers`, `version`, `uptimeSec`); non-`/status` path → 404
