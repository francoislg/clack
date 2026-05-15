## Context

The trivia plugin's question shape is binary today: `TriviaQuestion.isTrue: boolean`, the post body says `"👍 TRUE • 👎 FALSE"`, the bot auto-reacts with `["+1", "-1"]`, and the reveal flow categorizes voters from the `:+1:` / `:-1:` reaction lists. `submit_answers` records `answer: boolean` and computes `correct = answer === question.isTrue`. The Game Show Presenter persona, the difficulty gate (1-10 with a 4+ floor), the polarity gate ("write with the correct polarity from the start, do not flip a true statement"), the server-rolled `suggestedAnswer` (anti-bias), the cumulative leaderboard, the cheating detection, and the cron-driven schedules all assume this binary shape.

A parallel set of in-flight changes — `add-trivia-seasons` (archived) and `refactor-seasons-as-timeline` (in flight, basically complete; the code already implements its model) — introduces a season-scoped record-tagging model (`season: string` on every question/answer/cheat) and a timeline of `SeasonEntry` records in `seasons.json#seasons[]`. Each entry carries `slug`, `startedAt`, `expectedEndAt`, optional `endedAt`, and a per-entry `categories: string[]` pool. "Current" is derived: `findCurrentSeason(state, now)` returns the unique entry whose active window contains `now`, or `null` in a gap. Admins manage the timeline via the `upsert_season` MCP tool (create-or-update by slug) and `delete_season` (only on not-yet-started entries). The seasons feature establishes the precedent that **per-season configuration lives on the entry** (categories already do this) — that's the pattern this change reuses for `questionTypes`.

This change adds **multiple-choice questions** as a second, coexisting question shape. Choice questions have N options (2–4) and exactly one correct index. They are voted on with numbered reactions (`:one:` through `:four:`). The workspace and (when seasons are enabled) the active season decide what mix of `boolean` / `choice` questions to generate, via a weighted-random config. The two shapes coexist permanently — this is not a generalization of boolean to N-ary; it is a discriminated union, deliberately keeping the binary path unchanged to avoid migrating live data and to keep the existing prompt copy intact for the (still-common) boolean case.

Two earlier shapes were considered and rejected in discussion:

1. **Generalize binary to N-ary** — drop `isTrue`, model every question as `{ choices: string[], correctIndex: number }`, treat boolean as `choices: ["True", "False"]`. Rejected because (a) it forces a backfill migration on `questions.json` and `answers.json`, (b) it loses the semantic `isTrue` tag (which the persona-style boolean reveal copy is tightly written around), and (c) it doubles the surface that the existing boolean tests pin down without any behavioral gain for the binary case.
2. **Per-question type override in `save_question`** — let Claude decide question-by-question, independent of any rolled `suggestedType`. Rejected because it reintroduces the bias risk that the server-rolled `suggestedAnswer` was specifically introduced to prevent: Claude consistently picks the type that fits the topic best, which produces a non-uniform mix and defeats the workspace operator's intent expressed in `questionsTypes`.

The retained design uses a **discriminated union, server-rolled type pick, server-rolled `correctIndex`, and a season-or-config read-through pattern**. Distractor quality is gated by a new "plausibility gate" parallel to the existing difficulty gate. Reveal-flow ordering is changed so the question is resolved (and its type known) before reaction parsing begins.

## Goals / Non-Goals

**Goals:**

- Add multiple-choice questions as a coexisting question shape without breaking the existing boolean path or requiring any backfill of `questions.json` / `answers.json`.
- Make the boolean-vs-choice mix configurable workspace-wide and overridable per season (when `add-trivia-seasons` is active).
- Preserve the deterministic-by-construction anti-bias property of `get_ideas`: just as `suggestedAnswer` removes Claude's ability to bias polarity, `suggestedCorrectIndex` and `suggestedChoiceCount` remove its ability to bias the correct position or the question's branching factor.
- Guarantee exactly one correct answer per choice question at the tool boundary (validation in `save_question`), so reveal logic can rely on a single `correctIndex` invariant.
- Add a distractor-quality gate that prevents the most common multi-choice failure mode (all distractors obviously wrong → question is trivial; or one distractor accidentally plausible-enough-to-be-correct → question is broken).
- Re-order the reveal flow so the question's `type` is known before reaction parsing — required for choice reveals, harmless for boolean ones.
- Preserve full backward compatibility: legacy rows without `type` read as boolean, deployments without `trivia.questionsTypes` configured behave exactly as today.

