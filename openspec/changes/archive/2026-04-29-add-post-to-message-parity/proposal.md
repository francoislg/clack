## Why

`post_to` actions deliver Block Kit messages to other channels/threads, but their schema accepts only `blocks` — `submit_response`'s `reactions` and `actions` (interactive buttons) are not available on cross-posted messages. This forces awkward workarounds: Claude can't post a poll to another channel with `Yes/No` choice buttons, can't put a follow-up button on a cross-posted answer, and can't auto-attach a confirmation reaction on the cross-posted copy. The two surfaces share the same delivery target (a Slack message) and should share the same content shape; the asymmetry today is an oversight, not a design choice.

## What Changes

- Extract `messageContentFields` (`blocks`, `actions`, `reactions`) as a shared zod object and spread it into both `submit_response` and `post_to` action schemas, so any future addition stays in lockstep.
- Add `reactions?: string[]` and `actions?: Action[]` to the `post_to` action contract.
- When a `post_to` carries `actions`, render its action buttons on the cross-posted message using the same renderer (`getResponseActionBlocks`) and route their click handlers back to the original session (so ref-based actions like `change`/`update` resolve against the original `intentStore`).
- When a `post_to` carries `reactions`, attach them to the cross-posted message via the same `addDeliveryReactions` helper used by `submit_response` delivery.
- Reject `post_to` nested inside `post_to.actions` (recursion has no useful semantics and complicates auto-delivery).
- Persist `reactions` and `actions` alongside `blocks` in the per-button snapshot used by the deferred (button-click) delivery path so they replay correctly when the user clicks much later.
- Extend the existing validators (`validateRefActions`, `validateActionButtonLabels`, `validateStagedIntentsCoverage`, `validatePostToActions`) to walk `post_to.actions` so a staged intent placed inside `post_to.actions` is treated identically to one placed at the top level.
- Keep response-level fields (`message`, `skip_response`, `disengage`, `post_top_level`) out of `post_to` — they describe the response itself, not the message content, and the existing schema description already documents that `message` is excluded from cross-posting.
- Document in `data/default_configuration/user/submit-response.md` that `post_to` accepts `actions` and `reactions` with the same semantics as the top-level fields, plus the recursion ban.
- No backward incompatibilities: the new fields are optional; existing `post_to` callers (just `blocks`) work unchanged.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `clack-tool-response`: extends the `post_to` action contract from `blocks`-only to the full `MessageContent` shape (`blocks` + optional `actions` + optional `reactions`); adds rendering, validation, persistence, and click-routing requirements for `post_to.actions`; bans nested `post_to`.

## Impact

- **Code:**
  - `src/tools/presentation/submitResponse.ts` — extract `messageContentFields`, spread into both schemas, extend validators to walk `post_to.actions`, persist `reactions`/`actions` on the per-button snapshot, ban nested `post_to`.
  - `src/tools/types.ts` — add optional `reactions` and `actions` to `PostToAction` and `ResponseSnapshot`.
  - `src/slack/messageReactions.ts` (new) — exported `addDeliveryReactions`, imported by both delivery paths.
  - `src/slack/handlers/handlerResponse.ts` — replace inline `addDeliveryReactions` with the shared import.
  - `src/slack/handlers/dmActions.ts` — extend `postAnswerToChannel` to accept and apply `reactions` and rendered action blocks.
  - `src/slack/handlers/autoExecute.ts` — forward `action.reactions` and `action.actions` from the auto path.
- **Prompts (instructions):**
  - `data/default_configuration/user/submit-response.md` — note that `post_to` accepts `actions` + `reactions` and that nested `post_to` is rejected.
- **Tests:** schema/validator tests in `src/tools/presentation/submitResponse.test.ts`; delivery tests in `src/slack/handlers/dmActions.test.ts` and `autoExecute` tests covering both new paths.
- **No external API changes.** No migration. No dependency updates.
- **Behavioural compatibility:** existing `post_to` callers (with only `blocks`) are unchanged. The change is purely additive at the tool boundary.
- **Authorization (deferred decision, captured in design.md):** click handlers for cross-posted action buttons currently inherit today's "whoever sees the button can click it" model. This change does not introduce a click-time role re-check; that is tracked as a follow-up if the resulting exposure proves uncomfortable in practice. See `design.md` for the reasoning.
