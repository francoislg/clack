# user-roster-sync Specification

## Purpose

Periodic full-workspace `users.list` sync that keeps the persisted user registry (`data/state/users.json`) complete and current, so `find_user` can search the registry as its source of truth. The sync refreshes only Slack-sourced identity fields and never disturbs human-authored data.

## Requirements

### Requirement: Full-Roster Sync Into The Registry

The system SHALL provide a `syncRoster` primitive that fetches the entire Slack workspace member list via the paginated `users.list` API and upserts every real member into the persisted user registry (`data/state/users.json`). A "real member" is a member that is not deleted, not a bot, and not `USLACKBOT`. For each real member the sync SHALL write only the Slack-sourced core fields — `username`, `displayName`, and `avatarUrl` — and SHALL create a record for a member that has no existing registry record. The sync SHALL route its writes through the registry's serialized single-writer chain.

#### Scenario: Sync upserts every real member

- **WHEN** `syncRoster` runs against a workspace with N real members
- **THEN** the registry contains a record for each of the N members after the sync completes
- **AND** each record carries the member's `username`, `displayName`, and `avatarUrl` resolved from the Slack profile

#### Scenario: Deleted, bot, and USLACKBOT members excluded

- **WHEN** `syncRoster` encounters a member that is deleted, a bot, or `USLACKBOT`
- **THEN** the sync does not create or update a registry record for that member

#### Scenario: avatarUrl resolution matches roster rules

- **WHEN** the sync resolves a member's `avatarUrl`
- **THEN** it uses `profile.image_original` when present, else `profile.image_512`, else the empty string

#### Scenario: Pagination is followed to completion

- **WHEN** the workspace member list spans multiple `users.list` pages
- **THEN** the sync follows the `next_cursor` pagination until all pages are consumed before reporting completion

### Requirement: Sync Preserves Human-Authored Fields

The full-roster sync SHALL NOT overwrite or clear any human-authored field on an existing record. `github`, `otherNames`, and every `plugins.<name>` namespace SHALL survive the sync unchanged. Only the Slack-sourced fields (`username`, `displayName`, `avatarUrl`) SHALL be refreshed.

#### Scenario: Existing github and otherNames survive a sync

- **WHEN** a record carries `github.username` and a non-empty `otherNames` before a sync
- **THEN** after the sync both fields are present and unchanged
- **AND** only `username`, `displayName`, and `avatarUrl` reflect the newly fetched Slack values

#### Scenario: Plugin namespaces survive a sync

- **WHEN** a record carries `plugins.<name>` data before a sync
- **THEN** that namespace is present and unchanged after the sync

### Requirement: TTL-Gated Lazy Sync Trigger

The system SHALL track a roster-sync freshness marker, distinct from any per-record `lastFetched`, and SHALL trigger `syncRoster` lazily when `find_user` is invoked and the marker is older than the roster-sync TTL (or absent). A cold-start trigger — when the registry holds no synced roster data — SHALL be awaited so the first search is not empty; a stale-but-warm trigger SHALL run in the background while the current registry is served. Concurrent triggers SHALL coalesce into at most one in-flight sync. The full-roster sync SHALL NOT bump per-record `lastFetched`.

#### Scenario: Cold start awaits the first sync

- **WHEN** `find_user` is called and the roster-sync marker is absent
- **THEN** the system runs `syncRoster` to completion before computing matches
- **AND** the search results reflect the freshly synced roster

#### Scenario: Stale warm sync runs in the background

- **WHEN** `find_user` is called, the registry already holds synced roster data, and the marker is older than the TTL
- **THEN** the system serves matches from the current registry immediately
- **AND** triggers a background `syncRoster` that updates the registry and refreshes the marker

#### Scenario: Fresh marker skips the sync

- **WHEN** `find_user` is called and the roster-sync marker is within the TTL
- **THEN** the system does not call `users.list`
- **AND** serves matches from the current registry

#### Scenario: Concurrent triggers coalesce

- **WHEN** two `find_user` calls both observe a stale marker concurrently
- **THEN** at most one `syncRoster` runs
- **AND** the marker is refreshed once on completion

#### Scenario: Sync does not disturb display-name freshness

- **WHEN** `syncRoster` updates a record's Slack-sourced fields
- **THEN** that record's `lastFetched` value is left unchanged
- **AND** the per-user lazy display-name refresh continues to fire on its own TTL

#### Scenario: Sync skipped when Slack client unavailable

- **WHEN** a sync would be triggered but no Slack client is connected
- **THEN** the system serves matches from the current registry without attempting `users.list`
- **AND** does not throw
