## Context

`submit_response` is the single tool through which a Claude run delivers (or declines) its result. Its input schema is composed at run time by `buildSubmitResponseSchema` (`src/tools/presentation/submitResponse.ts`) from the run's `submitResponseMode` plus orthogonal flags. Today there are three modes:

- `"always"` → must deliver a primary response (no `skip_response`).
- `"optional"` → full schema, `skip_response` available.
- `"skipped"` → schema accepts ONLY `{ skip_response: true }`; `blocks`, `actions`, `table`, `reactions`, `message`, `post_top_level`, `attention_level` are all absent.

`post_to` is **not** a standalone tool. It is an `actions[]` entry (`type: "post_to"`) on `submit_response`, auto-executed by `src/slack/handlers/autoExecute.ts`. It carries its own explicit `channel`, so it can deliver to a destination unrelated to the run's trigger.

Channelless runs (synthetic `channelless:<jobId>` channel id) are force-mapped to `"skipped"` in `buildQuerySetup` (`src/tools/server.ts:556`) because there is no bound channel for a primary response. But that also strips `actions`, so `post_to` — the one delivery path a channelless run has — disappears. The casual-talk plugin relies on `post_to` and therefore can never deliver. Its spec is self-contradictory (`submitResponseMode: "skipped"` AND "deliver via `post_to`").

## Goals / Non-Goals

**Goals:**
- Let a channelless run deliver via `post_to` without reintroducing a primary top-level response (which has no destination).
- Keep ONE delivery implementation — no duplicated tool, `post_to` keeps all its features (blocks, buttons, `additional_messages`, `thread_replies`, unfurl control).
- Make the fix general: any channelless plugin, not just casual-talk, benefits.
- Resolve the casual-talk spec contradiction.

**Non-Goals:**
- Promoting `post_to` to a standalone MCP tool (larger refactor; out of scope).
- Changing how `post_to` actions are validated or auto-executed.
- Changing trivia or any plugin that delivers through its own tools.

## Decisions

### Decision 1: Add a fourth mode `"optional-post-to"` rather than special-casing channelless inline

The schema difference channelless needs (skip + actions, no primary) is a coherent, reusable mode, not a one-off. Modeling it as a named `submitResponseMode` value keeps `buildSubmitResponseSchema` driven by a single enum, keeps the cron-spec contract explicit, and lets non-channelless callers opt in later if useful.

- Schema variant `optionalPostToResponseSchema = { skip_response: <optional literal true>, actions: <post_to-capable actions> }`. No `blocks`/`message`/`table`/`reactions`/`post_top_level`/`attention_level`.
- `skip_response` stays OPTIONAL here (unlike `"skipped"`, where it is required `true`): the run delivers by emitting a `post_to` action OR terminates with `skip_response: true`.

**Alternative considered:** a boolean `channelless` flag threaded into `buildSubmitResponseSchema`. Rejected — it splits schema selection across two inputs (mode + flag) and doesn't give plugins an explicit, declarable contract.

### Decision 2: Channelless maps to `"optional-post-to"`, not `"skipped"`

`src/tools/server.ts` changes the channelless override from `"skipped"` to `"optional-post-to"`. Channelless inherently lacks a primary channel but should always be able to `post_to`. This is strictly more permissive: trivia (channelless, delivers via its own tools) keeps skipping and simply ignores the now-available `actions`.

**Alternative considered:** leave channelless on `"skipped"` and have casual-talk declare `"optional-post-to"` explicitly. Rejected — the channelless override currently *ignores* the spec's declared mode, so the override is the authoritative path; centralizing the channelless→mode mapping there avoids two sources of truth.

### Decision 3: Handler accepts "actions present, no primary, no skip" as valid delivery

Today the handler treats a call without `blocks` as either a skip (if `skip_response`) or an error. Under `"optional-post-to"` a call may legitimately carry only `actions: [post_to…]` and no `blocks`/`skip_response`. The handler's "must have a primary" guard is relaxed for this mode: a call that carries at least one `post_to` action and no primary is valid; auto-execution of `post_to` proceeds; no primary message is posted.

## Risks / Trade-offs

- [A run in `"optional-post-to"` emits neither `post_to` nor `skip_response` (empty/ambiguous call)] → The handler treats an empty call as a no-op skip-equivalent and records the run as skipped, mirroring channelless intent; the schema descriptions instruct Claude to do exactly one of the two.
- [Widening channelless schema changes the documented `submit-response-mode` contract] → Captured as a MODIFIED requirement in the spec delta; the change is additive/permissive, so existing channelless consumers (trivia) are behavior-compatible.
- [Config/persistence layers reject the new enum value] → Add `"optional-post-to"` to every `submitResponseMode` validation/serialization site (config load, cron-job parse, reconcileCronJobs) and cover with a round-trip test.
- [Claude over-uses `post_to` to spam multiple channels] → `post_to` cap rules are unchanged; the casual-talk prompt already constrains to a single delivery.

## Migration Plan

No data migration. The new enum value is backward-compatible: existing persisted `submitResponseMode` values (`always`/`optional`/`skipped`) keep their meaning. Deploy is a code change; rollback is reverting the code (no persisted state depends on the new value except casual-talk's reconciled cron spec, which is re-derived on boot).
