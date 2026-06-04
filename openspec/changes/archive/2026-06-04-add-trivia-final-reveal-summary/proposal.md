## Why

The standalone reveal summary message (verdict + WHY + voter breakdown + leaderboard) is always posted top-level today. Some games want it gone (the narrative lives in the cards instead) or tucked into a thread so the channel only shows the leaderboard. This adds a `finalRevealSummary` axis controlling the summary's presence and placement. It is orthogonal to `includeRevealInQuestions` (a sibling change controlling per-card narrative) — together the two subsume what was originally drafted as a single `revealType` axis.

Depends on `refactor-trivia-reveal-tools` having shipped.

## What Changes

- **New `finalRevealSummary: "yes" | "no" | "in-thread"` axis**, cascading **game → workspace → default** (mirrors `allTimeRow`; NOT a per-question season/slot axis). Default `"yes"` = today's behavior. Resolved **fresh at reveal time** inside `compute_answers`, which returns the resolved value in its payload.
- **The leaderboard table is ALWAYS posted top-level**, in all three modes. `finalRevealSummary` governs only the reveal **narrative** (verdict / WHY / voter breakdown), not the leaderboard.
  - **`"yes"`** — narrative AND leaderboard posted top-level in one `submit_response` (today).
  - **`"no"`** — leaderboard posted top-level; the verdict/WHY/voter narrative is omitted entirely.
  - **`"in-thread"`** — leaderboard posted top-level with a localized "see the responses in thread!" pointer; the full reveal narrative (verdict, WHY, voter breakdown) is posted as a threaded reply under the top-level message, via `submit_response`'s `thread_replies`.
- **Season finale rides top-level in all modes.** The finale layout (winners podium + gated all-time table) is part of the leaderboard surface and SHALL always post top-level; the per-question reveal narrative for the day still follows `finalRevealSummary` (e.g. `"in-thread"` puts that day's verdicts in the thread while the finale + leaderboard stay top-level).
- **Reveal prompt branches the summary rendering on the axis** (type-gated instructions), choosing top-level narrative, no narrative, or top-level pointer + threaded narrative.
- **`finalRevealSummary` is settable** on a game via `upsert_game` and on the workspace via `set_workspace_config` (omit-to-keep / null-to-clear), and surfaced by `list_games`. NOT settable per-season/slot.
- Fully independent of `includeRevealInQuestions` — all combinations are valid (e.g. `finalRevealSummary: "no"` + `includeRevealInQuestions: "yes"` = narrative only in cards, leaderboard-only top-level).

## Capabilities

### New Capabilities
- `trivia-final-reveal-summary`: the `finalRevealSummary` axis (game+workspace resolver + default), the three-mode summary contract, and the leaderboard-always-top-level invariant.

### Modified Capabilities
- `trivia-reveal-processor`: `compute_answers` resolves `finalRevealSummary` (game→workspace→default) at reveal time and returns it in the payload.
- `trivia-scheduled-prompts`: the reveal prompt branches the summary narrative on the payload's `finalRevealSummary` (top-level / omitted / threaded), always posting the leaderboard top-level and the finale top-level.
- `trivia-games`: `TriviaGame` + workspace accept `finalRevealSummary`; `upsert_game` / `set_workspace_config` set it; `list_games` surfaces it (mirrors `allTimeRow`).

## Impact

- **Code:** `core/configTypes.ts` (type, default, fields), `core/configParsers/axes.ts` + `games.ts` + `configBridge.ts` (parse/validate, mirror `allTimeRow`), new `domain/finalRevealSummary.ts` resolver, `tools/reveal/computeAnswers.ts` (return the axis), `prompts/scheduledPrompts.ts` (three-mode summary branch + pointer string), management tools (`upsert_game` / `set_workspace_config` / `list_games`), i18n strings for the "see in thread" pointer.
- **Data:** new optional `finalRevealSummary?` on game + workspace. Absent → today. No migration; no question-record change.
- **Tests:** resolver cascade, parser/validator, reveal-prompt three-mode branch inspection (leaderboard always top-level; in-thread uses `thread_replies`; finale top-level), management round-trip, i18n parity for the pointer string.
- **Zero-config safety:** unset everywhere → `"yes"` → reveal summary behaves exactly as after the refactor.
