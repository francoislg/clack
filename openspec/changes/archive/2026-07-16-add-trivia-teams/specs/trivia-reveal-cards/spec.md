# trivia-reveal-cards Delta

## ADDED Requirements

### Requirement: Reveal footer renders team names when teams mode is on

When the reveal payload carries team-grouped voter buckets, the reveal footer SHALL render team names in place of member names (free agents still rendered individually via `renderPlayerRef`, honoring the stamped `tagPlayers`). Team names are plain text and never Slack mentions. The footer never prints freeform answer texts (in individual mode either) — under `revealResponses: "yes"` on freeform questions, member answer texts SHALL instead be carried UNATTRIBUTED on the team's payload bucket entry (`teamVoters.*Teams[].answerTexts`), where the Claude-authored narrative quotes them under the team name.

#### Scenario: Footer shows team plus free agent

- **WHEN** the Correct bucket contains team "Red" and free agent Erica
- **THEN** the footer renders `✓ Correct: Red, <Erica per tagPlayers>` with no Red member names

#### Scenario: Freeform answer texts unattributed under team

- **WHEN** a freeform question with `revealResponses: "yes"` reveals with teams mode on and two Red members typed answers
- **THEN** the payload's team bucket entry carries both texts with no mapping back to which member typed which, and the narrative quotes them under "Red"

#### Scenario: Live roster stays individual

- **WHEN** a question is open (pre-reveal) with teams mode on
- **THEN** the live answer roster renders individual players exactly as today
