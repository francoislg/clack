## Context

The trivia plugin already supports six weighted cascading axes (`answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`) and several single-value cascade fields (`format`, `categories`, `theme`, `instructions`, `additionalInstructions`, `liveAnswersVisible`, `revealResponses`). All cascade `slot → season → game → workspace → built-in default`. Adding a new axis follows a well-trodden path: type field, parser validator, resolver helper, `get_ideas` payload, `save_question` validation, persisted record field.

What's new for hints, beyond the standard plumbing:

- A `minDifficulty` filter modifies the resolved axis value at generation time — neither pure cascade nor pure enum.
- A UI surface beyond the question text: `button` mode adds a Block Kit button + ephemeral-message handler; `inline` mode adds a context block.
- The two modes have **different game-design semantics**, not just different rendering — `button` is opt-in per player, `inline` is a room-wide difficulty floor adjustment. This is worth being explicit about in documentation so admins don't flip between modes thinking it's purely cosmetic.
- Hint state on the persisted question record carries both authored content (`text`, `mode`) and runtime state (`clickedBy`, button mode only).

## Goals / Non-Goals

**Goals:**

- Per-tier hint mode cascading via the standard `slot → season → game → workspace` ordering.
- Optional `minDifficulty` threshold per tier — when the rolled question difficulty falls below the threshold, suppress hint generation entirely (resolved mode becomes effectively `"none"` for that question).
- Hint text generated eagerly by Claude during the question-generation flow, in the same Claude session that wrote the question. Self-review pass in the same session catches hints that state or paraphrase the answer.
- One hint per question — same text for everyone who clicks (button mode) or sees the inline block (inline mode).
- `button` mode delivers the hint via `chat.postEphemeral` in the question's thread — Slack-scoped to the clicker, no modal.
- `inline` mode prepends a context block to the question message — visible to everyone immediately.
- Click tracking (button mode only): `clickedBy: string[]` on the question record, deduped on insert. Stored for analytics; NOT surfaced at reveal time or in scoring.
- Zero behavior change when no tier sets `hint` (cascade falls through to `{ mode: "none" }`).
- `list_games` surfaces the per-game and workspace `hint` setting when set, for admin auditability.

**Non-Goals:**

- No "reveal-time hint" — hints are only attached to the question post, not the reveal post.
- No multi-hint chain (one hint per question).
- No scoring impact — hint usage doesn't penalize the player.
- No public "who clicked the hint" surfacing — `clickedBy` is internal analytics, not displayed at reveal time, not in the round summary, not in the leaderboard.
- No suppression marker on records where `minDifficulty` filtered out the hint. A record either has a `hint` field or doesn't — that's the whole audit signal. No `hintCascade` / `wouldHaveHadHint` shim.
- No hint visibility tracking for inline mode. Inline hints are part of the message — there's no click event to track. `clickedBy` is absent on inline records.
- No lazy hint generation. Both modes pre-generate; button-mode hints that never get clicked are accepted token waste in exchange for consistency.
- No separate Claude judge session for hint quality. Self-review in the question-generation prompt only.
- No new MCP tool surface. Hints are emergent from existing tools (`get_ideas`, `save_question`, `post_questions`) + a new Slack action handler.

## Decisions

### 1. Config shape: structured object `{ mode, minDifficulty? }`

The cascade carries a single object per tier, replaced whole-tier (matches `difficultyRatio` semantics).

```ts
type HintMode = "none" | "button" | "inline";
type DifficultyBucket = "easy" | "medium" | "hard";

interface TriviaHintConfig {
  mode: HintMode;
  minDifficulty?: DifficultyBucket; // omit ⇒ no threshold
}
```

**Why structured over flattened (`hintMode` + `hintMinDifficulty`):** the two fields are semantically coupled — `minDifficulty` has no meaning when `mode === "none"`. Keeping them in one object enforces coupling at the type level and keeps the resolver to a single tier lookup.

**Why not a weighted distribution:** user described three discrete options with `none` as default — not a roll. A weighted distribution would let admins say "30% button, 70% none" but adds complexity without an obvious use case. If wanted later, the existing object extends cleanly.

### 2. Cascade ordering: standard convention

`resolveHintConfig(slotIndex, season, game, workspace)` returns the first non-undefined tier in:

1. `season.format.questions[slotIndex].hint` (when slotIndex is set)
2. `season.hint`
3. `game.hint`
4. `workspace.hint`
5. `{ mode: "none" }` (built-in default)

Whole-object replace per tier — no field-level merging. Matches `difficultyRatio` precedent.

### 3. `minDifficulty` applied at `get_ideas` time

After the difficulty roll, `get_ideas` resolves the hint config and computes the effective mode:

```ts
const cfg = resolveHintConfig(...);
const effectiveHintMode = (() => {
  if (cfg.mode === "none") return "none";
  if (!cfg.minDifficulty) return cfg.mode;
  return difficultyMeetsThreshold(rolledDifficulty, cfg.minDifficulty)
    ? cfg.mode
    : "none";
})();
```

