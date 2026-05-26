## Context

The trivia plugin currently uses three different answer-submission mechanisms across its three question formats:

| Format | Affordance | Storage path | Reveal scoring |
|---|---|---|---|
| `boolean` | Auto-attached `:+1:` / `:-1:` reactions | None at write time | `process_reveal_answers` fetches reactions, calls `categorizeBoolean`, scoring derived from reaction sets |
| `choice` | Auto-attached `:one:` / `:two:` / `:three:` / `:four:` reactions | None at write time | `process_reveal_answers` fetches reactions, calls `categorizeChoice`, multi-react voters silently voided |
| `freeform` | "Answer" button → modal → `submit_answer` view handler | Writes to `answers.json` directly | `process_reveal_answers` reads `answers.json`, batched Haiku judge call assigns verdicts |

Slack does not guarantee the visual ordering of message reactions — they appear in the order users first react, not in the order the bot attached them. For choice questions, this means `:one:` can appear AFTER `:three:` in the UI, and answerers regularly mis-click. Boolean ordering is more tolerable because there are only two reactions, but the inconsistency still feels janky alongside the freeform flow's clean button + roster footer.

A second source of friction is the dual role reactions play today: they are simultaneously the vote affordance and the social commentary channel. The reveal flow has to filter reactions through `cleanReactionLists` (strip bot + cheaters), then categorize what remains into "voted correctly," "voted wrong," "fence-sitter" (boolean only — voted both sides), "multi-react void" (choice only — silently dropped), and "wildcard" (reacted with non-vote emoji). The wildcard bucket exists *because* reactions are overloaded — when reactions become commentary-only, every reactor is structurally a "wildcard" and the categorization collapses.

The freeform path already demonstrates the unified approach: a button writes to disk, a "📝 Answered" roster footer updates in place via `chat.update`, and reveal reads from disk. This proposal generalizes that pattern to all three formats.

**Constraints:**
- Plugin must stay within the SDK boundary (`src/plugins/CLAUDE.md`) — no imports from outside `src/plugins/trivia/`
- Action ID dispatch goes through `sdk.registerAction(regex, handler)` exactly as the freeform path already uses
- Slack action_id has a 255-char limit; button text truncates visually at 75 chars
- Context block elements have a ~3000-char limit, but compact-on-mobile rendering degrades sooner (~250 chars)
- The plugin's `data/plugins/trivia/games/<game>/questions.json` and `answers.json` shapes already support all needed fields — no migration required

**Stakeholders:**
- Trivia players (the change affects every question they answer)
- Trivia admins (the new `liveAnswersVisible` config introduces one knob across four cascade tiers)
- The reveal-rendering prompt (its voter payload contract changes)

## Goals / Non-Goals

**Goals:**

- Unify all three formats around button-driven answer submission
- Make reaction order in the UI irrelevant to scoring
- Keep emoji reactions as a fun side-channel for the reveal flow to riff on
- Add a live, configurable roster footer showing who answered and (by default) what they picked
- Eliminate the `submit_answers` MCP tool and the reaction-derivation scoring pipeline
- Preserve cheater exclusion semantics without depending on reaction-list cleaning

**Non-Goals:**

- Backwards compatibility for in-flight questions across deploy (operational call: deploy during quiet window)
- Modal-based answering for boolean/choice (the modal stays freeform-only)
- Fuzzy grouping of similar freeform answers (exact-match grouping only)
- Per-format `liveAnswersVisible` overrides (one knob applies to all three formats uniformly)
- Ephemeral click confirmations (the roster footer update is the confirmation)
- Changing how cheats are detected or reported (`save_cheating` keeps its current shape and write path)

## Decisions

### D1. Delete `submit_answers`, write answers at click time

**Decision:** The `submit_answers` MCP tool is removed entirely. Button-click handlers write `SubmittedAnswer` rows to `answers.json` synchronously, the same way the freeform view-submit handler does today.

**Why:** With buttons, there is no longer a reveal-time decision to make about "what did this user vote." The click event carries the answer; persisting it at click time is the simplest possible path. Keeping `submit_answers` alongside the new write path would create two sources of truth (Slack reactions vs. on-disk answers) and require either reconciliation or a deprecation period.

