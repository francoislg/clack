## MODIFIED Requirements

### Requirement: Posted Question Threads Engage Clarification Replies

When `post_questions` posts a question message, it SHALL engage that message's thread via `sdk.engageThread` with a non-`"off"` attention level and a pending-aware clarification `creationContext`.

The `creationContext` SHALL instruct Clack, on each human reply in the thread, to:
- re-read the ORIGINAL question message before responding;
- while the original message still shows the question as PENDING (it has not yet been edited to reveal the answer), lean toward answering a clarification request with the extra precision the asker needs;
- treat a PUBLIC request for more detail on a pending question as public information shared with the whole game — NOT cheating;
- once the original message shows the revealed answer, stop helping.

This `creationContext` SHALL be consistent with the `trivia-cheating-detection` carve-out — both describe the same boundary (clarification of a pending question is allowed; fishing for the answer is cheating) using the same examples, so they cannot drift. Because `creationContext` now also reaches the thread's pre-analysis judge, the gate SHALL see this same pending-vs-revealed boundary when deciding whether to engage a reply.

Posting SHALL remain functional when no engagement is desired: an attention level of `"off"` (or a deployment that does not opt in) leaves posting behavior unchanged.

#### Scenario: Posting a question seeds an engaged thread

- **WHEN** `post_questions` posts a question whose message timestamp is `1700000000.000500` in channel `C1`
- **THEN** it calls `sdk.engageThread("C1", "1700000000.000500", { attentionLevel: <non-off>, creationContext: <clarification context> })`

#### Scenario: Pending-question clarification is answered

- **GIVEN** a posted question thread that is still pending (the original message does not yet show the answer)
- **WHEN** a player replies "do you mean by area or by population?" in that thread
- **THEN** Clack answers the clarification with the needed precision
- **AND** does not flag it as cheating

#### Scenario: Answered question thread stops helping

- **GIVEN** the original question message now shows the revealed answer
- **WHEN** a player replies asking for more detail
- **THEN** Clack does not continue providing answer-revealing help (per the re-read-original-message instruction; the time-decay backstop also applies)
