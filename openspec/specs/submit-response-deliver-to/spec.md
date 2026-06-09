# submit-response-deliver-to Specification

## Purpose

Define the `deliver_to` field structure, delivery semantics, and per-entry contracts for the `"optional-post-to"` submit_response mode, enabling runs with no bound channel to deliver to multiple explicit destinations.

## Requirements

### Requirement: deliver_to Field Shape

The `submit_response` tool's `"optional-post-to"` schema SHALL expose a `deliver_to` field: an array of destination entries. Each entry SHALL have:

- `channel` (string, REQUIRED) — the explicit destination channel id. There is no bound channel to fall back to, so omitting it SHALL be a validation error.
- `thread_ts` (string, optional) — when present, the entry's message is posted as a reply into that thread; when absent, it is posted top-level in `channel`.
- `response` (REQUIRED) — the shared message-payload entity (`blocks` + optional `thread_replies` + optional `actions` + optional `suppress_unfurls` + optional `reactions`), as defined by the `shared-message-payload` capability.

`response` SHALL NOT contain `skip_response` or a nested `deliver_to` (no recursion), and SHALL NOT contain `additional_messages` (multiple top-level messages in one channel are expressed as multiple `deliver_to` entries with the same `channel`). A `post_to` action inside `response.actions` SHALL be rejected, mirroring the existing no-nested-`post_to` rule that applies to other actions arrays. `response.blocks` SHALL be a non-empty array.

#### Scenario: Entry requires an explicit channel

- **WHEN** Claude calls `submit_response({ deliver_to: [{ response: { blocks: [...] } }] })` (no `channel`)
- **THEN** Zod rejects the call for the missing required `channel`

#### Scenario: Entry posts top-level when thread_ts is absent

- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C1", response: { blocks: [...] } }] })`
- **THEN** the message is posted top-level in `C1` (no `thread_ts`)

#### Scenario: Entry replies into a thread when thread_ts is set

- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C1", thread_ts: "1700000000.000100", response: { blocks: [...] } }] })`
- **THEN** the message is posted as a reply under `1700000000.000100` in `C1`

#### Scenario: Entry with empty blocks is rejected

- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C1", response: { blocks: [] } }] })`
- **THEN** validation rejects the call for the empty `response.blocks`

#### Scenario: Nested post_to inside an entry's actions is rejected

- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C1", response: { blocks: [...], actions: [{ type: "post_to", channel: "C2", blocks: [...] }] } }] })`
- **THEN** validation rejects the nested `post_to` (same rule that forbids `post_to` nested inside other actions arrays)

### Requirement: Per-Entry Delivery Semantics

Each `deliver_to` entry SHALL be delivered through the SAME message-delivery routine used by the normal bound-channel primary (the `shared-message-payload` delivery), targeting the entry's `channel`/`thread_ts`. Delivery SHALL NOT route through the staged-button `post_to` auto-execute path, and SHALL NOT require an `auto` flag — a `deliver_to` entry is always delivered immediately.

Entries SHALL be delivered in array order. The message-payload's nested `thread_replies` and `actions` SHALL be honored per entry exactly as they are for a normal primary. `actions` are rendered as interactive buttons on the posted message (clicked later by users) — they are NOT auto-executed between entries. If a Slack post fails for an entry, the routine SHALL surface the error and the run SHALL be recorded as an error (not a success).

#### Scenario: Multiple entries to different channels each deliver

- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C1", response: { blocks: [A] } }, { channel: "C2", response: { blocks: [B] } }] })`
- **THEN** message A is posted to `C1` and message B is posted to `C2`

#### Scenario: Multiple entries to the same channel post separate messages

- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C1", response: { blocks: [A] } }, { channel: "C1", response: { blocks: [B] } }] })`
- **THEN** two separate top-level messages (A then B) are posted to `C1`

#### Scenario: Entry with thread_replies posts the parent then its replies

- **WHEN** an entry's `response` carries `thread_replies`
- **THEN** the entry's top-level message is posted first, and each `thread_replies` item is posted as a threaded reply under it

#### Scenario: deliver_to entries have no auto flag

- **GIVEN** a `deliver_to` entry `{ channel, thread_ts?, response }`
- **WHEN** the entry is delivered
- **THEN** delivery happens immediately with no `auto` field anywhere in the entry — `auto` is not part of the entry contract (unlike a `post_to` action, which gates auto-execute on `auto: true`)

#### Scenario: Slack post failure records the run as an error

- **GIVEN** a `deliver_to` entry whose `channel` Slack rejects (e.g. `channel_not_found`)
- **WHEN** the run delivers
- **THEN** the failure is surfaced and the run is recorded with an error status (NOT a silent success)

