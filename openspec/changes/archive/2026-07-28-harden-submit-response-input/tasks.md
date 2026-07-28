## 1. One-shot reminder on error results

- [x] 1.1 Add an exported constant in `src/tools/presentation/submitResponse.ts` holding the reminder text: the tool is one-shot, the next call that validates is what the user sees, never send probe/test/placeholder payloads.
- [x] 1.2 Attach it as its own field on the error object inside `recordError` (`submitResponse.ts:646-649`), leaving `error` and `details` untouched.
- [x] 1.3 Test that the reminder is present on a validation error, on an aggregated `invalid_batch` error, on the pending-input gate rejection, on the required-tools gate rejection, and on a delivery failure.
- [x] 1.4 Test that success and skip results carry no reminder field.
- [x] 1.5 Verify existing assertions on `{ error: "<message>" }` and on `details` still pass unchanged.

## 2. Escalation retention

- [x] 2.1 **Move** the existing `escalate_to_owner` capture block (`submitResponse.ts:1150-1154`) to immediately after the args cast (`:1115`), ahead of the pending-input and required-tools gates, reading it off the raw args so a malformed sibling field cannot suppress it. Relocate the existing block — do not add a second capture site.
- [x] 2.2 Add a test for last-non-empty-wins on `responseCapture.setEscalateToOwner`: a later call with a revised diagnostic overwrites the earlier one; a later call omitting the field leaves the previous diagnostic intact.
- [x] 2.3 Propagate `escalateToOwner` on the raw-text branch (`src/claude/index.ts:418-425`) and the no-response branch (`:427-433`) of `buildSuccessResponse`, matching the skip and structured-response branches. The consumer side needs no change — `handlerResponse.ts:769` is the single reader.
- [x] 2.4 Test that an escalation set on a rejected call reaches the owner when the run ends via structured response, via raw text, and via no response.
- [x] 2.5 Test that an escalation supplied on a call refused by the required-tools gate is still captured.
- [x] 2.6 Test the inert case: when no call in the run sets `escalate_to_owner`, no diagnostic is captured and no owner DM or error report is produced.

## 3. Verification

- [x] 3.1 `npx tsc --noEmit` — including the unrelated `src/claude/preAnalysis.ts` `ClassifierRun` errors if they are still red.
- [x] 3.2 `npm test`
- [x] 3.3 `npx oxlint` and `npx oxfmt` on every touched file
- [x] 3.4 `openspec validate harden-submit-response-input --strict`