**Non-Goals:**

- A user-facing "vote with /trivia-vote" slash command or modal flow. Voting remains emoji-reaction-based.
- More than 4 choices. Slack numbered keycap emoji do extend to `:keycap_ten:`, but voter UX, card readability, and the persona copy degrade past 4. Locked at max 4.
- Multi-correct questions ("select all that apply"). Exactly one correct answer per choice question is a hard invariant — enforced at validation time and assumed by reveal logic.
- Differential scoring (choice corrects worth more than boolean corrects). Both worth one point. The leaderboard does not distinguish.
- Per-question type overrides by the admin/user via chat. Type is determined by `get_ideas`' server-rolled `suggestedType`; Claude follows it.
- Cross-type duplicate detection (the same fact asked once as boolean, once as choice). They are stored as separate questions, accepted as separate questions, surfaced separately in `find_previous_questions`.
- A landing version of this change without `add-trivia-seasons`. The proposal references `seasons.json` and `start_new_season` as the season-override path. If seasons does not land first, the season-override path is a no-op and the config-level keys are the only source.

## Decisions

### Decision 1: Discriminated union on `TriviaQuestion`, no migration

**Choice:** Add `type: "boolean" | "choice"` to `TriviaQuestion`. Boolean questions keep `isTrue` and gain nothing else. Choice questions get `choices: string[]` and `correctIndex: number` and do **not** have `isTrue`. Absence of `type` on a stored row reads as `"boolean"`.

**Rationale:** A discriminated union is the smallest possible shape change — the existing boolean path is unchanged on read and write, only new choice writes introduce new fields. No backfill is needed because legacy rows lacking `type` are unambiguously boolean (they have `isTrue`). The two question shapes are genuinely different at the prompt level (the persona writes a single statement for boolean vs four options for choice) and at the reveal level (two thumb reactions vs N numbered reactions), so keeping them syntactically distinct in the data layer is honest. The cost — one discriminator field and slight branching in `submitAnswers` / `findPreviousQuestions` — is small and contained.

**Alternatives considered:**

- *Generalize binary to N-ary (boolean = `choices: ["True", "False"]`).* Forces a backfill of every existing question and answer row. Loses the `isTrue` semantic that the boolean reveal copy is built around ("THE ANSWER IS TRUE!"). Rejected.
- *Two physically separate files (`questions.json`, `choice_questions.json`).* Doubles the I/O fan-out in `find_previous_questions` and `retrieve_scores`. No benefit over a discriminated union. Rejected.

### Decision 2: Server-roll `suggestedType`, `suggestedChoiceCount`, `suggestedCorrectIndex`

**Choice:** `get_ideas` rolls all three values server-side from the active weights/bounds (season-overrides-config) and returns them in the response. Claude must use them; it does not get to decide the type, the choice count, or the correct position.