**Alternatives considered:**
- Keep `submit_answers` as a manual escape hatch for admins to backfill votes. Rejected — admins can edit `answers.json` directly if needed; the MCP surface is for Claude, not for human admins.
- Keep `submit_answers` and have the click handler emit a synthetic event that calls it. Rejected — adds indirection without solving any real problem.

### D2. Voter payload shape: separate buckets from commentary

**Decision:** The reveal payload's `voters` field becomes:

```typescript
voters: {
  correct: Voter[],                          // from answers.json
  incorrect: Voter[],                        // from answers.json
  noAnswer: Voter[],                         // reacted to the message but didn't click a button
  reactions: Array<{                         // every reactor's full emoji set
    userId: string,
    displayName: string,
    emojis: string[],
  }>,
}
```

- `fenceSitters` (boolean-only "voted both sides") removed — structurally impossible with buttons
- `wildcards` (single-emoji-per-reactor, non-vote emoji only) removed — subsumed by the richer `reactions` array
- Both `noAnswer` and `reactions` exclude the bot user and every flagged cheater

For freeform questions, `correct[]` and `incorrect[]` each carry an additional `answerText` field on the `Voter` shape, exactly as today.

**Why:** Separating "did they answer correctly" from "what did they react with" lets the reveal renderer correlate the two without conflating them. A player who clicks the right button and also drops a 🎯 emoji shows up in both `correct` and `reactions` — and the reveal prompt can riff on the combination ("Marc nailed it AND added a 🎯"). The `noAnswer` bucket preserves today's social-pressure beat ("Sarah dropped a 🐢 but never voted").

**Alternatives considered:**
- Per-user combined view `{ userId, answer?, reactions[] }[]`. Rejected — loses the easy `correct.length` / iterate-correct ergonomics the renderer relies on today; renderer would have to filter every time.
- Keep `wildcards` as "people who reacted but didn't answer," drop `noAnswer`. Rejected — the name `wildcards` was tied to the multi-react/non-vote-emoji concept; renaming it to mean something else creates churn. `noAnswer` is more literal.

### D3. Cheater filtering at read time, in both the live footer and the reveal payload

**Decision:** Cheats are filtered at two read points:

1. `editRosterIntoCard` reads `cheats.json` before grouping answerers; flagged cheaters are excluded from the live roster footer.
2. The reveal payload builder reads `cheats.json` when assembling `correct`/`incorrect`/`noAnswer`/`reactions`; flagged cheaters are excluded from every bucket.

Cheaters' raw rows in `answers.json` are NOT deleted — the audit trail remains intact, only the public display is sanitized.

**Why:** `save_cheating` can be called at any point during a round, including AFTER a click has been written to disk. Write-time filtering would either miss late-reported cheats or require a "purge on flag" hook, both of which are more complex than read-time filtering. The freeform reveal path already uses read-time filtering (cheats consulted at leaderboard time); generalizing to the live footer is one extra read.

**Alternatives considered:**
- Block the click in the action handler if user is in `cheats.json`. Rejected — late-reported cheats still slip through; doubles the filtering logic.
- Soft-delete answers when a cheat is flagged. Rejected — destroys the audit trail; complicates retro reasoning about what actually happened.

### D4. `liveAnswersVisible` cascade and persistence

**Decision:** Add a single boolean field `liveAnswersVisible` to the trivia config schema, with cascade order matching the existing structural overrides:

```
slot.liveAnswersVisible (within SeasonFormat.questions[])
  → season.liveAnswersVisible (on SeasonEntry)
    → game.liveAnswersVisible (on TriviaGame)
      → config.trivia.liveAnswersVisible (workspace level)
        → default: true
```

Resolution happens inside `post_questions` at the moment each question is being staged. The resolved boolean is **stamped onto the question record** as `TriviaQuestion.liveAnswersVisible`. Subsequent reads (every roster footer rebuild via `editRosterIntoCard`) read from the question record, NOT from live config.

**Why this stamping pattern:** Mirrors how `season`, `slot.label`, and `context` are already denormalized onto question records. Prevents the surprise of a mid-round config edit flipping live behavior under a question that's already collecting answers. Also keeps the roster-footer rebuild path side-effect-free with respect to the cascade resolver.

**Default = true:** The richer footer is more interesting to watch and creates real-time stakes. Admins who want suspense can flip it off at any cascade tier.

