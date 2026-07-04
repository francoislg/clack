# tester-services Specification (delta)

## ADDED Requirements

### Requirement: Per-repo service declaration file

A repository MAY declare service containers its tester runs need in `data/configuration/<repo>/tester_services.json` (or the `default_configuration` tier), resolved through the two-tier instruction chain. The file SHALL be validated with a zod schema: `services` is an array of entries with required `name` (`/^[a-z0-9-]+$/`, unique within the file), `image` (non-empty string), `memoryMb` (positive integer), `port` (1–65535), and optional `env` (string→string map), `args` (string array), `tmpfs` (string array of absolute container paths, each starting with `/`).

#### Scenario: File absent

- **WHEN** a tester run starts for a repo with no `tester_services.json` in either tier
- **THEN** no services are provisioned and the run proceeds exactly as before this feature

#### Scenario: Valid file

- **WHEN** a tester run starts for a repo whose `tester_services.json` parses and validates
- **THEN** the declared services are provisioned before workspace acquisition

#### Scenario: Invalid file aborts the run

- **WHEN** `tester_services.json` exists but is malformed JSON or fails schema validation
- **THEN** the run aborts before any workspace is acquired, with an error naming the file and the validation failure
- **AND** the run is NOT silently executed without services

### Requirement: Docker control plane is a restricted socket proxy used by core code only

Service containers SHALL be managed through a `docker-socket-proxy` sidecar that exposes only container and image endpoints (`CONTAINERS=1`, `POST=1`, `IMAGES=1`; exec, volumes, and host endpoints denied). The proxy SHALL join the `clack` docker network, SHALL NOT be port-mapped to the host, and SHALL be reachable only via `tester.dockerProxyUrl` (a single workspace-wide key — one proxy serves all repos). No Claude-facing tool (query, worker, or tester toolbelt) SHALL expose docker operations; only core lifecycle code calls the proxy.

#### Scenario: Proxy required when services are declared

- **WHEN** a repo declares services but `tester.dockerProxyUrl` is not configured
- **THEN** the run aborts with a configuration error before acquisition

#### Scenario: Proxy unreachable

- **WHEN** the proxy does not respond at `tester.dockerProxyUrl`
- **THEN** the run aborts with an error naming the proxy URL, before any workspace is acquired

#### Scenario: No docker capability for Claude

- **WHEN** the tester toolbelt is built for a run with services
- **THEN** it contains no docker-facing tool, and the injected prompt instructs the tester not to start its own containers

#### Scenario: Bash access to the control plane is denied

- **WHEN** a worker or tester Bash command references the proxy container name, the docker API port, or the docker socket
- **THEN** the built-in bash guard denies the command with a reason pointing at the provisioned TEST SERVICES

### Requirement: Guard rails bound what services can run

The system SHALL enforce three guards before provisioning: (1) every declared `image` MUST appear in `tester.serviceImageAllowlist`; (2) the sum of declared `memoryMb` MUST NOT exceed `tester.servicesBudgetMb`; (3) lifecycle code SHALL only create, stop, or remove containers whose name starts with `clack-svc-`, and container names are derived (`clack-svc-<repo>-<name>`), never configurable.

#### Scenario: Image not allowlisted

- **WHEN** a declared service's image is absent from `tester.serviceImageAllowlist`
- **THEN** the run aborts naming the offending image, and nothing is pulled or created

#### Scenario: Budget exceeded

- **WHEN** the sum of declared `memoryMb` exceeds `tester.servicesBudgetMb`
- **THEN** the run aborts naming the declared total and the budget, and nothing is created

#### Scenario: Foreign container untouched

- **WHEN** teardown runs on a VM that also hosts containers not named `clack-svc-*` (e.g. `clack`, `clack-playwright`)
- **THEN** those containers are never stopped or removed by service lifecycle code

### Requirement: Services are provisioned before acquisition and ready before the run starts

After the tester slot is claimed and before any worktree is acquired, the system SHALL ensure each declared service: remove any stale `clack-svc-<repo>-*` container, pull the image if absent, create the container with a hard memory cap (`memoryMb` as both memory and memory-swap), declared tmpfs mounts, env, args, and `NetworkMode: "clack"`, start it, and probe readiness — a service is ready when a TCP connection to `clack-svc-<repo>-<name>:<port>` is accepted — within a 60-second bounded wait per service. Provisioning is all-or-nothing: if any service fails to pull, create, start, or become ready, ALL containers provisioned for the run SHALL be torn down, the run SHALL abort with a clear error, and the tester slot SHALL be released — a partial service set never reaches the tester. Service provisioning relies on the tester slot for serialization; runs beyond the slot cap are rejected before provisioning begins.

