## ADDED Requirements

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