The result is surfaced as `suggestedHintMode` in the `get_ideas` payload alongside the existing `suggestedDifficulty`, `suggestedAnswersFormat`, etc. Claude reads it and decides whether to write a hint.

**Why apply in `get_ideas` and not `save_question`:** Claude needs to know upfront whether to spend tokens drafting a hint. Suppressing at save-time would either waste tokens (draft then discard) or require a re-check that complicates the prompt.

### 4. Self-review pass for hint quality (in-session, not a separate judge)

The question-generation prompt gains a hint step that runs AFTER the answer + explanation but BEFORE `save_question`:

```
If suggestedHintMode !== "none":
  1. Draft a hint (≤140 chars) that nudges toward the answer without stating it.
  2. Self-review: does the draft state or paraphrase the answer?
       - "It's a primary color you get from mixing yellow and red." → BAD (states answer)
       - "Think of a color between yellow and red on the color wheel." → BAD (paraphrases answer)
       - "It's a warm color often associated with passion." → GOOD (semantic neighborhood nudge)
     If BAD, rewrite as a softer nudge.
  3. Pass the final hint to save_question as hint: { mode, text }.
```

**Why in-session, not a separate judge call:** one Claude session is already reasoning about the question's content. A self-review step is cheap (a handful of extra tokens), keeps architecture flat, and the same model that wrote the answer is best-positioned to spot when the hint accidentally reveals it. A separate judge would be more rigorous but adds another full prompt roundtrip per question — disproportionate cost for v1.

### 5. Stored record shape: `hint?: { mode, text, clickedBy? }` on `TriviaQuestion`

```ts
interface TriviaQuestion {
  // ...existing fields
  hint?: {
    mode: "button" | "inline";  // "none" is unrepresentable (= absent field)
    text: string;
    clickedBy?: string[];        // button mode only; absent until first click; deduped
  };
}
```

Notes:

- `mode === "none"` on the record is unrepresentable — equivalent to `hint` being absent. The poster reads `question.hint?.mode` to decide rendering.
- `clickedBy` is absent on inline records (no click events to record) and absent on button records until the first click. Stored alphabetically? No — append order is fine for an opaque-to-users field. The dedup check is what matters for correctness.

**Why store `mode` on the record and not re-resolve at post time:** the mode is the result of a difficulty-gated roll that happened at `get_ideas` time. Storing it freezes the decision so admin edits to config mid-day don't mutate already-posted questions. Matches the existing `postedBlocks` / `liveAnswersVisible` / `revealResponses` snapshot pattern.

### 6. Posting layout

**Button mode** — append the hint button to the same actions block that holds the answer buttons:

```
[ ...Claude-authored question blocks ]
[ actions: 1️⃣ Red | 2️⃣ Blue | 3️⃣ Green | 4️⃣ Yellow | 💡 Get Hint! ]
```

