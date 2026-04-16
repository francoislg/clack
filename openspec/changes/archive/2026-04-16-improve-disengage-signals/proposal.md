## Why

Clack can currently only disengage from a thread via pre-analysis (thread replies, noise filtering) or by calling `submit_response` with `skip_response: true` + `disengage: true`. Two real gaps fall out of this:

1. Direct `@Clack` mentions bypass pre-analysis entirely and always re-activate tracking — a user saying "thanks Clack, you're done" still gets a full response and the thread stays engaged.
2. Claude can't acknowledge *and* disengage in the same turn. A natural "you're welcome — let me know if you need anything else" reply is impossible without two turns.

The fix is small but needs explicit signaling: tell Claude that dismissal phrases are a legitimate disengage trigger, and allow `disengage: true` to stand alone on a normal response.

## What Changes

- Allow `disengage: true` on `submit_response` **without** requiring `skip_response: true`. A normal response + `disengage: true` is now valid and disengages the thread after delivery.
- Update the `submit_response` tool/schema descriptions so Claude knows:
  - Explicit dismissals ("thanks Clack", "you're done", "that's all") are canonical disengage triggers.
  - `disengage` may be combined with a normal response, not only with `skip_response`.
- Update the response-delivery path (`handlerResponse.ts`) to read the `disengage` flag on the success path and set `autoResponseActive = false`, mirroring the existing skip-path behavior.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auto-respond-tracking`: disengage via `submit_response` no longer requires `skip_response`; it can accompany a normal response.
- `clack-tool-response`: `submit_response` schema and behavior updated to accept `disengage` on both skip and normal paths, with updated descriptions guiding Claude on when to use it.

## Impact

- Code: `src/tools/presentation/submitResponse.ts` (schema + guard + capture), `src/slack/handlers/handlerResponse.ts` (success-path disengage handling), `src/tools/types.ts` and `ResponseCapture` if a disengage flag needs to propagate through the normal response path.
- Tests: `src/tools/presentation/submitResponse.test.ts` (new scenarios), handler tests covering post-response disengagement.
- No migration, no external API change. Existing `skip_response + disengage` behavior is preserved.
