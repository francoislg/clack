## Context

Question messages are posted by `post_questions`, which appends a per-format answer-actions block (boolean two buttons / choice N buttons / freeform "Answer" button, plus an optional hint button) and persists the full block array as `postedBlocks` alongside `messageLink` and the stamped `revealResponses` mode. During the live phase, every click repaints the message via `editRosterIntoCard` (`freeform/roster.ts`) — a `chat.update` that rebuilds from `postedBlocks` and appends a divider + live "Answered: …" footer.

At reveal, `process_reveal_answers` loops the oldest pending batch, calls each question's `handler.processReveal(...)`, stamps `processedAt`, and returns a payload whose `reveals[i].voters` is a `VoterBuckets` discriminated union (keyed on `revealResponses`, cheaters/bot already stripped) and `reveals[i].answer` is a `RevealAnswerDescriptor`. Claude then renders a separate persona-voiced reveal message. The original question messages are never edited at reveal — buttons stay (locked out) and the live roster footer is the last thing shown.

This design adds a one-time static edit of each original message at reveal, plus a private "See your answer" modal.

## Goals / Non-Goals

**Goals:**
- One-time (static) `chat.update` of each processed question's original message at reveal, rebuilt deterministically from `postedBlocks`.
- A results footer that renders correctly for all four `revealResponses` modes, replacing the live roster footer.
- Remove the vote/answer affordance; add a single "See your answer" button registered through one regex action handler.
- A read-only modal showing the clicking user's own answer + verdict (or "did not answer"), generalizing freeform's existing locked modal to all formats.
- Full en/fr localization; no Claude in the static path.

**Non-Goals:**
- Changing Claude's separate reveal message (it stays; the footer complements it).
- Live-updating the footer after reveal — it is a static snapshot.
- Showing reaction commentary in the static footer (that stays Claude's territory).
- Any new persistence, migration, or Slack scope.

## Decisions

### D1: Trigger the card edit from the reveal tool loop, not inside `processReveal`
After `handler.processReveal` returns `{ ok: true, entry }`, the tool (`processRevealAnswers.ts`) calls `editRevealIntoCard({ updateMessage, question, entry, handler })` once. The tool already holds both the question record (for `postedBlocks`) and the freshly built `entry` (for `voters` + `answer`).

- **Alternative considered:** do the edit inside each handler's `processReveal`. Rejected — handlers currently take no Slack write client (only `fetchMessageReactions`); threading `chat.update` into all three duplicates the call and mixes payload-building with a presentation side effect. The tool already centralizes leaderboard/season side effects, so the card edit belongs there too.
- `RevealSlackDeps` gains `updateMessage(channel, ts, blocks)` parallel to `fetchMessageReactions`, keeping the Slack seam test-fakeable.

### D2: Render the footer from `VoterBuckets` + `RevealAnswerDescriptor`, reusing the reveal payload
The footer renderer switches on `entry.voters.revealResponses` for the voter section (4 modes) and on `entry.answer.type` for the "Answer was: …" line (3 formats). Reusing the payload means cheater/bot exclusion and per-mode disclosure are inherited for free — "support all four equally" is automatic.

- `"yes"` / `"just-correctness"`: name `correct` / `incorrect` / `noAnswer` (these variants already differ only by freeform `answerText`, which the footer doesn't print anyway).
- `"just-winners"`: name `correct`; render `incorrectCount` / `noAnswerCount` as anonymous count lines.
- `"no"`: answer line only — no names, no counts.

### D3: Rebuild-from-`postedBlocks`, strip the answer-actions block, append footer + button
Mirror `editRosterIntoCard`'s "always rebuild from `postedBlocks`, never from current Slack state" rule so repeated edits can't accumulate stale blocks. Identify and drop the answer-actions block by its known `block_id` prefixes (`vote-actions:`, `freeform-answer-actions:`) — this also drops any hint button sharing that block. Then append: a divider, the results footer block(s), and a fresh actions block holding the single "See your answer" button (`action_id = reveal-see-answer:<questionId>`). The live roster footer is not re-added, so it is effectively replaced.

### D4: One action handler, read-only modal, per-handler answer projection
Register `reveal-see-answer:<questionId>` once via `sdk.registerAction(/^reveal-see-answer:[^:]+$/, …)` (mirrors freeform's single-regex registration). The handler scans games for the question (existing `findGameForQuestion` pattern), loads the clicker's row, and calls `views.open` with a modal built by `buildSeeAnswerModal`. No `registerView` — the modal has only a Close button.

The per-format "your answer" string and the correct-answer string are produced by a small handler method (`formatSubmittedAnswer(question, row)` and a correct-answer projection) so the shared renderer/modal never branches on `answersFormat` — consistent with the registry's no-format-string-branching convention. Boolean → 👍 TRUE / 👎 FALSE; choice → the chosen option text; freeform → the typed text. The modal verdict line reuses the existing `modal.verdict_correct` / `modal.verdict_incorrect` / `modal.verdict_no_submission` strings.

### D5: All new strings localized; static path is template-only
`button.see_your_answer`, the `reveal.*` footer labels (correct/incorrect/no-answer labels, anonymous-count phrases, "Answer was"), and a see-answer modal title are added to `en.ts` + `fr.ts`. The static footer is template-rendered through `t()` — no LLM — so it is deterministic and reproducible on reprocess.

## Risks / Trade-offs

- **[Legacy rows without `postedBlocks`]** → skip the edit and log, exactly as `editRosterIntoCard` already does; the reveal payload still returns to Claude so the verdict is not lost.
- **[`chat.update` fails (message deleted, rate limit)]** → log and continue; the edit is a non-fatal side effect of processing, never blocking the payload or the leaderboard.
- **[Redundancy with Claude's reveal message]** → accepted by design (user chose "complement, keep both"); the static footer is the durable scroll-back record, Claude's message is the live narration.
- **[Mid-deploy: a question revealed before this ships]** → its message keeps the old locked buttons; only questions revealed after deploy get the static edit. Reprocess can repaint older ones on demand.
- **[Cheater clicks "See your answer"]** → their dropped/absent row yields "did not answer"; the modal is private, so no leak.
