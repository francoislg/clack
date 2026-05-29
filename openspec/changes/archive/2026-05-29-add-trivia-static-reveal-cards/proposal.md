## Why

When a trivia round is revealed today the original question messages are never touched — they keep their (now locked-out) vote/answer buttons and their last live "Answered: …" roster footer. The verdict lives only in Claude's separate persona-voiced reveal message. Readers who scroll back to a question can't tell who got it right, and there is no way for a player to recall what they personally answered. This change bakes a **static, localized results footer** into each original question message at reveal time and replaces the live vote affordance with a single **"See your answer"** button that opens a private modal showing that user's own submission.

## What Changes

- At reveal, the reveal flow edits each processed question's **original Slack message in place** (one `chat.update`, mirroring the existing live-roster edit) to a final, static state. The edit is a one-time snapshot — it is NOT live-updating.
- The edited message gains a **static results footer** rendered from the question's stamped `revealResponses` mode, supporting all **four** modes equally:
  - `"yes"` / `"just-correctness"` — name the correct, incorrect, and no-answer voters.
  - `"just-winners"` — name the winners; show anonymous counts for missers / non-answerers.
  - `"no"` — show no names and no counts; the answer line only.
  - Every mode renders an **"Answer was: …"** line (boolean TRUE/FALSE, the correct choice option, or the freeform expected answer).
- The static results footer **replaces** the live "Answered: …" roster footer on the message (the card body above it is unchanged).
- The question's vote/answer buttons (boolean two-button, choice N-button, freeform "Answer" button — including any hint button in that actions block) are **removed** and replaced with a single **"See your answer"** button.
- Clicking "See your answer" opens a **read-only modal** scoped to the clicking user: it shows their own submitted answer plus a correct/incorrect verdict, or "you did not answer". A single action handler (registered once via a regex) serves every question; no view-submit handler is needed.
- Claude's separate persona-voiced reveal message is **unchanged** — the static footer complements it.
- All new user-facing strings are localized through the trivia plugin's `t()` (en + fr); the modal reuses the existing `modal.verdict_*` strings.

## Capabilities

### New Capabilities
- `trivia-reveal-cards`: the static reveal-time edit of each original question message — results-footer rendering per `revealResponses` mode, the vote-affordance→"See your answer" button swap, and the private "See your answer" modal interaction.

### Modified Capabilities
- `trivia-reveal-processor`: the reveal flow, after a question is successfully processed, edits that question's original message in place via the new card surface (a non-fatal side effect of processing).

## Impact

- **New code** (`src/plugins/trivia/`):
  - A static card editor `editRevealIntoCard` (sibling of `freeform/roster.ts:editRosterIntoCard`) that rebuilds from `postedBlocks`, strips the answer-actions block, and appends the results footer + "See your answer" button.
  - A results-footer renderer branching on `VoterBuckets.revealResponses` (4 modes) and on `RevealAnswerDescriptor.type` (3 formats) for the answer line.
  - A `reveal-see-answer:<questionId>` action handler (registered once) + a `buildSeeAnswerModal` that generalizes freeform's locked-modal verdict to all three formats, backed by a small per-handler `formatSubmittedAnswer` projection.
- **Modified code**:
  - `tools/reveal/processRevealAnswers.ts` — call the card editor once per successfully-processed question in the existing target loop; `RevealSlackDeps` gains a message-update capability (parallel to `fetchMessageReactions`).
  - `answerTypes/types.ts` + the three handlers (`boolean.ts`, `choice.ts`, `freeform.ts`) — add the `formatSubmittedAnswer` / correct-answer projection used by the footer and modal.
  - `i18n/strings/en.ts` + `fr.ts` — new `button.see_your_answer`, `reveal.*` footer labels, and a see-answer modal title; reuse existing `modal.verdict_*`.
- **No data migration**: everything the footer and modal need is already persisted (`postedBlocks`, `messageLink`, `revealResponses`, the answer rows) or present in the reveal payload (`VoterBuckets`). Legacy rows without `postedBlocks` skip the edit and log (as the roster edit already does). Reprocess repaints automatically.
- **No new Slack scopes** — `chat.update` and `views.open` are already in use.
