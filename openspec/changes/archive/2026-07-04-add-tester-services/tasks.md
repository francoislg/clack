# Tasks — add-tester-services

## 1. Config surface

- [x] 1.1 Add `dockerProxyUrl?`, `servicesBudgetMb?`, `serviceImageAllowlist?` to `TesterConfig` (`src/config.ts`) with doc comments, and extend `testerZod` (`src/configSchemas.ts`) — all optional, same validation style as `sidecarUrl`/`maxConcurrent`; extend the existing testerZod unit tests with the new keys (valid, invalid type, unknown-key cases)
- [x] 1.2 Create `src/tester/servicesConfig.ts`: zod schema for `tester_services.json` (name regex + uniqueness, image, memoryMb, port, env/args/tmpfs) and `loadTesterServices(repoName, deps)` mirroring `src/changes/verification/config.ts` — absent → null; unreadable/invalid → typed failure result (not null), using `zodErrorToResult` formatting
- [x] 1.3 Create `src/tester/servicesConfig.test.ts`: absent file, valid file, malformed JSON, schema violations (dup names, bad port, missing memoryMb), tier resolution via mocked `resolveInstructionFile`

## 2. Service lifecycle module

- [x] 2.1 Create `src/tester/services.ts`: Docker Engine API client over injected `fetch` against `tester.dockerProxyUrl` — `ensureServices(repo, services, opts)` (remove stale `clack-svc-<repo>-*` → pull-if-missing → create with Memory/MemorySwap, Tmpfs, Env, Cmd, `NetworkMode: "clack"` → start → TCP readiness probe with bounded wait) and `stopServices(repo)` (stop + remove, `clack-svc-` prefix enforced)
- [x] 2.2 Enforce guards in `ensureServices` entry: image allowlist check, Σ memoryMb ≤ `servicesBudgetMb`, `dockerProxyUrl` present — each failing with a distinct typed error naming the offender
- [x] 2.3 Create `src/tester/services.test.ts` with a fake docker API (injected fetch): cold start, stale-container recreate, pull-on-missing-image, proxy unreachable (fetch rejects/times out), readiness timeout (fake timers), teardown-on-partial-failure, prefix enforcement (never touches `clack`/`clack-playwright`), each guard failure
- [x] 2.4 Add i18n strings (`src/i18n/strings/en.ts` + `fr.ts`) for the user-facing abort errors: invalid services file, proxy missing/unreachable, image not allowlisted, budget exceeded, service readiness timeout, and a generic provisioning failure (`tester.services_provision_failed` naming the service and the failing operation — pull/create/start — with the docker error detail)

## 3. Run wiring

- [x] 3.1 Wire into the tester gate in `src/changes/workflow.ts` (after `tryAcquireTesterSlot`, inside the existing try): load declaration → run guards → `ensureServices`; on failure return the typed error (slot released by existing `finally`); thread the started services to execution via a new optional `testerServices` field on `ExecuteChangeOptions` (→ `executeTest` → `TesterPromptOptions`)
- [x] 3.2 Add `stopServices` beside `releaseTesterSlot` in the existing `finally` (only when this run started services); extend `src/slack/stopPipeline` coverage if cancellation surfaces a new path (verify with existing tests)
- [x] 3.3 Thread resolved services into `TesterPromptOptions` and render the TEST SERVICES section in `buildTesterSystemPrompt` (`src/tester/prompt.ts`) — absent when no services; update `src/tester/prompt.test.ts` (section present/absent, byte-identical prompt when feature unused)
- [x] 3.4 Extend `src/tester/sidecarPipeline.integration.test.ts` (or a new integration test) covering gate-order: services ensured after slot claim and before acquisition, torn down on abort

## 4. Deploy scripts

- [x] 4.1 `scripts/gce-common.sh`: add proxy image/name constants, `PROXY_MEM_MB=64`, and `read_tester_services_budget()` (reads `tester.servicesBudgetMb` from local config.json, default 0)
- [x] 4.2 `scripts/gce-update-image.sh`: extend swap-phase reserve math (`896 + 64 + BUDGET` when tester enabled); Phase 2.5 deploys `clack-docker-proxy` (socket ro-mount, `CONTAINERS=1 POST=1 IMAGES=1`, clack network, no host port, memory cap) alongside playwright and removes it when tester disabled
- [x] 4.3 Mirror in `scripts/gce-deploy.sh`: the same reserve-math change in its container-run phase and the proxy deploy in its tester phase; in `docker-compose.tester.yml`: add a `clack-docker-proxy` service (socket ro-mount, same `CONTAINERS/POST/IMAGES` env, `clack` network, 64 MB limit) for local-dev parity

## 5. Operator data (applauz instance)

- [x] 5.1 Write `data/configuration/applauz-monorepo/tester_services.json` (mysql:8 384 MB tmpfs + trimmed args, redis:7 64 MB) and add the real-backend section to `test_instructions.md` (DB_HOST/DB_PORT env wiring, `knex migrate` + seed commands, when to prefer real backend over mocks)
- [x] 5.2 Add tester keys to `data/config.json` (`dockerProxyUrl: "http://clack-docker-proxy:2375"`, `servicesBudgetMb: 512`, `serviceImageAllowlist: ["mysql:8", "redis:7"]`) and the services file to `data/.deploy-include`

## 6. Verification & docs

- [x] 6.1 Full check: `npx tsc`, `npm run test`, `npx oxlint` / `npx oxfmt` on touched files
- [ ] 6.2 (post-merge, operator step) Deploy (`gce-update-image.sh` + `gce-push-config.sh`), confirm proxy container + reserve line in deploy output, then run "test this PR" against a full-stack applauz-monorepo PR and verify: services up before acquisition (execution.log), TEST SERVICES section in the run's SDK JSONL (on the VM under `data/.claude/projects/-app-data-worktrees-applauz-monorepo-<worker>/<sdkSessionId>.jsonl`), containers gone after the run (`docker ps -a` on the VM)
- [x] 6.3 Update `CLAUDE.md` tester section + `docs/` (new config keys, declaration file format, security model), and regenerate/commit `graphify-out/` alongside the code
