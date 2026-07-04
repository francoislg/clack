# Design — per-repo tester service containers

## Context

Tester runs (`kind: "test"`) execute inside the main clack container, which has no Docker access. The only backend a tested app can have today is `page.route()` mocks. The 2026-07-03 applauz-monorepo run demonstrated the cost: ~36 minutes of blind mock-shape archaeology, and structural inability to test full-stack PRs (the repo is knex + mysql2; its own test infra assumes a real throwaway MySQL).

Existing seams this design builds on:

- **Per-repo JSON config precedent**: `verification_checks.json` — zod-validated, resolved via `resolveInstructionFile`, loaded by `src/changes/verification/config.ts` with injectable deps.
- **Tester gate**: `src/changes/workflow.ts:303-324` checks sidecar reachability and claims the tester slot BEFORE acquisition; the `finally` at line 340 is the single release site.
- **Guaranteed teardown**: `executeTest`'s `finally` (`src/changes/execution.ts:730`) runs `teardownAppProcess` on every exit path.
- **Sidecar deploy precedent**: `clack-playwright` in `gce-update-image.sh` Phase 2.5 — plain `docker run` mirrored from compose, joined to the `clack` network, removed when the feature is disabled.
- **Memory model**: `gce-common.sh` — clack's container cap = total − `HOST_RESERVE_MB` − sidecar reserve; every container is hard-capped so runaways OOM inside their cgroup instead of wedging the host (2026-07-02 incident).

Constraint: every repo needs different services, so declarations must be per-repo operator data, and Clack's code/deploy must stay fully generic (worker-settings precedent).

## Goals / Non-Goals

**Goals:**

- A repo can declare the service containers its tester runs need; runs against those repos get real backends.
- Zero always-on cost per repo: services run only during a tester run.
- Deterministic memory governance: every service is hard-capped, and total service RAM is bounded by an operator-set budget that the deploy-time math reserves.
- Claude (tester or worker) never gains Docker capability; the control plane is core-code-only behind a restricted proxy.
- Fully inert when no repo declares services and when `tester.enabled` is false.

**Non-Goals:**

