## MODIFIED Requirements

### Requirement: Deploy provisions the proxy and reserves the services budget

`scripts/gce-deploy.sh` SHALL, when `tester.enabled` is true in the local config, ensure the `docker-socket-proxy` sidecar (fixed memory cap, socket mounted read-only, `clack` network, no host port) runs alongside the Playwright sidecar, creating it only when it is missing, and SHALL remove it when the tester is disabled. The clack container's memory cap formula SHALL subtract the proxy reserve and `tester.servicesBudgetMb` in addition to the existing host and Playwright reserves.

#### Scenario: Tester enabled with a budget

- **WHEN** the deploy runs with `tester.enabled: true` and `tester.servicesBudgetMb: 512`
- **THEN** the proxy container is running with its cap, and the clack container's cap equals total − host reserve − Playwright reserve − proxy reserve − 512

#### Scenario: Proxy already running

- **WHEN** the deploy runs with the tester enabled and the proxy container is already running
- **THEN** the proxy container is left running and its image is not re-pulled

#### Scenario: Tester disabled

- **WHEN** the deploy runs with the tester disabled
- **THEN** any existing proxy container is removed and no proxy or budget reserve is subtracted