**Rationale:** Direct parallel to the existing `suggestedAnswer` mechanism. The premise is that the LLM consistently biases when given the choice — it picks the question type that fits the topic best (which produces a non-uniform mix the operator didn't ask for), it picks 4 choices when 4 fits and 3 when 3 fits (which produces a hidden cadence), and it places the most plausible-sounding choice first (which makes the leaderboard correlate with "people who always pick #1"). Server-rolling removes all three biases by construction. The cost — Claude occasionally has to write a 3-choice question when 4 would fit better — is the price of a uniform mix, and the operator can tune the bounds.

**Alternatives considered:**

- *Let Claude pick everything from the rolled `suggestedType` only.* Half-protects against type bias, still allows correct-position and choice-count bias. Rejected.
- *Let Claude pick choice count, server-roll only `correctIndex`.* Still allows hidden cadence bias. Rejected as half-measure.
- *Hard-code 4 choices.* Removes flexibility the operator explicitly asked for. Rejected.

### Decision 3: Distractor plausibility gate — rate, gate, rewrite-distractors-only

**Choice:** Before `save_question` on the choice path, Claude rates each option (correct + each distractor) 1-10 on "how plausible does this sound as the correct answer to someone who doesn't know the topic." The gate has four conditions:

- (a) Correct answer's plausibility ≥ 5 (it must be defensible — a correct answer that scores 3/10 plausibility is one no one would even consider).
- (b) Highest distractor's plausibility ≥ 4 (at least one real trap — otherwise the question is trivial and a bad multi-choice).
- (c) Correct − highest-distractor ≤ 4 (the gap is small enough that distractors compete — otherwise the correct answer is a giveaway).
- (d) Minimum distractor plausibility ≥ 2 (no joke filler — otherwise the question is effectively a 3-choice or 2-choice masquerading as 4).

If any gate fails, Claude rewrites only the *failing distractor(s)*, never the correct answer. The correct answer is index-locked by `suggestedCorrectIndex`; rewriting it requires reshuffling the index assignment and reintroduces the very position bias that server-rolling was supposed to remove. The prompt makes this constraint explicit and shows the bail-out failure mode ("if you can't make a strong enough distractor, rewrite the *distractor*, not the answer").

**Rationale:** The most common multi-choice failure mode is one of two things: (i) the correct answer is so much more plausible than the distractors that anyone with mild domain knowledge picks it on sight, defeating the trivia format; or (ii) one distractor is so plausible that the question becomes ambiguous and the "correct" answer is arguable. The gate catches both directly. Rating-then-gating is preferred over softer prompt language ("make sure the distractors are plausible") because the existing difficulty gate proves that explicit numeric self-rating gates work where soft guidance fails. The "rewrite-distractors-only" rule is the load-bearing piece — without it, the gate is reachable by Claude swapping its preferred correct answer into the index it's allowed to use, which reintroduces the index bias.

**Alternatives considered:**

- *No gate, just trust the prompt.* The existing difficulty gate exists because soft guidance failed for difficulty; same logic applies here. Rejected.
- *Single threshold ("all options 4-8").* Too restrictive — a correct answer can legitimately be a 9 plausibility and still be a great trivia question, as long as a distractor is in the 5-6 range. Rejected.
- *Rate "actual correctness probability".* This is what `isTrue` validation already does at step 5 on the boolean path. The choice path needs the *plausibility-to-someone-who-doesn't-know* angle, which is different from factual correctness. Rejected as conflating two questions.

### Decision 4: Reveal flow re-orders — resolve question, then parse reactions

**Choice:** The reveal flow moves `find_previous_questions` + `get_question_history` to before the reaction-parsing step. The new order is: fetch channel messages → extract statement → research truth → **resolve questionId via find_previous_questions** → load `question.type` → branch reaction parsing on type.

**Rationale:** Choice reveals cannot proceed without `correctIndex` from the stored question — there is no way to determine "which numbered emoji is correct" from the channel message alone. Loading the question early is also harmless for boolean reveals (the boolean path doesn't need it as early, but moving the step earlier doesn't break anything). The change is structural: today's flow treats the database lookup as a low-stakes addendum used to find the questionId for `submit_answers`; with choice questions, it is the gate that determines the entire reveal shape. Centralizing the lookup before any reaction analysis prevents a class of bugs where a boolean-style parse runs against a choice question and silently produces nonsense (e.g., scoring everyone as incorrect because nobody used `:+1:`).

A consequence: when the lookup fails on a choice question, the reveal cannot continue — there is no "best-effort questionId" fallback that recovers `correctIndex`. The fallback for unresolvable choice questions is an **admin-facing error message** posted in the channel (not silently nothing, not a guess), prompting an admin to investigate. Boolean reveals retain the existing best-effort fallback because they can derive correctness from the statement-truth research alone.

**Alternatives considered:**

- *Late-resolve, type-branch only after counting.* Possible but couples the question-resolution and counting steps with unclear ownership. Rejected.
- *Embed correctIndex in the channel message metadata.* No clean place to do that without polluting the user-facing card. Rejected.

### Decision 5: Multi-react voters on choice questions are silently voided

**Choice:** A choice-question voter who reacts with 2 or more numbered emoji (`:one:` + `:three:`, etc.) is silently excluded from scoring — not counted as correct, not counted as incorrect, not surfaced in the reveal copy.

**Rationale:** "Exactly one correct answer" is the hard invariant of choice questions. A user who reacts with multiple numbered emoji has explicitly opted out of giving a single answer; treating that as "wrong" punishes indecision, treating that as "right" doubles the score floor, and treating that as a fence-sitter (the boolean equivalent) doesn't fit the choice persona ("you reacted with 3 of 4 options" is "narrowing down," not "fence-sitting"). Silent void aligns with how cheaters and the bot's own reactions are handled — removed from the lists before categorization, never mentioned in user-facing copy. This keeps the persona's roast/celebration energy targeted at people who actually submitted a single answer, and leaves a clean exit ramp for voters who change their mind (their final state is "multiple reactions" which doesn't count, same as removing all reactions).