- Action ID: `plugin:trivia:hint:<questionId>`
- No `style` field (renders as Slack's default secondary button — visually distinct from primary answer buttons)
- Button label via `sdk.t("trivia.question.hintButton")` — EN "💡 Get Hint!" / FR "💡 Indice !"

**Inline mode** — prepend a context block immediately BEFORE the actions block:

```
[ ...Claude-authored question blocks ]
[ context: 💡 _Hint:_ <hint.text> ]
[ actions: answer buttons (no hint button) ]
```

- Label prefix via `sdk.t("trivia.question.hintInlineLabel")` — EN "Hint:" / FR "Indice :"

The full block array (with hint elements) is snapshotted on `postedBlocks` so subsequent roster-footer rebuilds via `chat.update` preserve them.

### 7. Click handler: ephemeral message, not modal

The Slack action handler for `plugin:trivia:hint:*`:

```ts
sdk.registerAction(/^plugin:trivia:hint:[^:]+$/, async ({ client, body, ack }) => {
  await ack();
  const questionId = parseQuestionIdFromActionId(body.actions[0].action_id);
  const record = await loadQuestion(gameFromChannel(body.channel.id), questionId);

  const text = record?.hint
    ? `${t("trivia.question.hintEphemeralLabel")} ${record.hint.text}`
    : t("trivia.question.hintMissing");

  await client.chat.postEphemeral({
    channel: body.channel.id,
    thread_ts: body.message.ts,           // scope to the question's thread
    user: body.user.id,
    text,
  });

  if (record?.hint?.mode === "button") {
    await updateQuestion(game, questionId, (q) => {
      const existing = new Set(q.hint?.clickedBy ?? []);
      existing.add(body.user.id);
      q.hint!.clickedBy = [...existing];
    });
  }
});
```

Key decisions:

- **Ephemeral in the question's thread, not the channel** — `thread_ts: body.message.ts` keeps it scoped so it doesn't appear as a channel-level message. Only the clicker sees it.
- **Repeat clicks fire fresh ephemerals; `clickedBy` dedupes** — Slack ephemeral messages aren't editable/dedupable by API; trying to suppress repeats would mean showing nothing on a click which looks broken. Let the natural behavior happen: user clicks 3x → 3 ephemerals, `clickedBy` records the user exactly once.
- **Graceful fallback for missing `hint`** — stale message from before the feature shipped, or admin-edited record. Post the localized "no hint available" ephemeral. No throw.
- **Acks first** — Slack 3-second window applies; ephemeral post and `updateQuestion` happen after `ack()`.

### 8. `list_games` surfacing

Per the established additive pattern (`format`, `categories`, `theme`, `difficultyRatio`):

- `workspaceDefaults.hint` present iff `config.trivia.hint` is set
- Per-game `hint` present in each entry iff the entry has it set
- Absent fields stay absent (don't emit `hint: null` or `hint: { mode: "none" }`)

### 9. Instruction file updates

The trivia management instruction file (`data/default_configuration/admin/topics/trivia:management/manage.md` or its virtual-defaults source) gains a `hint` cascade section: shape, tiers, `minDifficulty` semantics, **and an explicit callout that `button` vs `inline` are different game-design choices** (per-player safety net vs room-wide difficulty drop), not just UI variants.

CLAUDE.md's trivia section gains a one-line mention of the hint axis.

## Risks / Trade-offs

- **Hint text spoiling the answer despite self-review.** Self-review is best-effort — Claude might still ship a hint that's too revealing. **Mitigation:** examples in the prompt + the reveal flow surfaces the question text and the answer, so admins eyeballing reveals can spot bad hints and update the prompt examples over time. If this becomes a recurring quality issue, a separate `save_question`-time judge pass is an easy v2 add.
- **Inline mode silently changes difficulty calibration.** Admins might flip a workspace from `button` to `inline` thinking it's purely cosmetic, then wonder why all the hard questions are getting answered. **Mitigation:** explicit callout in the management instruction file; `list_games` exposes the resolved value so admins can audit.
- **Repeat-click ephemeral spam.** A user clicking the button 5+ times gets 5 identical ephemerals in their view of the thread. **Mitigation:** none in v1; accepted as Slack's natural behavior. If users complain, a simple `If user in clickedBy: skip ephemeral, post nothing` change would land — but that risks "broken button" perception. Defer.
- **Modal-vs-ephemeral debate may resurface.** If users miss ephemerals in busy threads, modal becomes attractive again. **Mitigation:** v1 ships ephemeral; can revisit if usage data shows abandonment.
- **`clickedBy` privacy.** We're recording per-user click events. Anyone with `read_config_file` access can inspect the data. **Mitigation:** none needed today (the existing question record already exposes question/answer/explanation; click tracking is comparable in sensitivity).
- **Parser drop-on-invalid hides typos.** A typo in `hint.mode` silently drops the field rather than failing loud. **Mitigation:** parser logs a warning naming the tier and the offending value — matches the convention for every other axis.
- **Token cost for unused button-mode hints.** Every button-mode question pays the hint-generation tokens whether anyone clicks or not. **Mitigation:** none in v1; accepted for consistency. Lazy generation is a future option (would require a runtime Claude-invocation surface that doesn't exist today).

## Migration Plan

No data migration required — `hint` is additive optional. Deployment is a single rolling update:

1. Ship types, parser, resolver, `get_ideas` / `save_question` extensions, and the `TriviaQuestion.hint` field. Old config parses identically; old `questions.json` records load identically.
2. Ship the `post_questions` rendering changes. Records without `hint` render exactly as before.
3. Ship the `plugin:trivia:hint:*` action handler. Old questions never produce these action IDs so the handler is dormant until a new hint-enabled question is posted.
4. Ship i18n strings, instruction-file updates, CLAUDE.md note.
5. Admins opt in by setting `hint` in `data/plugins/trivia/config.json` at any tier.

Rollback: revert the deploy. Existing `questions.json` records with `hint` fields are tolerated by the old code (it ignores unknown fields). Pending hint buttons in already-posted messages will become inert (clicks do nothing) — acceptable degradation.

## Open Questions

- **Should the ephemeral message include the question text for context?** Some users may click the hint button from a long thread or after scrolling away and want a reminder of what the question even was. Cheap to include — would add `"<question.text>\n💡 Hint: <hint.text>"` to the ephemeral. **Default:** yes, include the question text. Marginal cost, better UX.
- **Should `clickedBy` capture timestamps?** Useful for "did they click before or after submitting their answer?" analytics. Cheap to add (`Array<{ user: string; ts: number }>` instead of `string[]`). **Default:** no — user said "just one clickedBy"; keep the shape minimal. Easy to add later if analytics demand it.
