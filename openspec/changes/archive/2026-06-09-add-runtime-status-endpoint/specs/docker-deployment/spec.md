## ADDED Requirements

### Requirement: Status Port Published to Loopback

The GCE image-update deploy SHALL run the container with the runtime status port published to the VM's loopback interface only, so the deploy script can poll `GET /status` from the VM host. The port SHALL NOT be published on a public interface.

#### Scenario: Container publishes status port to localhost

- **WHEN** `scripts/gce-update-image.sh` runs the new container
- **THEN** the `docker run` command publishes the status port as `127.0.0.1:<port>:<port>`
- **AND** the port is reachable as `localhost:<port>` from the VM host
- **AND** it is not bound to a public address

### Requirement: Pre-Swap Drain Gate

Before stopping the old container, the deploy SHALL wait for the running bot to become idle by polling `GET /status` until `busy` is `false`, subject to a bounded maximum wait. The drain gate SHALL run after the no-downtime preparation phases and before the container swap, so the downtime window lands on an idle bot.

#### Scenario: Idle bot proceeds immediately

- **WHEN** the drain gate polls `GET /status`
- **AND** the response has `busy == false`
- **THEN** the deploy proceeds to the container swap without waiting

#### Scenario: Busy bot is waited on

- **WHEN** the drain gate polls `GET /status`
- **AND** the response has `busy == true`
- **AND** the maximum wait has not been exceeded
- **THEN** the deploy keeps waiting and re-polls
- **AND** it prints a progress line indicating the number of active runs and busy workers

#### Scenario: Bounded wait then proceed

- **WHEN** the bot is still `busy` after the maximum wait elapses
- **THEN** the deploy prints the still-active counts (active query runs and executing changes)
- **AND** proceeds with the container swap anyway

#### Scenario: Status unreachable does not block deploy

- **WHEN** the drain gate cannot reach `GET /status` (e.g. an older image without the endpoint)
- **THEN** the deploy logs that the drain check was skipped
- **AND** proceeds with the container swap

### Requirement: Deploy Skill Surfaces the Drain Phase

The `/deploy` skill SHALL surface the drain phase to the operator: its Monitor output filter SHALL match the drain progress markers, and its phase-acknowledgement guidance SHALL include the drain phase so the operator understands why the deploy may pause before the swap.

#### Scenario: Skill acknowledges the drain phase

- **WHEN** the deploy emits drain-phase output
- **THEN** the skill's Monitor filter captures the drain markers
- **AND** the skill has a phase-acknowledgement entry for the drain phase