**Applies uniformly across formats:** Yes — including freeform. A `liveAnswersVisible: true` freeform question shows each user's typed text (truncated) in the live footer; `false` shows only names. This was an explicit design call (consistency across formats; admins who want freeform suspense flip the knob).

**Alternatives considered:**
- Resolve at read time on every roster rebuild. Rejected — config edits would mid-round flip live questions.
- Two separate knobs (`liveAnswersVisible` for boolean/choice, `liveFreeformVisible` for freeform). Rejected — added complexity without a real use case surfaced; can be split later if needed.
- Per-format defaults (e.g., default-true for boolean/choice, default-false for freeform). Rejected — inconsistent mental model.

### D5. Roster footer layout: compact-first, multiline-fallback, per-group 5-cap

**Decision:** The roster footer is a context block whose text is generated as follows:

1. Group answerers by their answer value (exact match on `answer` / `answerIndex` / `answerText`). Boolean has up to 2 groups; choice has up to 4; freeform has as many groups as unique answer strings (typically all size 1).
2. Within each group, sort by `timestamp` descending and take the top 5. Beyond 5, append `+N` (where N = group size − 5).
3. **Visible mode** (`liveAnswersVisible: true`): try the compact single-line format first:
   ```
   📝 Answered: 👍 (8) @marc, @sarah, @kim, @ahmed, @lee +3 · 👎 (2) @jane, @bob
   ```
   If the resulting string exceeds ~250 chars, fall back to multiline:
   ```
   📝 Answered:
     👍 (8): @marc, @sarah, @kim, @ahmed, @lee +3
     👎 (2): @jane, @bob
   ```
4. **Hidden mode** (`liveAnswersVisible: false`): ungrouped flat list, capped at 5 most recent total, with `+N` overflow:
   ```
   📝 Answered: @marc, @sarah, @kim, @ahmed, @lee +3
   ```

**Per-format group labels:**
- boolean: `👍` and `👎`
- choice: `1️⃣` / `2️⃣` / `3️⃣` / `4️⃣` (numbered emoji aligned with the button labels)
- freeform: the answer text itself, truncated to ~40 chars with `…`

**Why:** Slack context blocks render poorly on mobile past ~250 chars (line wrapping becomes inconsistent and indentation breaks down). Compact-first handles the common case (small channels, short answers); multiline-fallback handles large channels and long freeform answers. The 5-cap matches the user's "5 most recent" preference and prevents context-block overflow in 50+ person channels.

**Alternatives considered:**
- Always multiline. Rejected — wastes vertical space for short rounds (2 voters total feels overcooked as a 3-line footer).
- Total 5-cap across all groups instead of per-group. Rejected — a 10-person boolean round would lose half its visibility for one side.

### D6. Block layout: FIVE-BLOCK → FOUR-BLOCK + actions

**Decision:** The question card collapses from FIVE blocks to FOUR blocks plus an `actions` block:

```
Before (FIVE-BLOCK + reactions):
  1. header  — show banner
  2. section — patter
  3. card    — title + statement
  4. section — answer-options text ("👍 TRUE · 👎 FALSE" or "1️⃣ Beatles · 2️⃣ Zeppelin · …")
  5. context — closer
  + auto-attached reactions for voting

After (FOUR-BLOCK + actions):
  1. header  — show banner
  2. section — patter
  3. card    — title + statement
  4. context — closer
  5. actions — buttons
  + (eventual roster footer appended on first click via chat.update)
```

For freeform, the FOUR-BLOCK + actions shape is identical (single "Answer" button). For boolean: two buttons (`👍 TRUE`, `👎 FALSE`). For choice: 2–4 buttons (`1️⃣ <text>` … `4️⃣ <text>`).

**Button text length:** Slack truncates button labels at 75 chars. For choice text exceeding ~70 chars (after the numbered emoji prefix), the label truncates visually but the card body still carries the full statement — voters who need disambiguation can re-read the card. The prompt will warn Claude to keep choice text concise.

**Action ID shape:** `vote:<questionId>:<value>` where:
- boolean: `value ∈ {"true", "false"}`
- choice: `value ∈ {"0", "1", "2", "3"}`
- freeform: stays on the existing `freeform-answer:<questionId>` action (modal trigger)

Registration regex: `/^vote:[^:]+:[^:]+$/` for the new handler; freeform's existing regex unchanged.

