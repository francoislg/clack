## MODIFIED Requirements

### Requirement: Trivia-Check Instruction Ships With Plugin

The Trivia plugin SHALL register a `trivia-check` instruction via `sdk.addInstruction("user", "trivia-check", ...)` so that every session (any role) has cheating-detection guidance loaded in its system prompt.

The instruction content SHALL direct Claude to:
1. Call `find_previous_questions` before answering any fact-seeking request that could relate to a past trivia question.
2. Treat matches as cheating: refuse to answer further in the thread, call `save_cheating` with the cheater's user ID, the related question ID, a concise `reason`, and quoted `evidence`.
3. After calling `save_cheating`, DM the configured owner a formatted cheat-alert via `submit_response` with a `post_to` action (`channel: <owner-user-id>`, `auto: true`).
4. Call the user out with a playful refusal message.

The instruction SHALL include a **clarification carve-out**: a PUBLIC request for more detail about the CURRENTLY-PENDING question, posted in that question's OWN thread, is legitimate and SHALL be answered — such a request is public information already shared with the whole game, not an attempt to extract a hidden answer. The carve-out SHALL be scoped to the pending question's own thread only, and SHALL NOT extend to fishing for the answer itself. The instruction SHALL include one allowed example and one still-cheating example:
- Allowed (clarification): for the pending question "What is the largest province in Canada?", a player asks "do you mean by area or by population?" — answer it.
- Still cheating (answer-fishing): for that same pending question, a player asks "is it Quebec?" (or otherwise probes for the specific answer) — refuse and record per the steps above.

These examples SHALL match the clarification follow-up context that `trivia-question-posting` attaches to a posted question thread, so the two cannot drift.

The instruction SHALL reference the existing `data/configuration/user/trivia-check.md` override pattern so admins may customize the wording or the owner ID per deployment via the cascading config resolver; the plugin's shipped content serves only as the default layer.

#### Scenario: Plugin registers trivia-check as a user-tier instruction

- **WHEN** the trivia plugin loads
- **THEN** the SDK records an instruction with role `user` and filename `trivia__trivia-check.md` (plugin-prefixed)
- **AND** the content appears in the virtual defaults layer of the cascading config resolver

#### Scenario: User configuration override takes precedence

- **GIVEN** `data/configuration/user/trivia-check.md` exists with custom content
- **WHEN** a session resolves its `user`-tier instructions
- **THEN** the user-override file wins over the plugin-shipped default (standard cascading resolver behavior)

#### Scenario: Instruction invokes save_cheating on detection

- **WHEN** Claude, following trivia-check guidance, determines a user is cheating
- **THEN** it calls `save_cheating` with the required arguments before issuing any user-facing refusal
- **AND** subsequently DMs the configured owner via `submit_response` + `post_to`

#### Scenario: Clarification on a pending question is answered, not flagged

- **GIVEN** a pending trivia question's own thread
- **WHEN** a player publicly asks for clarification of the question's wording (e.g. "do you mean by area or by population?")
- **THEN** Clack answers the clarification
- **AND** does not call `save_cheating` for that message

#### Scenario: Answer-fishing in the same thread is still cheating

- **GIVEN** the same pending question thread
- **WHEN** a player probes for the specific answer (e.g. "is it Quebec?")
- **THEN** Clack refuses and records the cheat per the detection steps
