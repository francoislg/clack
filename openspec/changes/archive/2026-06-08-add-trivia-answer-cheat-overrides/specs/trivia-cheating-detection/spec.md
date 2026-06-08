## ADDED Requirements

### Requirement: `remove_cheat` admin tool removes a report and decrements the counter

The Trivia plugin SHALL expose a `remove_cheat` MCP tool, gated to the `admin` role and registered always-on (NOT behind the `trivia:management` integration), that removes cheat report(s) from a game's `cheats.json` and reverses their effect on the global cumulative `cheatAttempts` counter.

The tool SHALL accept:

- `game` (string, required) — the game slug; validated against `config.trivia.games[]` per the `trivia-games` capability (unknown → structured "unknown game" error; disabled → structured "game is disabled" error).
- `cheaterUserId` (string, required) — the Slack user ID whose cheat report is being removed.
- `questionId` (string, required) — the question the removed report(s) concern.

The tool SHALL remove EVERY entry in `data/plugins/trivia/games/<game>/cheats.json` whose `cheaterUserId` AND `questionId` both match the arguments, preserving the order of all other entries.

The tool SHALL decrement the global `cheatAttempts` counter on the cheater's record in `data/plugins/trivia/users.json` by the number of reports removed, floored at 0 (the counter SHALL never go negative).

When no entry matches `(cheaterUserId, questionId)`, the tool SHALL return a structured "no matching cheat" result and SHALL mutate neither `cheats.json` nor the counter (idempotent, safe to retry).

The tool result SHALL report the number of reports removed and the cheater's new `cheatAttempts` total. Because cheats filter scoring at reveal time, when the affected question has already been revealed the result SHALL indicate that the posted reveal card can be refreshed via the existing reprocess flow (`compute_answers` reprocess → `update_answers_block`).

Removal SHALL NOT emit any Slack message (no inverse of the `save_cheating` owner DM).

#### Scenario: Removing a cheat deletes the report and decrements the counter

- **GIVEN** `games/main/cheats.json` contains one entry `{ cheaterUserId: "U1", questionId: "Q1", reason: "...", detectedAt: "..." }` and `U1` has `cheatAttempts: 3` in the global `users.json`
- **WHEN** `remove_cheat({ game: "main", cheaterUserId: "U1", questionId: "Q1" })` is called by an admin
- **THEN** the matching entry is removed from `games/main/cheats.json` and other entries keep their order
- **AND** `U1`'s `cheatAttempts` becomes `2` in the global `users.json`
- **AND** the result reports `1` report removed and the new total `2`

#### Scenario: Multiple matching reports are all removed and counted

- **GIVEN** `games/main/cheats.json` contains two entries for `(U1, Q1)` and `U1` has `cheatAttempts: 5`
- **WHEN** `remove_cheat({ game: "main", cheaterUserId: "U1", questionId: "Q1" })` is called
- **THEN** both entries are removed
- **AND** `U1`'s `cheatAttempts` becomes `3`

#### Scenario: Counter floors at zero

- **GIVEN** `games/main/cheats.json` contains one entry for `(U1, Q1)` and `U1` has `cheatAttempts: 0` (drifted)
- **WHEN** `remove_cheat({ game: "main", cheaterUserId: "U1", questionId: "Q1" })` is called
- **THEN** the entry is removed
- **AND** `U1`'s `cheatAttempts` stays `0` (floored, never negative)

#### Scenario: No matching cheat is a safe no-op

- **WHEN** `remove_cheat` is called with a `(cheaterUserId, questionId)` pair that matches no entry
- **THEN** the tool returns a structured "no matching cheat" result
- **AND** `cheats.json` and the global `users.json` are unchanged

#### Scenario: Removal sends no Slack message

- **WHEN** `remove_cheat` removes a report
- **THEN** no owner DM or other Slack message is emitted

#### Scenario: Tool is admin-gated and always-on

- **WHEN** the trivia plugin loads
- **THEN** `remove_cheat` is registered with role `admin`
- **AND** it is NOT registered behind the `trivia:management` integration (an admin session sees it without `attach_integration`)
- **AND** a session whose user role is below `admin` does not see the tool in its MCP catalog