#### Scenario: Cold start

- **WHEN** a tester run starts for a repo declaring MySQL and Redis and no service containers exist
- **THEN** both containers are created on the `clack` network with their declared memory caps and are TCP-reachable before the worktree is acquired

#### Scenario: Stale container from a crashed prior run

- **WHEN** a `clack-svc-<repo>-<name>` container already exists at provisioning time
- **THEN** it is removed and recreated fresh, so the run starts from a clean (empty) service state

#### Scenario: Readiness timeout

- **WHEN** a started service never accepts TCP connections within the 60-second bounded wait
- **THEN** the run aborts with an error naming the service, provisioned containers are torn down, and the tester slot is released

#### Scenario: Image pull failure

- **WHEN** pulling a declared image fails (network error, image not found)
- **THEN** the run aborts with an error naming the image, any already-provisioned containers are torn down, and the tester slot is released

#### Scenario: Concurrent run rejected before provisioning

- **WHEN** a tester run is requested while the slot cap is already held
- **THEN** it is rejected by the existing tester-slot gate before any service provisioning starts, so concurrent runs never contend for the same service containers

### Requirement: Services are torn down on every run exit path

Service containers SHALL be stopped and removed in the same guaranteed-release site as the tester slot, covering normal completion, delivery-gate failure, execution errors, timeouts, and user cancellation.

#### Scenario: Normal completion

- **WHEN** a tester run with services completes and delivers
- **THEN** all `clack-svc-<repo>-*` containers for the run are stopped and removed

#### Scenario: Timeout or crash mid-run

- **WHEN** the run times out or the execution throws after services were provisioned
- **THEN** the same teardown runs and no service container outlives the run

#### Scenario: Partial teardown failure

- **WHEN** stopping or removing a service container fails (container already gone, proxy error)
- **THEN** teardown of the remaining containers proceeds, the errors are logged, and slot release is never blocked — any remnant is recovered by the next run's stale-container cleanup

### Requirement: Tester prompt advertises running services

When services were provisioned, the tester system prompt SHALL include a TEST SERVICES section listing each service's name, resolved host (`clack-svc-<repo>-<name>`), port, and image, stating that the instances are fresh and empty, and directing the tester to wire the app per the repository test instructions. When no services were provisioned the section SHALL be absent.

#### Scenario: Services running

- **WHEN** the prompt is assembled for a run whose services started
- **THEN** it contains one line per service with resolved host and port

#### Scenario: No services

- **WHEN** the prompt is assembled for a repo with no declaration file
- **THEN** no TEST SERVICES section appears and the prompt is byte-identical to pre-feature output

### Requirement: Deploy provisions the proxy and reserves the services budget

`scripts/gce-update-image.sh` SHALL, when `tester.enabled` is true in the local config, deploy the `docker-socket-proxy` sidecar (fixed memory cap, socket mounted read-only, `clack` network, no host port) alongside the Playwright sidecar, and SHALL remove it when the tester is disabled. The clack container's memory cap formula SHALL subtract the proxy reserve and `tester.servicesBudgetMb` in addition to the existing host and Playwright reserves.

#### Scenario: Tester enabled with a budget

- **WHEN** the deploy runs with `tester.enabled: true` and `tester.servicesBudgetMb: 512`
- **THEN** the proxy container is running with its cap, and the clack container's cap equals total − host reserve − Playwright reserve − proxy reserve − 512

#### Scenario: Tester disabled

- **WHEN** the deploy runs with the tester disabled
- **THEN** any existing proxy container is removed and no proxy or budget reserve is subtracted

### Requirement: Feature is inert without declarations or config

With no `tester_services.json` files and none of the new config keys set, tester behavior SHALL be observably identical to pre-feature behavior, and the new config keys (`dockerProxyUrl`, `servicesBudgetMb`, `serviceImageAllowlist`) SHALL be optional in the fail-fast tester config schema.

#### Scenario: Zero-config deployment

- **WHEN** an instance upgrades to this version without touching config or data files
- **THEN** tester runs behave exactly as before and config validation passes