Wildcards (non-numbered reactions like `:shrug:`, `:pizza:`) are **not** silently voided — they continue to be read aloud with the persona's interpretive humor, same as today's boolean reveal.

**Alternatives considered:**

- *Score multi-react as incorrect.* Punishes "narrowing down" behavior that operators want to encourage. Rejected.
- *Score multi-react as correct if the correct index is among the reactions.* Trivially exploitable — react with all 4 numbered emoji and always be "correct." Rejected.
- *Call them out playfully (boolean fence-sitter persona).* The boolean fence-sitter copy works because "both true and false" is a definite stance ("can't commit"). "1 and 3 but not 2 and 4" is not a stance, it's noise. Persona doesn't fit. Rejected.

### Decision 6: `questionTypes` is per-season (mirrors `categories`); `choices.{min,max}` is workspace-only

**Choice:** `questionsTypes` lives in two places: workspace-level at `config.trivia.questionsTypes`, and per-season at `SeasonEntry.questionTypes` (a new optional field on each entry in `seasons.json#seasons[]`). On every `get_ideas` call, the system reads in priority order: (1) the result of `findCurrentSeason(state, Date.now())`'s `questionTypes` field if seasons are enabled, a current season exists (no gap), and that field is set; (2) `config.trivia.questionsTypes` if not. `choices.{min, max}` lives only at the workspace level (`config.trivia.choices`) — it does NOT have a per-season override.

**Rationale:** `questionTypes` is a gameplay parameter (boolean vs choice changes the player's experience and the leaderboard's accuracy floor), so it's the kind of thing seasons exist to vary — mirror the existing `SeasonEntry.categories` pattern. The seasons feature already established that **gameplay-relevant per-season state lives on the entry** (categories, dates, slug) and that `upsert_season` is the single mutator for it; this change reuses the same mechanic for `questionTypes` rather than introducing a separate tool. `choices.{min, max}`, by contrast, is a card-readability UX setting (long choice text → stacked layout, short → inline) that doesn't change gameplay outcomes — adding a per-season override would be storage and validation noise for no behavioral payoff. The read happens on every `get_ideas` call (no caching) so that admin edits to a current entry's `questionTypes` (via `upsert_season(slug, { ... })`) take effect on the next question.

**Alternatives considered:**

- *Cache at startup.* Stale during transition, requires invalidation, no observable gain (the JSON read is sub-millisecond). Rejected.
- *Pre-roll a whole season's types at season creation.* Loses the ability to tweak mid-season. Adds storage for a derived quantity. Rejected.
- *Always read from config, ignore seasons.* Defeats the season-as-configuration-unit pattern the seasons feature established. Rejected.
- *Make `choices.{min, max}` season-overridable too.* No gameplay payoff; pure UX setting. The cost of plumbing a per-season override for a value that only changes how the post looks isn't worth it. Rejected.

### Decision 7: Boolean and choice answer records share one file, distinguished by which field is set

**Choice:** `answers.json` stores both boolean and choice answers. A boolean answer has `answer: boolean` set and `answerIndex` undefined. A choice answer has `answerIndex: number` set and `answer` undefined. The `correct: boolean` field is present on both. The discriminator is the *presence* of `answerIndex` (a question's stored `type` is the authoritative discriminator for the question; the answer's discriminator follows from which field is populated).

**Rationale:** Same logic as Decision 1 — discriminated union keeps existing rows unmigrated. The alternative (separate `choice_answers.json`) doubles the fan-out for `retrieve_scores`. The minor cost — two optional fields where one mandatory union type would be tighter — is the price of zero migration.

**Alternatives considered:**

- *`answer: boolean | number` union field.* TypeScript-cleaner but requires careful narrowing everywhere; harder to read for humans scanning the JSON. Rejected.
- *Promote `correct` to be the only field and drop both `answer` and `answerIndex`.* Loses the audit trail (which option did the user pick?). Bad for debugging cheats and disputes. Rejected.

### Decision 8: Block Kit layout — Claude picks stacked vs inline based on text length

**Choice:** The choice-question card has two valid Block Kit shapes — stacked (one choice per line, `1️⃣ Option`) and inline (`1️⃣ A • 2️⃣ B • 3️⃣ C • 4️⃣ D`). The prompt instructs Claude to pick stacked when any single choice exceeds roughly 25 characters, inline otherwise. The threshold is soft (Claude judges by readability) rather than hard (no character-count enforcement).

