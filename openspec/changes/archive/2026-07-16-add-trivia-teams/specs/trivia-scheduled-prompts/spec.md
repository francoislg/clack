# trivia-scheduled-prompts Delta

## ADDED Requirements

### Requirement: Reveal prompt carries a teams-mode standings table contract

The reveal prompt SHALL include a TEAMS MODE section, active only when the payload carries `teamStandings`, directing Claude to render ONE standings table with: team columns first (ordered by current-season points desc), free-agent columns after (individual counts), the usual rows (This Round, Current Season, and All Time under its existing `allTimeRow` gating), and the per-cell All Time rule — a team's All Time cell renders its accumulated value only when the payload provides one (name matched prior seasons), otherwise the cell is empty. Individual player columns for team members SHALL NOT appear. When the payload signals `finaleIndividuals`, the prompt SHALL direct Claude to append the classic individual leaderboard table below the team tables. When the payload has no `teamStandings`, the existing individual table contract applies unchanged.

#### Scenario: Teams-first table

- **WHEN** the reveal payload includes `teamStandings` for Red and Blue plus free agents Erica and Mark
- **THEN** the rendered table columns are Red, Blue, Erica, Mark — no columns for individual team members

#### Scenario: Per-cell All Time

- **WHEN** Red has all-time history and Blue is in its first season
- **THEN** the All Time row shows Red's accumulated value and an empty cell for Blue

#### Scenario: Finale individuals appended

- **WHEN** the payload signals the season's last fire with `finaleIndividuals: true`
- **THEN** the classic individual leaderboard is rendered as an additional table below the team standings

#### Scenario: Narrative names teams

- **WHEN** the reveal narrative discusses who got a question right with teams mode on
- **THEN** it references team names (and free agents individually), not team-member names