**Why drop the inline text block:** With buttons carrying the same information (`👍 TRUE` button = "👍 TRUE" text), block #4's inline answer-options text is pure redundancy. Removing it tightens the card and reduces the prompt's instruction burden.

**Alternatives considered:**
- Keep block #4 as a "voting affordance reminder." Rejected — Slack already renders buttons prominently; the text is duplicative.
- Use a single `actions` block element per choice with rich-text formatting. Rejected — button elements don't support mrkdwn; the numbered emoji must be in the plain-text button text.

### D7. Concurrent click race handling

**Decision:** Click handlers persist to `answers.json` through the existing data layer (which already serializes writes per-game). The subsequent `chat.update` is fire-and-forget; concurrent clicks each fire their own `chat.update` and Slack serializes them. If the second update overwrites the first user's view momentarily, the next click (or any user action) triggers a fresh rebuild from disk, which is always consistent.

**Why this is fine:** The data is never wrong on disk. The visual flicker (if any) is sub-second and self-healing. No locking, no debounce, no transaction needed.

**Note in design only, no code:** This is an explicit acceptance of best-effort live updates rather than guaranteed serialized renders.

### D8. Code organization: keep `freeform/` directory name; generalize internals

**Decision:** The directory `src/plugins/trivia/freeform/` keeps its name, but its files are generalized:

- `handlers.ts` → handles BOTH the new `vote:<questionId>:<value>` action (boolean/choice) AND the existing `freeform-answer:<questionId>` action (freeform modal trigger). Exported registration function broadens to `registerInteractiveHandlers`.
- `roster.ts` → unchanged interface, but rendering logic gains the grouping + cap + visibility-mode logic. Renamed function `buildRosterBlock` to keep call sites stable.
- `modal.ts` + `judge.ts` → unchanged; freeform-only.

The new action-block builder (`buildAnswerActions(question)`) is added either in a new file (`freeform/buttons.ts` or `tools/questions/interactiveBlocks.ts`) — the design defers the exact file location to the apply step.

**Why not rename the directory:** A rename touches imports across the plugin and the test suite for no functional gain. The freeform-only files (`modal.ts`, `judge.ts`) genuinely are freeform-only; calling the directory `interactive/` would be slightly less accurate.

**Alternatives considered:**
- Rename `freeform/` → `interactive/`. Rejected — touch surface is too wide for the gain.
- Split into `freeform/` (modal + judge) and `voting/` (handlers + roster + buttons). Rejected — handlers genuinely span both flows; splitting forces an artificial seam.

### D9. `revealResponses` cascade gates reveal-time participation disclosure

**Decision:** Add a second cascading config knob `revealResponses: 'no' | 'just-correctness' | 'yes'` (default `'yes'`) controlling how much per-question participation detail surfaces in the reveal message. Cascade order matches `liveAnswersVisible`:

```
slot.revealResponses
  → season.revealResponses
    → game.revealResponses
      → config.trivia.revealResponses
        → default: 'yes'
```

Resolved at `post_questions` time and stamped on the question record (`TriviaQuestion.revealResponses`). Subsequent reads happen inside `process_reveal_answers` when it builds the per-reveal payload entry.

**The tool gates at the payload boundary**, not the renderer. The reveal payload's `voters` field becomes a **discriminated union** on the stamped value:

```typescript
voters =
  | { revealResponses: 'yes';
      correct: Voter[];           // freeform Voters carry answerText
      incorrect: Voter[];         // freeform Voters carry answerText
      noAnswer: Voter[];
      reactions: Reactor[] }
  | { revealResponses: 'just-correctness';
      correct: Voter[];           // freeform Voters have NO answerText
      incorrect: Voter[];         // freeform Voters have NO answerText
      noAnswer: Voter[];
      reactions: Reactor[] }
  | { revealResponses: 'no';
      reactions: Reactor[] }
```

The renderer dispatches on `voters.revealResponses` to decide what to render. Names are physically absent from the `'no'` payload variant, so the renderer cannot accidentally leak them.

**For boolean and choice**, `'yes'` and `'just-correctness'` produce structurally identical payloads (boolean/choice Voters never carried answerText), so the rendered output is the same in both modes. The privacy axis is meaningful as a knob for freeform-text suppression; for boolean/choice it's a degenerate equivalence. This is intentional — admins get a single config knob with semantics that scale by format, and per-format defaults would create more complexity than they prevent.