**Rationale:** Short choices ("Mercury", "Venus", "Earth", "Mars") read better inline — one row, scannable, doesn't waste vertical space. Long choices ("the European Union's first elected president", etc.) cannot fit inline without truncation, so stacked is the only option. A hard threshold would over-trigger the wrong layout for borderline cases ("Earth and Moon" — 14 chars vs "the Falkland Islands" — 20 chars); soft guidance lets Claude make the call. Both layouts share the same reaction set and the same downstream parsing — the choice is purely visual.

**Alternatives considered:**

- *Always stacked.* Wastes vertical space for short-choice questions and is less game-show-feeling. Rejected.
- *Always inline.* Breaks for long choices. Rejected.
- *Compute layout server-side and pass to Claude.* Adds complexity for no benefit; this is exactly the kind of judgment Claude is good at. Rejected.

### Decision 9: Bot auto-reactions sized to choice count

**Choice:** The bot auto-reacts on its own choice-question post with the numbered emoji corresponding to the number of choices: 2 → `["one", "two"]`, 3 → `["one", "two", "three"]`, 4 → `["one", "two", "three", "four"]`. Boolean posts remain `["+1", "-1"]`.

**Rationale:** Same UX value as today's `["+1", "-1"]` — users see the reaction slots pre-seeded and click. The bot's own reactions are excluded from scoring in step 7 of the reveal flow (already a parameterized step — it removes "the bot's user ID from every reaction list," agnostic to which emojis those are), so no scoring change is needed. Order matters in the `reactions` array because Slack renders reactions in the order they were added — `:one:` first ensures the visual order matches the textual order in the card.

**Alternatives considered:**

- *No auto-reactions for choice questions; let users add their own.* Forces users to find the right emoji; degrades the snap-to-vote UX. Rejected.
- *Auto-react with all 10 numbered emoji and let users pick the right one.* Visually noisy, and any unused reactions still occupy reveal-flow attention. Rejected.

## Risks / Trade-offs

- **Risk:** Distractor plausibility gate becomes a bottleneck — Claude rewrites distractors repeatedly because they keep failing one of the four conditions. → **Mitigation:** Set a hard retry limit (3 distractor-rewrite passes per question) in the prompt. If the gate still fails after 3 passes, abandon the question entirely and re-roll from `get_ideas`. Faster than fighting a marginal topic. Add a regression scenario covering retry-budget exhaustion.

- **Risk:** Server-rolled `suggestedCorrectIndex` is fair in distribution but Claude's distractor quality varies systematically by index (e.g., distractors at index 0 are weaker because Claude writes them first). → **Mitigation:** Property test that generates 100+ questions and asserts (a) `correctIndex` distribution is uniform within tolerance, (b) the plausibility-gate-failure rate is independent of `correctIndex`. If (b) fails, the prompt needs to instruct Claude to write distractors in shuffled order, not positional order.

- **Risk:** Mid-season changes to `seasons.json.current.questionTypes` (admin manually edits JSON, or `start_new_season` is called mid-season as an override) cause the next question to surprise channel regulars. → **Mitigation:** Acceptable behavior — the operator who made the change knows it. Document in the admin-facing instruction that mid-season changes take effect immediately. No technical mitigation needed.

- **Risk:** Reveal flow's new "resolve question first, error if not resolvable for choice" branch produces noisy admin errors when the channel has external-source trivia (someone manually pasted a question in the channel that the bot's database doesn't know about). → **Mitigation:** The reveal flow already runs only on the scheduled reveal cron — the question it tries to reveal is one the bot itself generated on the question-posting cron, so resolution should be near-100%. The hard-failure path is for the rare case where the bot generated a question and then `questions.json` lost the row (data corruption, bad merge). Logging the admin error is the right behavior in that case. Add a regression scenario covering missing-question-on-choice-reveal.

- **Risk:** Distractor plausibility ratings drift over time as Claude's defaults shift between model versions. → **Mitigation:** Pin the thresholds (5/4/4/2) as numeric constants in the prompt. If a model version drifts, the gate-failure rate changes observably (mitigation 2 above already tracks this) and the thresholds can be retuned. This is the same kind of brittleness the existing difficulty gate has and has not been a problem there.