### Requirement: responseTs Recording for deliver_to Runs

A run that delivers via `deliver_to` SHALL be recorded with `status: "success"` and a `responseTs` equal to the Slack timestamp of the FIRST entry's posted message (its parent message — the top-level post, or the threaded reply when the first entry sets `thread_ts` — before any of that entry's own `thread_replies`). Cron status reporting (`executeDynamicJob`) SHALL read that `responseTs`.

#### Scenario: First entry's ts is the run responseTs

- **GIVEN** a channelless run delivering two `deliver_to` entries
- **WHEN** both entries post successfully
- **THEN** the run's `responseTs` is the ts of the first entry's message

### Requirement: Deliver-or-Skip-or-Error

In `"optional-post-to"` mode the handler SHALL resolve to exactly one of three outcomes and SHALL NEVER silently succeed without delivering:

- non-empty `deliver_to` → deliver and record success.
- `skip_response: true` with no/empty `deliver_to` → record a skip.
- non-empty `deliver_to` AND `skip_response: true` together → DELIVER; `deliver_to` wins and `skip_response` is ignored. A present deliverable always takes precedence over the skip flag (the prompt tells Claude not to set both, but the handler must not drop the post if it does).
- neither `deliver_to` nor `skip_response` → return an error to Claude (`recordError`) instructing it to provide `deliver_to` or `skip_response`.

#### Scenario: deliver_to and skip_response together still delivers

- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C1", response: { blocks: [...] } }], skip_response: true })`
- **THEN** the entry is delivered to `C1` and the run records success (the `skip_response` is ignored, not honored)

#### Scenario: Neither field is a hard error

- **WHEN** Claude calls `submit_response({})` in `optional-post-to` mode
- **THEN** the handler returns an error (not a success, not a silent skip)

#### Scenario: Empty deliver_to array with no skip is a hard error

- **WHEN** Claude calls `submit_response({ deliver_to: [] })`
- **THEN** the handler returns an error (an empty array delivers nothing and is not an explicit skip)

### Requirement: deliver_to Entry Thread Engagement

Each `deliver_to` entry SHALL accept two optional fields that govern engagement of the entry's destination thread:

- `attention_level` (`"off" | "low" | "medium" | "high" | "always"`, optional, default `"off"`) — the attention level seeded onto the destination thread. This is distinct from the existing top-level `submit_response.attention_level`, which governs the CURRENT session's own thread; the per-entry field governs the explicit destination thread the entry posts into (the only one that matters for a channelless run, whose own session is synthetic).
- `follow_up_context` (string, optional) — guidance injected into the answer turn when a human replies in the destination thread.

When `attention_level` is absent or `"off"`, delivery behaves exactly as today (no session is seeded for the destination — fire-and-forget). When `attention_level` is non-`"off"`, the handler SHALL — after the entry's message is delivered successfully — register an engaged thread session (per the `engaged-thread-registration` capability) for the destination, keyed to the entry's `thread_ts` when present, otherwise to the posted message's timestamp (the new thread root). `follow_up_context`, when present, SHALL be stored as that session's follow-up context.

Seeding SHALL be best-effort and non-fatal: a failed delivery SHALL NOT seed a session, and the seeding SHALL NOT affect the delivery result reported to Claude (a seeding failure SHALL be logged, not surfaced as a delivery error). In particular, when the post succeeded but no root timestamp is available to key the session on (the Slack response carried no `ts` AND the entry had no `thread_ts`), the handler SHALL skip seeding and log it, leaving the delivery reported as successful.

#### Scenario: Default omitted fields preserve fire-and-forget

- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C1", response: { blocks: [...] } }] })`
- **THEN** the message is delivered
- **AND** no engaged thread session is seeded for `C1`

#### Scenario: High attention on a thread reply seeds the parent thread

- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C1", thread_ts: "1700000000.000100", attention_level: "high", follow_up_context: "…", response: { blocks: [...] } }] })`
- **THEN** the reply is delivered under `1700000000.000100`
- **AND** an engaged session is seeded for `(C1, "1700000000.000100")` with `attentionLevel: "high"` and the supplied follow-up context

#### Scenario: High attention on a top-level post seeds the posted root

- **WHEN** Claude delivers an entry with `attention_level: "high"` and no `thread_ts`, and the post lands at ts `1700000000.000200`
- **THEN** an engaged session is seeded for `(C1, "1700000000.000200")`

#### Scenario: Failed delivery seeds nothing

- **WHEN** the entry's delivery fails
- **THEN** no engaged session is seeded
- **AND** the delivery error is reported as before
