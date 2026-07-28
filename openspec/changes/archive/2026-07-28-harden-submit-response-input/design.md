## Context

`submit_response` is registered through the Agent SDK's `tool()` helper (`src/tools/presentation/submitResponse.ts:1107`) with a zod schema built by `buildSubmitResponseSchema`. The SDK parses tool input against that schema **before** invoking the handler, so a shape mismatch returns an MCP input-validation error without the handler body running.

In the `#yesterday-in-applauz` incident that error fired twice and was accurate both times — it named the field and the expected type. Claude did not misread it; it stopped trying to satisfy the contract and instead sent a deliberately minimal payload to discover the format empirically. That payload delivered, consuming the single delivery slot (`alreadyDelivered`, `handlerResponse.ts:406-408`, latched via `wrapDeliverWithDeliveredMark` in `src/claude/index.ts:225-235`).

Two structural facts this design builds on:

- `recordError` (`submitResponse.ts:646-649`) is the **single** error return path in the file — 13 call sites, exactly one `isError` return.
- The `escalate_to_owner` capture (`:1150-1154`) sits *after* the pending-input gate (`:1122`) and the required-tools gate (`:1135`), so those two paths already lose an escalation today, independent of the incident.

## Goals / Non-Goals

**Goals:**

- Make the one-shot nature of the tool impossible to forget at the moment it matters — on a failure, when Claude is deciding what to try next.
- Guarantee an `escalate_to_owner` diagnostic reaches the owner even when the call carrying it was rejected and the run never produced a successful response.

**Non-Goals:**

- Making `submit_response` re-deliverable. One-shot delivery is intentional and stays.
- Accepting malformed input shapes. The schema is the contract; a rejection with a correct message is the system working.
- Detecting placeholder content. A tool cannot reliably distinguish a probe from a legitimately terse answer, and a false positive would suppress a real response.
- Recovering the lost report or fixing the Metabase `applauz_stats` grant (operational follow-ups, not code).

## Decisions

### 1. Append the warning centrally in `recordError`

`recordError` is the only error return path, so the reminder is added there once and reaches every failure automatically — no per-call-site discipline to maintain, and no way for a future error path to forget it.

It is carried as a **separate field** on the error object rather than spliced into the `error` string, so existing single-error string matching (`{ error: "<message>" }`) and the `details` array keep their exact shapes and current assertions continue to hold.

It is appended to **every** error, including the pending-input and required-tools gates. Those gates already say "fix this and call again", which composes with "and never send a probe" rather than contradicting it. The dangerous state is reachable from any repeated failure, not just validation ones.

*Alternative considered:* extend the existing conditional `hint` field (`:1370-1377`). Rejected — `hint` is contextual and disappears once the `response-rendering` topic is attached, which is exactly the deep-retry state where the reminder matters most. They coexist; an error may carry both.

*Alternative considered:* rely on the tool description (`:1109`), which already says calling the tool ends the conversation. Rejected — it demonstrably did not hold at the decision point. The incident is the evidence: the description was in context the whole time.

### 2. Capture the escalation first, latch it, and carry it on every run outcome

Two moves:

- Move the capture to the **top** of the handler, ahead of both gates, reading from the raw arguments so a malformed sibling field cannot suppress it. A diagnostic then survives any rejected call.
- `buildSuccessResponse` (`src/claude/index.ts:373`) propagates `escalateToOwner` on the skip branch (`:387`) and the structured-response branch (`:413`) but **drops it** on the raw-text branch (`:418-425`) and the no-response branch (`:427-433`). Capturing on a rejected call is pointless if the run then ends without a successful `submit_response`, so those two branches must carry it too. The consumer needs no change — `handlerResponse.ts:769` is the single reader.

Retention is last-non-empty-wins, never cleared: a retry repeating the diagnostic overwrites harmlessly, and a retry omitting it keeps the earlier one rather than losing an operator signal.

## Risks / Trade-offs

**The reminder is noise on every error, including routine ones** → It is one short constant field on a result Claude is already reading and acting on; it costs a negligible number of tokens and only appears on failures. The alternative — showing it only on "suspicious" failures — requires exactly the heuristic ruled out in Non-Goals.

**A reminder may not change behavior; it is guidance, not a mechanism** → True, and worth stating plainly: this reduces the likelihood of a probe rather than preventing one. A hard mechanism (e.g. requiring an explicit confirmation flag after N failures, or blocking suspiciously minimal payloads) was rejected as either heuristic or contract-widening. If a probe recurs after this ships, that escalation is the next step and this change is a prerequisite for measuring it.

**Capturing an escalation from a rejected call could surface a diagnostic Claude meant to revise** → Accepted deliberately. A stale-but-real operator diagnostic beats today's behavior of losing it entirely, and last-non-empty-wins lets a retry correct it.

**Propagating on the no-response branch attaches an escalation to a run that failed outright** → That is the intent: a run that captured a diagnostic and then died is precisely when the operator most needs to hear about it.
