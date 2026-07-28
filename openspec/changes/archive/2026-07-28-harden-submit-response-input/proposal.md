## Why

A scheduled `#yesterday-in-applauz` run (session `C0B1BN5R15W-1785243644-833`) posted the literal text **"test"** to a public channel instead of its daily report.

Claude had assembled a complete response but passed `blocks` / `table` / `actions` as JSON strings. The schema rejected the call — correctly, and with a precise message (`"Invalid input: expected array, received string"`, pathed to `blocks`). Claude retried the same malformed shape, got the same clear rejection, and then **probed the tool with a minimal `{ "type": "section", "text": "test" }` payload to test the format**. That probe validated and delivered. Since delivery is one-shot (`handlerResponse.ts:406-408`), the real report was gone — and so was the `escalate_to_owner` diagnostic the failed calls carried, which was reporting a broken Metabase grant.

The malformed argument is a model bug that the existing error already reported accurately; the tool contract is not at fault and is not being widened. What Clack lacks is a defense for the state that actually caused harm — *Claude has failed repeatedly and starts improvising against a live, one-shot delivery channel* — and a guarantee that an operator escalation survives a failed call.

## What Changes

- **Append a one-shot warning to every `submit_response` error result.** A fixed reminder that the tool is one-shot, that the next call which validates is what the user sees, and that probe/test/placeholder payloads must never be sent. Carried as its own field so existing `error` / `details` shapes are untouched.
- **Retain `escalate_to_owner` across failed calls.** Capture it as the handler's first action, ahead of the pending-input and required-tools gates, so a diagnostic supplied on a rejected call is not lost. Propagate it on the two run outcomes that currently drop it.

Explicitly **not** doing (considered and rejected):

- Accepting JSON-encoded strings for structured fields. That would widen a public tool contract to normalize a model bug, and the rejection Claude received was already precise and actionable — it was ignored, not misunderstood.
- Moving shape validation out of the MCP boundary into the handler. Its only benefit was attaching a hint and telemetry to errors that were already legible, and it requires making every structured field permissive to get there.
- Content heuristics that detect "placeholder-looking" output (e.g. refusing a lone `"test"`). Too easy to misfire on legitimate short answers.

No user-facing Slack rendering changes, no config changes, no schema changes. Not breaking.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `clack-tool-response`: every `submit_response` error result carries a standing one-shot reminder.
- `owner-error-escalation`: `escalate_to_owner` is captured before any gate and survives a rejected call, and is propagated on every non-hard-failure run outcome rather than only the skip and structured-response ones.

## Impact

- `src/tools/presentation/submitResponse.ts` — a reminder constant, `recordError` (`:646-649`, the single error funnel), and moving the escalation capture (`:1150-1154`) above the gates.
- `src/claude/index.ts` — `buildSuccessResponse` (`:373`) raw-text (`:418-425`) and no-response (`:427-433`) branches.
- `src/tools/presentation/submitResponse.test.ts` and `src/claude/` tests — coverage for the reminder on every error path and for escalation retention.
- Delivery semantics are untouched: `submit_response` stays one-shot by design.