**For freeform**, `'just-correctness'` strips `answerText` from every Voter in `correct[]` and `incorrect[]` — the reveal can say "Marc got it right" without quoting Marc's typed text. The freeform judge still runs end-to-end as today (it has to score every submission); only the typed text is filtered before the payload is emitted.

**Leaderboard and reactions always render regardless of mode.** The leaderboard aggregates per-game stats across many questions (not a per-question disclosure); the reactions list carries emoji on the question message and doesn't directly say who voted what.

**`roundSummary` gating in multi-question reveals**: `roundSummary.perPlayer` is omitted from the payload entirely when any reveal entry in the batch has `revealResponses !== 'yes'`. This is the safe-default rule — if any slot in the batch wants restricted disclosure, the aggregate per-player counts could leak across slots in confusing ways, so we just drop the field. Multi-slot batches in practice use uniform settings (one cron fire, one season's format); the mixed case is unusual and the safe omission is a minor loss.

**Why payload-boundary gating, not prompt-only branching:**

| Approach | Tradeoff |
|---|---|
| Payload always emits full data; prompt branches on mode | Renderer logic is more complex; one prompt bug leaks names |
| Tool gates at the payload (chosen) | Tool has a discriminated-union return; renderer can't leak what isn't there |

The payload-boundary approach is more defensive — leaking participation info is the failure mode admins activated the knob to prevent, and "the prompt forgot to filter" is the most likely way it would leak.

**Alternatives considered:**

- Two separate knobs for "show names" and "show freeform answer text" — rejected as over-engineering for a feature whose use cases (anonymous vote-only rounds, semi-anonymous "we know who participated but not what they said") are well-served by a three-level enum.
- Make `'just-correctness'` mean "aggregate counts only (no names)" — rejected per the user's explicit refinement: `'just-correctness'` enumerates players, just not their specific answers.
- Gate the leaderboard or reactions on `revealResponses` — rejected as out of scope; the leaderboard is per-game aggregate (not per-question) and reactions are commentary, not vote data.

## Risks / Trade-offs

- **[Risk] In-flight questions across deploy** → No back-compat code. Deploy during a quiet window after all pending questions reveal. The operational rule is documented in the proposal's Impact section. If a deploy lands while a question is mid-round, that question's reveal will see an empty `answers.json` and the reveal will show "nobody answered" — recoverable by re-posting the question via the normal `post_questions` path.

- **[Risk] Long freeform answers in the live footer with `liveAnswersVisible: true` could leak partial spoilers** → Truncation at ~40 chars per answer is the only mitigation. Admins who want full suspense flip `liveAnswersVisible: false` at any cascade tier. The default-true matches the user's stated preference; the cascade gives a clean escape valve.

- **[Risk] Button label truncation on long choice text** → Slack truncates at 75 chars visually. The card body always shows the full statement, and the prompt will be updated to remind Claude to keep choice text concise. Long choice text is unusual today (the data shows median <40 chars), so the practical impact is low.

- **[Risk] Cheater detection during a round must trigger a roster refresh** → `save_cheating` doesn't currently call `editRosterIntoCard`. Without an explicit refresh hook, a flagged cheater stays visible in the live footer until someone else clicks (which triggers a rebuild). Acceptable for now — the cheater flag is rare and the next click cleans it up. If observed-in-practice latency is a problem, `save_cheating` can call `editRosterIntoCard` directly in a follow-up.

- **[Risk] The reveal renderer's prompt depends on the voter shape** → The reveal prompt in `scheduledPrompts.ts` documents the payload contract and the rendering format. The shape change requires careful prompt-rewrite + spot-checking with a few real reveals before considering the change shipped.

- **[Trade-off] Reactions lose all semantic meaning at scoring time** → A reaction-as-vote habit is well-established for trivia users. Communicating that reactions are now purely for fun (and clicks are how to vote) needs to happen via the question card's affordance design — the buttons need to be visually obvious, and the closer line in block #4 should nudge toward clicking. Worth landing a one-time announcement post in trivia channels at deploy.

- **[Trade-off] Loss of the multi-react silent-void rule** → Today, a user who reacts with both `:one:` and `:two:` is silently voided from scoring. With buttons, there's no equivalent "I chose multiple options" gesture — the latest click wins. This is a feature for users (clearer semantics) but a small loss of nuance for admins (no signal that someone was indecisive). Acceptable.
