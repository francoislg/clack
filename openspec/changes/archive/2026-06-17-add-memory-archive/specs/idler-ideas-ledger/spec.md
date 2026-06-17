## MODIFIED Requirements

### Requirement: Stable source-keyed unit identity and dedup

A work unit's identity SHALL be a stable key derived from the underlying source entity (e.g. a Sentry issue short-id, an Asana task gid, a GitHub PR number), NOT the triggering message timestamp. When a source re-emits the same entity (a Sentry issue re-alerting, a tracker task re-surfacing), the system SHALL update the existing unit rather than create a duplicate. During discovery, before `upsert_idea` creates a unit for an entity with no live memory entry, sync SHALL consult the memory archive by the same stable key via `getArchived(id)`. On an archive hit, sync SHALL **enrich** the newly created or refreshed unit with the prior outcome (e.g. surfacing "fixed before in PR #123" in `what`/`whereWeAre`) rather than suppress it — a re-discovered entity remains workable, because a genuine regression must get worked; the archived outcome is context, not a veto.

#### Scenario: Repeated Sentry alert maps to one unit

- **GIVEN** an open unit keyed by Sentry issue `PROJ-1Q2W`
- **WHEN** the same Sentry issue re-alerts in the channel
- **THEN** no second unit is created
- **AND** the existing unit's reference cursor/`whereWeAre` is updated to reflect the new activity

#### Scenario: Distinct issues are distinct units

- **GIVEN** two different Sentry issues alert in the channel
- **WHEN** sync discovers them
- **THEN** two distinct units are created, each keyed by its own issue id

#### Scenario: Re-activated done unit re-opens

- **GIVEN** a unit previously marked `done` (e.g. triaged already-done, or its PR merged)
- **WHEN** the same source entity shows new activity past the cursor (a Sentry regression, a re-opened/re-assigned task)
- **THEN** the existing unit is re-opened (`open` set true) rather than a duplicate created

#### Scenario: Discovery of an archived entity enriches rather than suppresses

- **GIVEN** no live memory entry for `sentry:1234`, but an archived record exists with outcome "Fixed in PR #123"
- **WHEN** sync discovers a fresh alert for `sentry:1234`
- **THEN** a unit is created and enriched with the prior archived outcome (it is not suppressed), so triage starts informed that this was fixed before
