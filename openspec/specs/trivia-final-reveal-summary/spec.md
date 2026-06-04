# trivia-final-reveal-summary

## Purpose

Control over the standalone reveal-summary narrative (verdict + WHY + voter breakdown) at trivia reveal time, gated by a `finalRevealSummary` axis. The summary is posted top-level today; this capability lets a game or workspace drop it (`"no"`) or move it into a thread (`"in-thread"`) while ALWAYS keeping the leaderboard — and the season finale — top-level. The axis is orthogonal to `includeRevealInQuestions` (the per-card narrative), and defaults to `"yes"` so existing games behave exactly as before.

## Requirements

### Requirement: `finalRevealSummary` axis resolves game → workspace → default

The trivia plugin SHALL support a `finalRevealSummary` setting with values `"yes" | "no" | "in-thread"`, settable on a game (`TriviaGame.finalRevealSummary`) and on the workspace (`TriviaConfig.finalRevealSummary`). It SHALL be resolved by a dedicated resolver `resolveFinalRevealSummary(game, workspace)` with the cascade `game → workspace → "yes"`. There SHALL be NO season or slot tier and NO `CascadeAxes`/`AXIS_REGISTRY` membership — the resolver mirrors `resolveAllTimeRow`. The built-in default SHALL be `"yes"` (today's behavior). The parser SHALL reject any value other than the three literals with a field-scoped error and drop the offending value while preserving the entry.

#### Scenario: Game value wins over workspace

- **GIVEN** `game.finalRevealSummary === "in-thread"` and `workspace.finalRevealSummary === "yes"`
- **WHEN** `resolveFinalRevealSummary(game, workspace)` is called
- **THEN** it returns `"in-thread"`

#### Scenario: Default applies when unset

- **GIVEN** neither tier sets the axis
- **WHEN** `resolveFinalRevealSummary(game, workspace)` is called
- **THEN** it returns `"yes"`

#### Scenario: Invalid value rejected at parse time

- **WHEN** a game or workspace config supplies `finalRevealSummary: "dm"`
- **THEN** the parser emits a field-scoped validation error and drops the value

### Requirement: Leaderboard is always posted top-level; the axis governs only the narrative

In ALL three modes, the closing `submit_response` SHALL post the leaderboard `table` top-level. `finalRevealSummary` SHALL govern only the reveal **narrative** (the verdict `header`, the WHY `section`, and the per-bucket voter sections), never the leaderboard:

- **`"yes"`** — the narrative AND the leaderboard are posted top-level in one `submit_response` (today's layout).
- **`"no"`** — the leaderboard is posted top-level; the verdict/WHY/voter narrative is omitted entirely. The reveal is never fully silent — a top-level standings message always posts.
- **`"in-thread"`** — the primary top-level message carries the leaderboard `table` plus a localized "see the responses in thread!" `context` pointer; the full reveal narrative is posted as a threaded reply under the primary via `submit_response`'s `thread_replies`.

#### Scenario: yes posts narrative and leaderboard top-level

- **GIVEN** a game resolving `finalRevealSummary: "yes"`
- **WHEN** the reveal renders
- **THEN** the verdict/WHY/voter narrative and the leaderboard `table` are all in the single top-level `submit_response`

#### Scenario: no posts leaderboard only, no narrative

- **GIVEN** a game resolving `finalRevealSummary: "no"`
- **WHEN** the reveal renders
- **THEN** the top-level message carries the leaderboard `table`
- **AND** no verdict/WHY/voter narrative blocks are posted anywhere by the summary step

#### Scenario: in-thread posts leaderboard + pointer top-level and narrative in thread

- **GIVEN** a game resolving `finalRevealSummary: "in-thread"`
- **WHEN** the reveal renders
- **THEN** the primary top-level message carries the leaderboard `table` and a localized "see the responses in thread!" pointer
- **AND** the verdict/WHY/voter narrative is posted as a `thread_replies` entry under the primary

### Requirement: Season finale stays top-level in all summary modes

On the season's last fire, the finale layout (winners podium + gated all-time table) SHALL be posted top-level in ALL `finalRevealSummary` modes, because it is the leaderboard surface in its last-fire form. In `"in-thread"` mode the finale + standings stay top-level while the day's per-question reveal narrative still goes to the thread; in `"no"` mode the finale still posts top-level (the narrative omission does not suppress the finale).

#### Scenario: in-thread keeps the finale top-level

- **GIVEN** a game resolving `finalRevealSummary: "in-thread"` on the season's last fire
- **WHEN** the reveal renders
- **THEN** the finale (podium + gated all-time table) is posted top-level
- **AND** the day's per-question verdict narrative is posted in the thread

#### Scenario: no keeps the finale top-level

- **GIVEN** a game resolving `finalRevealSummary: "no"` on the season's last fire
- **WHEN** the reveal renders
- **THEN** the finale is posted top-level (only the normal per-question narrative is omitted)

### Requirement: "See responses in thread" pointer is localized

The `"in-thread"` pointer string SHALL resolve through the trivia plugin's `sdk.t()` with both English and French values present, and SHALL NOT be a hardcoded literal in the prompt or blocks.

#### Scenario: Pointer renders in the configured language

- **WHEN** the workspace language is French and the reveal renders in `"in-thread"` mode
- **THEN** the pointer text renders from the French dictionary value
