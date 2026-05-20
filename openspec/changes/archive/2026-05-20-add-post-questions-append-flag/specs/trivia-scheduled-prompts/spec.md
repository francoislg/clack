## ADDED Requirements

### Requirement: Question-posting prompt instructs retry-with-appendToPreviousBatch

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain an explicit retry clause attached to the `post_questions` step (step 10). The clause SHALL tell Claude that when a `post_questions` call returns one or more `results[].ok === false` entries, Claude SHALL make a follow-up `post_questions` call carrying only the failed items AND pass `appendToPreviousBatch: true` so the retried items share the original batch's `batchId` and reveal together with the original successes.

The clause SHALL name the flag (`appendToPreviousBatch`) literally and SHALL state the value (`true`) literally so the prompt is unambiguous.

The clause SHALL NOT instruct Claude to extract a `batchId` value from the prior response and pass it as a string. The batch-identifier handling is internal to the tool; Claude only flips the boolean.

The clause SHALL apply to BOTH outer flows (single-question and multi-slot). In the single-question flow it covers the rare case of one item failing in isolation; in the multi-slot flow it covers the common case of one slot's blocks being rejected while sibling slots post successfully.

#### Scenario: Prompt names appendToPreviousBatch in the retry clause

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the returned text contains the literal string `appendToPreviousBatch`
- **AND** contains the literal value `true` in proximity to that flag name (e.g. `appendToPreviousBatch: true`)
- **AND** explicitly ties the flag to the retry-of-failed-items scenario (not to brand-new batches)

#### Scenario: Prompt does NOT instruct Claude to thread a raw batchId string

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the returned text does NOT instruct Claude to read a `batchId` value out of the prior tool result and pass it as a `batchId: "..."` argument to `post_questions`
- **AND** does NOT contain instructions equivalent to "pass the previous call's batchId on retry"

#### Scenario: Prompt covers both single-question and multi-slot retry paths

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the retry clause is positioned so it applies regardless of whether the outer flow is single-question or multi-slot (e.g. it lives in the shared step 10 / "POST" section, not nested inside the multi-slot branch alone)