- Warm-keeping / idle-stop of services between runs (v1 stops them at run end; tmpfs makes stopped ≡ wiped anyway).
- Service refcounting for concurrent tester runs (v1 documents the `maxConcurrent: 1` assumption).
- Per-run scratch-database naming or seeding logic (stays in `tester_data_setup_instructions.md` and the repo's own tooling, e.g. `knex migrate`).
- Worker-mode (implement) runs getting services — tester only.
- Local-dev (docker-compose) parity automation — the compose file can be extended by hand if needed.

## Decisions

### D1: Declaration lives in `data/configuration/<repo>/tester_services.json`

Per-repo file next to `test_instructions.md` / `tester_data_setup_instructions.md`, resolved through the two-tier chain (`resolveInstructionFile`), pushed via the existing `.deploy-include` flow.

- *Alternative — keyed block in `config.json` (`tester.services: { repo: [...] }`)*: rejected; adding a repo shouldn't touch global config, and the file co-locates with the instructions that must document the DSNs anyway.
- Loader `src/tester/servicesConfig.ts` mirrors `src/changes/verification/config.ts` (zod, injectable deps) with one deliberate divergence: **absent file → `null` (no services, normal); invalid file → the run ABORTS with the formatted zod error**. `verification_checks` warns-and-nulls because a skipped verification degrades gracefully; a silently missing database wastes a 60-minute run. Reuse `zodErrorToResult` for formatting.

Schema (all fields validated):

```json
{
  "services": [
    {
      "name": "mysql",            // required, /^[a-z0-9-]+$/, unique within file
      "image": "mysql:8",         // required, must be in tester.serviceImageAllowlist
      "memoryMb": 384,            // required, positive integer
      "port": 3306,               // required, 1-65535 — readiness probe + prompt injection
      "env": { "K": "v" },        // optional, string→string
      "args": ["--flag"],         // optional container command args
      "tmpfs": ["/var/lib/mysql"] // optional tmpfs mounts — absolute container paths
    }
  ]
}
```

### D2: Control plane is `docker-socket-proxy`, consumed by core code only

`tecnativa/docker-socket-proxy` deployed in Phase 2.5 beside `clack-playwright` (same gating, same removal-when-disabled), socket mounted read-only, on the `clack` network, never port-mapped to the host. Env grants only `CONTAINERS=1`, `POST=1`, `IMAGES=1` — pull/create/start/stop/remove/inspect and nothing else (no exec, no volumes, no host introspection).

- *Alternative — raw socket mount into clack*: rejected; root-on-host adjacent to a `bypassPermissions` agent defeats the tester's reduced-privilege design.
- *Alternative — host-side supervisor (systemd + loopback API)*: rejected for v1; new host machinery vs one more container of an audited image.
- *Alternative — always-on service sidecars declared in config*: rejected; RAM taxed 24/7 × N repos, and deploy-time-only lifecycle.

Client: plain Docker Engine HTTP API over `fetch` from `src/tester/services.ts` (`POST /containers/create`, `/start`, `/stop`, `DELETE /containers/{id}`, `POST /images/create`). No `dockerode` — the five calls needed don't justify a dependency, and `fetch` keeps the boundary trivially mockable in unit tests.

Defense in depth (app level, on top of the proxy's endpoint filtering):

1. `tester.serviceImageAllowlist: string[]` — a declared image not in the list aborts the run before anything is pulled. A Home-Tab config edit alone therefore can't run an arbitrary image.
2. Code only creates/stops/removes containers named `clack-svc-*`; the derived name `clack-svc-<repo>-<name>` is never configurable.

### D3: Lifecycle is run-scoped, wired into the existing gate and release sites

In the tester gate (`workflow.ts`), AFTER `tryAcquireTesterSlot` (so the budget/ensure work is serialized by the slot and the existing `finally` cleans up on failure):

1. Load `tester_services.json` (null → skip everything, current behavior).
2. Validate image allowlist + `Σ memoryMb ≤ tester.servicesBudgetMb`; require `tester.dockerProxyUrl` (same required-at-use pattern as `sidecarUrl`).
3. `ensureServices`: per service — inspect; pull if image missing; create (`HostConfig`: `Memory`/`MemorySwap` from `memoryMb`, `Tmpfs`, `NetworkMode: "clack"`); start; TCP-probe `clack-svc-<repo>-<name>:<port>` until ready (60 s cap).
4. Any failure → typed error surfaced like `tester.sidecar_unreachable`, slot released by the existing `finally`, nothing acquired.

Teardown: `stopServices` (stop + remove) in the same `finally` as `releaseTesterSlot` — every exit path (early return, acquire failure, execution throw, timeout) already flows through it, so services can't leak for the same reason slots can't. Stop+remove (not keep-stopped) because tmpfs data dies on stop anyway and a removed container can't drift from an updated declaration.

### D4: Memory governance extends the existing reserve formula

- Each service container: hard `--memory`/`--memory-swap` = `memoryMb`.
- Proxy sidecar: fixed 64 MB cap.
- `gce-common.sh` gains `read_tester_services_budget()` (reads `tester.servicesBudgetMb` from local `config.json`, default 0, same pattern as `read_tester_enabled`); the swap-phase math becomes `CLACK_MEM_MB = TOTAL − HOST_RESERVE − (896 + 64 + BUDGET)` when tester is enabled.
- Runtime enforcement is the budget check in D3 — deploy reserves the ceiling, the gate keeps actual usage under it.
- *Alternative — reserve Σ over all repos' declarations*: rejected; wasteful, and deploy scripts shouldn't parse per-repo data files.

### D5: The tester learns about services via prompt injection, not discovery

When services were started, `buildTesterSystemPrompt` appends:

```
TEST SERVICES (already running, fresh and empty, reachable from this workspace):
- mysql → host "clack-svc-applauz-monorepo-mysql", port 3306 (mysql:8, tmpfs)
- redis → host "clack-svc-applauz-monorepo-redis", port 6379 (redis:7)
Wire the app under test to these per the repository test instructions. Do not start your own database containers.
```

Resolved services thread through `TesterPromptOptions` (like `learnedNotes`). Seeding remains the existing workflow step 5 (`tester_data_setup_instructions.md`) — migrations belong to the repo's tooling.

## Risks / Trade-offs

- **[RAM squeeze on e2-standard-2]** Budget shrinks clack's cap (e.g. 512 MB budget: ~6.6 → ~6.0 GB) while Metro-class bundlers spike inside it → Mitigation: budget is operator-set per instance; `test_instructions.md` sequencing (bundle before services boot); the run aborts cleanly on budget breach instead of OOMing the host.
- **[Socket proxy is still a privileged surface]** The proxy filters endpoints, not payloads — `POST /containers/create` passes through wholesale, and agent Bash runs in the same container/network/UID as core code, so the allowlist/prefix/cap guards (core-code-enforced) can be bypassed by an agent that reaches the proxy directly → Mitigation: the built-in worker bash guard denies commands referencing the proxy/docker port/socket (casual-access barrier, same honesty class as the git-push guard); the residual risk is documented in docs/tester-services.md as a trust-level statement; the clean fix (payload-validating control plane accepting only `clack-svc-*` creates of allowlisted images) is named follow-up work.
- **[Stale containers after a crash of clack itself]** `finally` never runs if the process dies → Mitigation: `ensureServices` starts by removing any existing `clack-svc-<repo>-*` containers (idempotent recreate), so the next run self-heals; tmpfs means no stale data either way.
- **[Image pull latency on first run]** mysql:8 is ~150 MB → Mitigation: acceptable one-time cost; pull happens before acquisition so nothing is held; document optional pre-pull in the ops docs.
- **[Concurrent runs sharing services]** Two runs of the same repo would fight over one container set → Mitigation: v1 documents the `maxConcurrent: 1` assumption; the slot gate already serializes runs globally by default.
- **[COS disk pressure]** Service images add to the 10 GB boot disk → Mitigation: existing `docker image prune -f` phases already run each deploy; allowlist keeps the image set small.

## Migration Plan

1. Ship code + deploy-script changes (inert: no repo declares services, no config keys set).
2. Add `tester.dockerProxyUrl`, `tester.servicesBudgetMb`, `tester.serviceImageAllowlist` to `config.json`; run `gce-update-image.sh` (deploys proxy, extends reserve).
3. Add `data/configuration/applauz-monorepo/tester_services.json` + real-backend section in `test_instructions.md`; push via `gce-push-config.sh`.
4. Validate with a "test this PR" run on a full-stack PR.
5. Rollback: remove the config keys and redeploy — proxy is removed (same removal path as the playwright sidecar), reserve returns to 896, declaration files become inert data.

## Open Questions

- Should `ensureServices` failures DM the run requester with the service log tail (like quarantine notifications), or is the thread error message enough for v1? (Leaning: thread error only.)
- Exact `tester.servicesBudgetMb` for the applauz instance: 512 (384 MySQL + 64 Redis + 64 slack) — confirm against observed Metro peak after the instruction fixes land.
