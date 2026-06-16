## Context

`post_questions` (`src/plugins/trivia/tools/questions/postQuestions.ts`) posts one top-level channel message per question in `args.items`, collecting a `results[]` array where each entry carries `{ questionId, ok, ts, permalink }`. Each permalink is also stamped on the question record as `messageLink`, and every question in a single fire shares a `batchId` (an existing UUID; `appendToPreviousBatch` reuses the prior fire's `batchId`).

The plugin already has the pieces this feature needs: unfurl suppression via `src/slack/unfurlOptions.ts` (`{ unfurl_links: false, unfurl_media: false }`, threaded through `postBlocks`'s `suppressUnfurls`), and a well-established **game+workspace-only knob pattern** exemplified by `tagPlayers` (`resolveTagPlayers(game, workspace)` in `src/plugins/trivia/domain/tagPlayers.ts`, deliberately excluded from `CascadeAxes`/`AXIS_REGISTRY`).

## Goals / Non-Goals

**Goals:**
- Add an opt-in `scrollToTop` knob cascading `game → workspace → false`.
- When enabled and a multi-question batch posts, append exactly one trailing top-level message linking to the batch's first question, with unfurls suppressed.
- Make the link target the true top of the batch even when `appendToPreviousBatch` adds questions to an earlier fire.
- Localize the trailing label via `sdk.t()`.

**Non-Goals:**
- No `CascadeAxes` membership — no slot or season tier. (Explicitly game+workspace only, per the requested scope.)
- No record stamping / schema migration — the value is consumed inline at post time and never re-read.
- No Claude/prompt involvement — purely deterministic in `post_questions`.
- No cleanup/repositioning of a prior fire's trailing message on append (see Risks).
- No change to default behavior: absent/false ⇒ identical to today.

## Decisions

**1. Mirror the `tagPlayers` pattern, not `CascadeAxes`.**
The requested scope is "per game/workspace", which is exactly the `tagPlayers` shape: optional boolean on `TriviaGame` + `TriviaConfig`, a `DEFAULT_SCROLL_TO_TOP = false` constant, a dedicated `resolveScrollToTop(game, workspace)` resolver in `src/plugins/trivia/domain/scrollToTop.ts`, manual boolean validation in `configBridge.ts`, and present-iff-set surfacing in `list_games`. Adding it to `CascadeAxes` would force slot/season tiers and `AXIS_REGISTRY` plumbing the feature does not need.
*Alternative considered:* a full cascade axis — rejected as over-scoped (the user asked for game/workspace only) and heavier (registry parity tests, slot/season resolution).

**2. Deterministic posting inside `post_questions`, no Claude.**
After the post loop, `post_questions` resolves the knob and, when enabled, posts the trailing message itself. The message content is fully mechanical (a fixed localized label + one permalink), so there is nothing for Claude to author.
*Alternative considered:* surface the knob in `get_ideas` and have Claude post it — rejected: adds prompt surface and a "Claude forgot" failure mode for zero wording benefit.

**3. Target the batch's earliest message, computed from `batchId`.**
After posting, load the questions for the resolved `batchId`, order by `postedAt` ascending, and take the first non-empty `messageLink`. This uniformly yields the true top for both fresh batches (the records just stamped this fire) and `appendToPreviousBatch` fires (records from the earlier fire are included via the shared `batchId`).
*Alternative considered:* use `results[0].permalink` — correct for fresh batches but wrong for appends (would link to this fire's first, not the batch's first).

**4. Gate on 2+ posted messages.**
A "scroll to the top" link is meaningless when only one message exists. The trailing message posts only when the batch has ≥2 question messages. For appends, the gate uses the batch's total message count (≥2), which is effectively always true once appending.
*Alternative considered:* always post when enabled — rejected: emits a redundant self-referential message for single-question fires.

**5. No record stamping.**
Unlike `tagPlayers` (read later by roster/reveal), this knob is consumed once, synchronously, at post time. Stamping it on `TriviaQuestion` would be dead state.

**6. Localized label via `sdk.t()`.**
The label is a deterministic block on the direct-to-Slack path, so it must route through the plugin dictionary (`en`/`fr`), per the project's i18n rule. Rendered as mrkdwn `<permalink|📜 {label}>` in a single section block; the 📜 emoji is literal Unicode (Slack mrkdwn `:scroll:` shortcode also works, but Unicode avoids shortcode-rendering surprises).

## Risks / Trade-offs

- **Stale trailing message on append** → On an `appendToPreviousBatch` fire, the previous fire's trailing message stays where it was (now mid-thread) and a fresh trailing message posts at the new bottom; both link to the same top, so it is harmless but slightly redundant. Mitigation: accept it (deleting the old one would require tracking its `ts` — out of scope). Document in the spec.
- **Permalink fetch failure** → `getPermalink` (already used by the per-question post) could fail or a record could lack `messageLink`. Mitigation: if no usable `messageLink` is found for the batch, skip the trailing message silently (log a warning) rather than erroring the whole fire.
- **Extra Slack API call per enabled batch** → one additional `postMessage` (+ no permalink fetch needed for the trailing message itself). Negligible; only when enabled.
- **Too-strict config validation wiping state** → follow the graceful workspace-validation pattern already used for `tagPlayers` in `configBridge.ts` (reject only non-boolean, leave absent = default); do not add strictness that could drop the field.
