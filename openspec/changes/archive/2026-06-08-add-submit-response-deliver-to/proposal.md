## Why

Channelless (invisible scheduled) runs have no bound channel, so the `optional-post-to` mode currently smuggles the destination through a `post_to` **action** — a mechanism built for staged buttons. That workaround has produced a chain of bugs (schema stripped the action, the skip path swallowed it, the success path crashed on the synthetic channel, and finally the action was silently dropped because it lacked an implicit `auto` flag). Each fix peeled back the next layer. The root problem is that delivery-to-an-explicit-channel is not a first-class concept; it is being faked with an action.

## What Changes

- Extract a single shared **message-payload entity** (`blocks` + `thread_replies?` + `actions?` + `suppress_unfurls?` + `reactions?`) and a shared "deliver this payload to a (channel, thread_ts)" routine, and route BOTH the normal `submit_response` primary and each `deliver_to` entry through them — one definition, one code path, no drift between the two.
- Add a first-class `deliver_to` field to `submit_response`, exposed **only** in the channelless (`optional-post-to`) schema. It is an array of `{ channel, thread_ts?, response }` entries, where `response` is that shared message-payload entity — no nested `skip_response`/`deliver_to`.
- Each entry is delivered synchronously through the normal primary-delivery path, targeting its explicit `channel`/`thread_ts`; the first posted message's ts is recorded as the run's `responseTs`.
- A channelless run resolves to exactly one of: `deliver_to` (≥1 entry) **or** `skip_response: true`. Neither (or an empty `deliver_to`) is a **hard error** returned to Claude — no silent no-op.
- **BREAKING** (internal contract): the channelless mode no longer delivers via a `post_to` action. Remove the `post_to`-as-primary path and the band-aids it required — the implicit-`auto` forcing (uncommitted) and the `optional-post-to`-before-skip ordering trick collapse into the single `deliver_to` branch. The `handleSuccess` `isChannellessChannelId` guard is KEPT (it is the permanent "never post to the synthetic sentinel" safety property, still needed for the Claude-ended-without-submit_response edge case — see design decision 5).
- `post_to` (the action) keeps its real, separate purpose: cross-posting/fan-out to other channels from any context, with `auto: true` explicit as always.
- Rewrite the casual-talk prompt to deliver via `submit_response({ deliver_to: [{ channel, response: { blocks } }] })` (or `skip_response`), not a `post_to` action.

## Capabilities

### New Capabilities

- `submit-response-deliver-to`: the `deliver_to` field — its shape (built on the shared message-payload entity), per-entry delivery semantics, `responseTs` recording, and the deliver-or-skip-or-error rule for channelless runs.
- `shared-message-payload`: the common message-content entity + delivery routine reused by the normal primary, `post_to` actions, and `deliver_to` entries (one shape, one delivery code path).

### Modified Capabilities

- `submit-response-mode`: the `optional-post-to` mode's schema and delivery contract change from a `post_to` action to the `deliver_to` field; the silent-skip-on-empty behavior becomes a hard error.
- `casual-talk-plugin`: the run delivers via `deliver_to` instead of a `post_to` action.

## Impact

- `src/tools/presentation/submitResponse.ts` (schema variant + handler branch), `src/tools/presentation/submitResponse/actions.ts` (reuse per-message validation/delivery building blocks).
- `src/slack/handlers/handlerResponse.ts` (unchanged behavior; the `isChannellessChannelId` guard stays — see design decision 5).
- `src/plugins/casual-talk/prompt.ts` (+ prompt tests).
- No change to `post_to` action behavior, normal bound-channel delivery, or the `skipped` mode.
