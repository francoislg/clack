# trivia-question-posting (delta)

## ADDED Requirements

### Requirement: post_questions stamps the answering model

`post_questions` SHALL resolve the effective `answeringType` for each question being posted and, when `"byTeam"`, stamp `answeringType: "byTeam"` plus the effective roster as `teamsStamp: { teams }` on the question record alongside the existing post-time stamps (`liveAnswersVisible`, `revealResponses`, `tagPlayers`). Individual-answering questions SHALL receive no new fields (absence reads as individual).

#### Scenario: byTeam stamp written at post time

- **WHEN** a question posts while the game resolves an effective `answeringType: "byTeam"` with a two-team roster
- **THEN** the stored record carries `answeringType: "byTeam"` and a `teamsStamp.teams` copy of both teams' names and userIds

#### Scenario: Individual questions stay legacy-shaped

- **WHEN** a question posts with resolved `answeringType: "individual"`
- **THEN** the stored record contains neither `answeringType` nor `teamsStamp`