- **Risk:** Voters mix `:+1:` / `:-1:` (boolean reactions) on a choice question, or numbered emoji on a boolean question. → **Mitigation:** Treat them as wildcards (the reveal flow's existing "any other emoji" category), which gets read aloud by the persona. Not silently voided — the persona's humor covers it. The reaction set Claude was instructed to auto-add (numbered for choice, thumbs for boolean) is the authoritative set; anything else is a wildcard.

- **Risk:** A choice question's `choices` array contains duplicate strings (e.g., two options labeled "Paris"). Validation in `save_question` should reject this — otherwise reveal cannot distinguish which `correctIndex` the voter meant. → **Mitigation:** `save_question` validates `new Set(choices).size === choices.length`; returns an error if not. Claude rewrites. Add a regression scenario.

- **Trade-off:** Two prompt variants in `SEND_QUESTIONS_INSTRUCTIONS` (the boolean path and the choice path) live in the same constant. Some duplication is unavoidable (the difficulty gate is the same, the duplicate-check step is the same). Acceptable cost; the alternative — a single generalized prompt that branches at every step — is harder to read and harder to evolve when the boolean copy needs a tweak unrelated to choice.

- **Trade-off:** The reveal flow's pre-resolution step is mandatory for choice questions and just-extra-work for boolean questions. The slight efficiency cost (one extra lookup per reveal, on every reveal) is acceptable — `find_previous_questions` is a single JSON read of <100KB in the worst realistic case, sub-millisecond.

## Migration Plan

No data migration required. Deployment is a binary upgrade.

- **Step 0 (sequencing):** `refactor-seasons-as-timeline` MUST archive before this change. This change targets the post-timeline seasons baseline (`upsert_season`, `seasons.json#seasons[]`, `findCurrentSeason`); its `trivia-seasons` spec delta MODIFIES the post-timeline `upsert_season` and `seasons.json` schema requirements. If `refactor-seasons-as-timeline` does not archive first, the trivia-seasons delta in this change needs to be rebased onto whatever baseline exists at archive time (mechanical rename: `upsert_season` ↔ `start_new_season`, `seasons.json#seasons[]` ↔ `seasons.json#current`).
- **Step 1:** Land `refactor-seasons-as-timeline`. (The code already implements the timeline model; archiving the change makes the post-timeline baseline canonical.)
- **Step 2:** Land this change. On the first scheduled question-posting run, `get_ideas` reads `trivia.questionsTypes` (default `{ "boolean": 1 }` if absent — pure boolean, equivalent to today). Existing deployments see no behavioral change until an operator opts in by setting `questionsTypes` to include `"choice"`.
- **Step 3:** An operator opts in by editing `config.json` (workspace-wide) or by calling `upsert_season(slug, { questionTypes: { ... } })` on the current or a future season entry. The next question-posting run picks up the new mix on the next `get_ideas` call.
- **Rollback:** Set `trivia.questionsTypes = { "boolean": 1 }` (or remove the key) AND clear `questionTypes` on any current season entry via `upsert_season` to return to pure-boolean behavior on the next run. Any choice questions already generated remain in `questions.json` — they are not deleted on rollback. Their reveals still work as long as the binary running on rollback supports the choice path (i.e., if rollback is to a binary without this change, choice questions in `questions.json` become unreadable; admins should accept this and clear them via a manual JSON edit if needed). For safety, recommend rollback to a binary newer than this change but with `questionsTypes` cleared to `{ "boolean": 1 }` rather than rollback to a binary older than this change.

## Open Questions

None outstanding. All design questions raised in exploration have been resolved:

- Coexist vs generalize → coexist (Decision 1)
- Max 4 choices → confirmed
- Season-overrides-config priority → confirmed for `questionTypes` (per-entry); `choices.{min,max}` workspace-only (Decision 6)
- Exactly one correct → confirmed, validated at tool boundary
- Server-roll `correctIndex` → confirmed (Decision 2)
- Sequencing after seasons → confirmed in Migration Plan
- Block Kit stacked vs inline → both supported, Claude picks (Decision 8)
- Distractor difficulty gate → defined (Decision 3)
- Multi-react void → confirmed (Decision 5)
- Bot auto-reactions sized to count → confirmed (Decision 9)
- Equal scoring → confirmed in Non-Goals
- Weighted-random with re-normalization → confirmed (`{ boolean: 2, choice: 1 }` → 2/3 vs 1/3)
- Reveal flow order change → confirmed (Decision 4)
