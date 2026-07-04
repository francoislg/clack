# Per-repo tester services

Tester runs ("test this PR") execute inside the main Clack container, which has no
database and no Docker CLI. This feature lets a repository declare the service
containers its tester runs need (MySQL, Redis, …); Clack provisions them for the run
and tears them down when it ends, so full-stack PRs can be tested against a real
backend instead of a hand-mocked API surface.

Fully inert until BOTH an operator configures the control plane (config keys below)
AND a repo declares services.

## Declaring services

`data/configuration/<repo>/tester_services.json` (two-tier resolution — a
`default_configuration` copy works too). Validated fail-fast: an **absent** file means
no services (the normal path); an **invalid** file **aborts the run** before anything
is acquired — a tester silently missing its database wastes the whole run.

```json
{
  "services": [
    {
      "name": "mysql",
      "image": "mysql:8",
      "memoryMb": 384,
      "port": 3306,
      "env": { "MYSQL_ROOT_PASSWORD": "root", "MYSQL_DATABASE": "applauz_test" },
      "args": ["--innodb-buffer-pool-size=64M", "--performance-schema=OFF"],
      "tmpfs": ["/var/lib/mysql"]
    },
    { "name": "redis", "image": "redis:7", "memoryMb": 64, "port": 6379 }
  ]
}
```

- `name` — `[a-z0-9-]+`, unique within the file. The container name is derived and
  never configurable: `clack-svc-<repo>-<name>`, which is also its DNS hostname on the
  `clack` docker network.
- `image` — must appear (exact match) in `tester.serviceImageAllowlist`.
- `memoryMb` — required; becomes a hard `--memory`/`--memory-swap` cap on the container.
- `port` — the container port the app connects to; also the TCP readiness probe target.
- `tmpfs` — absolute container paths mounted as tmpfs (in-memory, wiped on stop). Use
  it for data dirs so every run starts empty and teardown is free.

## Config keys (`config.tester`)

| Key | Meaning |
|---|---|
| `dockerProxyUrl` | URL of the restricted socket proxy, e.g. `http://clack-docker-proxy:2375`. Workspace-wide. Required only when a repo declares services. |
| `servicesBudgetMb` | Ceiling on Σ `memoryMb` per run. Runs declaring more abort before provisioning. The deploy scripts reserve this amount out of the clack container's memory cap, so budget and reserve always match. |
| `serviceImageAllowlist` | Exact-match list of images services may run (e.g. `["mysql:8", "redis:7"]`). A config edit alone can't run arbitrary images unless it also extends this list (admin-gated). |

## Run lifecycle

1. Tester gate claims the run slot (serializes runs — services never race).
2. `tester_services.json` is loaded; guards run (allowlist, budget, proxy configured).
3. Provisioning (all-or-nothing): stale `clack-svc-<repo>-*` containers removed → image
   pulled if missing → container created (memory caps, tmpfs, `clack` network) → started
   → TCP-probed until ready (60 s per service). Any failure tears down everything
   provisioned and aborts the run with a clear thread error; nothing was acquired yet.
4. The tester prompt gains a TEST SERVICES section (name, host, port, image) and the
   repo's `test_instructions.md` tells the tester how to wire the app (env overrides,
   migrations, seeds — seeding stays repo-side).
5. Teardown runs in the same `finally` as the slot release, on every exit path
   (success, failure, timeout, cancellation). Teardown errors are logged, never thrown;
   remnants (e.g. after a process crash) are removed by the next run's stale cleanup.

## Control plane & security model

Containers are managed through `clack-docker-proxy`
([`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)),
deployed by `scripts/gce-update-image.sh` beside `clack-playwright` when
`tester.enabled` is true (and removed when disabled). Defense in depth:

- The proxy exposes ONLY container + image endpoints (`CONTAINERS=1 POST=1 IMAGES=1`) —
  no exec, no volumes, no host introspection. Socket mounted read-only. Never
  port-mapped to the host on the VM; reachable only over the `clack` network.
- Only core lifecycle code (`src/tester/services.ts`) talks to it. No Claude toolbelt
  (query, worker, or tester) has any docker-facing tool, and the built-in worker/tester
  bash guard denies Bash commands referencing the proxy name, the docker API port, or
  the docker socket.
- Code refuses to create/stop/remove anything outside the `clack-svc-` namespace.
- Images are bounded by the allowlist; memory by per-container caps and the budget.

**Residual risk — read this before enabling.** The proxy filters *endpoints*, not
request *bodies*: `POST /containers/create` is allowed through wholesale, so the image
allowlist, name-prefix, and memory-cap guards are enforced by Clack's core code, NOT by
the proxy. Agent code runs inside the same container (same network, same UID) as core
code, so a deliberately adversarial agent that evades the bash guard (e.g. via an
interpreter it is allowed to run) could reach the proxy and create an arbitrary
container — including a privileged one. Enabling this feature extends the trust you
already place in worker-mode agents from "can push branches" to "can potentially reach
the docker daemon". The clean fix is a payload-validating control plane (a thin service
that only accepts `clack-svc-*` creates of allowlisted images) — planned as a follow-up;
until then, treat `tester.enabled` + proxy deployment as granting the bot's agents that
trust level.

## Memory math (deploy)

When the tester is enabled, the clack container's cap becomes
`total − 384 (host) − 896 (playwright) − 64 (proxy) − servicesBudgetMb`. On an
e2-standard-2 with a 512 MB budget that is ~6.0 GB — mind bundler spikes inside the
clack container; keep repo instructions sequencing heavy builds before service-backed
app boots. Changing `servicesBudgetMb` requires a redeploy (`gce-update-image.sh`) so
the reserve tracks the budget.

**Rollout ordering**: the new config keys are rejected by older builds (fail-fast
unknown-key check), so deploy the image BEFORE pushing a `config.json` that contains
them.

## Local dev

`docker-compose.tester.yml` includes a `clack-docker-proxy` service (exposed on
`127.0.0.1:2375` so a host-run `npm run dev` Clack can reach it — set
`tester.dockerProxyUrl` to `http://localhost:2375` locally).
