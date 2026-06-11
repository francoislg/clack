## Why

When a question is locked (voting frozen, outcome not yet revealed — the motivating case being prediction games locked at an event's kickoff), the live-card rebuild strips the roster entirely and shows only a "🔒 locked in" notice. The locked-in votes vanish, which is the most interesting moment for a prediction: everyone has committed a pick and is waiting on the result. The admin already expresses a votes-disclosure intent via `revealResponses`; the locked window should honor it instead of unconditionally hiding.

## What Changes

- The live-card rebuild's `answerLocked === true` branch keeps the localized "🔒 locked in" notice, then appends a roster footer whose disclosure is driven by the question's stamped `revealResponses` value:
  - `"yes"` → notice + the full grouped vote distribution (every answerer named under their pick).
  - `"just-correctness"` / `"just-winners"` → notice + a flat participation roster (who answered, no picks).
  - `"no"` → notice only, no roster (today's behavior).
- `liveAnswersVisible` is **not** consulted while locked — it governs only the live (voting-open) phase, where its purpose is anti-bandwagoning. Once voting is frozen that risk is gone, so the locked window keys entirely off `revealResponses`. The live (unlocked) and reveal phases are unchanged.
- During the locked window there is no settled outcome, so `"just-correctness"`/`"just-winners"` cannot partition by correctness; they degrade to participation-only (names, no picks). Full correctness bucketing still happens only at the actual reveal.
- The cheater-row filter that the unlocked roster applies SHALL also apply to the locked roster.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-question-posting`: the "Live-card rebuild honors answerLocked" requirement changes — the `answerLocked === true` branch no longer unconditionally omits the roster; it appends a `revealResponses`-driven roster footer below the locked notice (full distribution / participation-only / none).

## Impact

- `src/plugins/trivia/freeform/roster.ts` — `editRosterIntoCard` locked branch + `buildRosterBlock` (needs an explicit render-mode param so the locked call can force grouped/flat from `revealResponses` rather than reading `liveAnswersVisible`).
- Tests: `roster` unit tests covering the three locked-window disclosure modes and the cheater filter under lock.
- No config, schema, or migration changes — `revealResponses` is already stamped on the question record at post time. Pure render-path change; reveal and live-voting behavior untouched.
