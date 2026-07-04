# Add per-repo tester service containers (tester-services)

## Why

Tester runs have no backend: the sandbox has no Docker access, so apps that need MySQL/Redis (e.g. applauz-monorepo) can only be tested against hand-built `page.route()` mocks — a failed 60-minute run showed that mocking a large app's API surface blind is the tester's single biggest time sink, and full-stack PRs can't be meaningfully tested at all. Every repo needs different services, so the fix must be per-repo data, not more hardcoded sidecars.

## What Changes

- New per-repo declaration file `data/configuration/<repo>/tester_services.json` (zod-validated, resolved through the existing two-tier instruction chain) listing service containers: `name`, `image`, mandatory `memoryMb`, `port`, `env`, `args`, `tmpfs`.
- New `docker-socket-proxy` control-plane sidecar (deployed by `gce-update-image.sh` beside `clack-playwright`, gated by the same `tester.enabled`) exposing only container pull/create/start/stop/remove/inspect to core code. Claude never gets a docker-facing tool.
- Tester run lifecycle ensures declared services before worktree acquisition (pull → create with memory caps + tmpfs on the `clack` network as `clack-svc-<repo>-<name>` → start → TCP readiness probe) and stops/removes them on every exit path, beside the existing slot release.
- Guard rails: `tester.serviceImageAllowlist` (run aborts if a declared image isn't listed), `tester.servicesBudgetMb` (run aborts if Σ `memoryMb` exceeds it), container-name prefix enforcement (`clack-svc-` only).
- Deploy memory math extends the sidecar reserve: `896 + servicesBudgetMb + proxy reserve` when tester is enabled.
- Tester prompt gains a TEST SERVICES section (resolved host/port per service) when services were started; seeding stays in `tester_data_setup_instructions.md`.
- New `tester` config keys: `dockerProxyUrl`, `servicesBudgetMb`, `serviceImageAllowlist` (all optional; feature fully inert when no repo declares services).

## Capabilities

### New Capabilities

- `tester-services`: per-repo service containers for tester runs — declaration file schema and resolution, control-plane proxy (deploy + API surface), run-scoped lifecycle (ensure/probe/teardown), memory budget and image allowlist enforcement, and prompt injection of service endpoints.

### Modified Capabilities

<!-- none — tester-mode's staging/toolbelt/seeding/teardown requirements and test-recording's
     sidecar requirements are unchanged; all new behavior lives in the new capability,
     following the test-recording precedent of tester sidecar deploy requirements living
     in the tester capability's own spec. -->

## Impact

- **New source**: `src/tester/servicesConfig.ts` (loader, mirrors `src/changes/verification/config.ts`), `src/tester/services.ts` (Docker Engine API lifecycle via `fetch`, no new npm deps) + unit tests.
- **Touched source**: `src/changes/workflow.ts` (tester gate: ensure services after slot claim, stop in the existing `finally`), `src/tester/prompt.ts` (TEST SERVICES section), `src/config.ts` / `src/configSchemas.ts` (`testerZod` new keys), `src/i18n/strings/{en,fr}.ts` (new error strings).
- **Deploy scripts**: `scripts/gce-common.sh` (budget reader, proxy reserve), `scripts/gce-update-image.sh` (Phase 2.5 deploys/removes `clack-docker-proxy`, reserve math).
- **Operator data**: `data/configuration/applauz-monorepo/tester_services.json` (MySQL 8 + Redis 7 on tmpfs), `test_instructions.md` real-backend section, `.deploy-include` entry, `config.json` tester keys.
- **Constraints**: v1 assumes `tester.maxConcurrent: 1` (no service refcounting); VM RAM budget on e2-standard-2 shrinks the clack container cap by `servicesBudgetMb` — documented tradeoff.
