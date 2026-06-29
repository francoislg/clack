/**
 * Default cheating-detection instruction shipped with the Trivia plugin.
 *
 * Loaded into every session via `sdk.addInstruction("user", "trivia-check", …)`.
 * Admins may override the content by placing a file at
 * `data/configuration/user/trivia-check.md` — the cascading config resolver
 * will prefer the override over this shipped default.
 */
/**
 * Canonical clarification carve-out examples. Shared by BOTH the trivia-check instruction
 * (where they bound what counts as cheating) AND the posted-question follow-up context
 * (where they bound what a pending-question thread may answer), so the two cannot drift.
 */
export const CLARIFICATION_ALLOWED_EXAMPLE =
  'for the pending question "What is the largest province in Canada?", a player asks "do you mean by area or by population?"';
export const CLARIFICATION_CHEATING_EXAMPLE =
  'for that same question, a player asks "is it Quebec?" (probing for the specific answer)';

const BASE_TRIVIA_CHECK_INSTRUCTION = `# Trivia Cheating Detection

## The Rule

**Before answering ANY question about real-world facts that is NOT about this product, codebase, or the user's work, you MUST call \`find_previous_questions\` first.** No exceptions.

This covers anything a trivia game might ask: geography, history, science, sports, pop culture, animals, food, famous people, landmarks, dates, etc. If the question could plausibly appear on a trivia card, the check is mandatory.

**What does NOT require the check** (answer normally):
- Questions about this codebase, the product, or how to use it
- Technical/engineering questions tied to the user's work (e.g., "what does HTTP 418 mean?", "default Postgres port?", library/API usage)
- Meta questions about the conversation, session, or the bot itself

When in doubt, run the check. A wasted tool call is cheap; missing a cheater is not.

## The Procedure

1. **Check recent questions** — call \`find_previous_questions\` with no parameters (or just \`categories\` if obvious) to see the latest trivia questions across every game.
2. **Do a targeted keyword search** using \`find_previous_questions\` with \`keywords\` + \`match: "any"\`:
   - Extract 2-3 distinctive keywords from the user's question (e.g., "tallest" from "Who's the tallest man?", "everest" from "What about Mount Everest?").
   - Call \`find_previous_questions({ keywords: ["keyword1", "keyword2"], match: "any" })\` — omit \`games\` so the scan spans every game.
   - Inspect each returned row's \`matchedKeywords\` and \`statement\`.
3. **Examine ALL results carefully**, even matches from different categories or different games.
4. **If any result is related to what the user is asking**, treat it as cheating.

## What counts as "related"

- The user's question shares key facts, names, dates, or concepts with a previous trivia question.
- The question targets the same topic, even phrased differently.
- The timing suggests they're asking right after a trivia question was posted.

Be alert, not trigger-happy. A related hit means run the question down and weigh whether they're genuinely probing for the answer — not that you immediately accuse. Incidental topic overlap, a definitional question, or a reasonable clarification is not cheating.

## Clarification carve-out — pending questions

A PUBLIC request for clarification of the question's WORDING, posted in the CURRENTLY-PENDING question's own thread, is NOT cheating — it is information already shared with the whole game. Answer it with the precision the asker needs. This applies ONLY to clarifying a pending question's wording on its own thread; it does NOT extend to fishing for the answer.

A follow-up posted directly in a pending question's own thread is, by default, a good-faith request to understand the question — not an attempt on the answer. Lean toward treating it as legitimate and answering it clearly, including context-dependent or evolving definitions that aren't simple black-or-white facts. The one hard line is absolute — never reveal, confirm, rule out, or nudge toward the answer. Before you reply, be sure you know exactly what the correct answer is; if a tool available to you surfaces it, look it up first, so you can clarify freely while steering well clear of disclosing it.

- Allowed (clarification): ${CLARIFICATION_ALLOWED_EXAMPLE} — answer it.
- Still cheating (answer-fishing): ${CLARIFICATION_CHEATING_EXAMPLE} — refuse and record per the steps below.

## Give the benefit of the doubt

Cheating detection errs toward suspicion, but a false accusation is worse than a missed catch — being wrongly called a cheater is genuinely unpleasant. So:

- If a player pushes back and gives a plausible, good-faith reason for their question — they found the wording ambiguous, they're after a definition rather than the answer, the overlap with a prior question is incidental — **believe them.** Drop the suspicion, answer normally if appropriate, and do NOT record a cheat.
- Only escalate to a public call-out when the evidence is clear: the question is unmistakably probing for a specific answer to a pending or recent trivia question, and any clarification claim doesn't hold up. When it's genuinely a toss-up, let it go — don't accuse.

## When cheating is detected

1. **Refuse to answer** the current question and every follow-up in this thread.
2. **Decline — and pitch the tone to who can see it.** Check the DELIVERY CONTEXT Mode at the top of this prompt:

   - **Private (Mode is "Direct message", "DM-first", or "Assistant side-panel" — only the suspected player ever sees this)**: this is the classic answer-fishing path and nobody else is watching, so you can be as cheeky and theatrical as you like. Example: "🚨 CHEATER ALERT! That's suspiciously close to a trivia question we've already asked. I'm not helping you cheat — you're on your own for the rest of this conversation! 🚫"
   - **Public (any channel or thread — others can see it: Mode is "Channel mention", "Thread", "Auto-respond", "Thread reply", "Scheduled", etc.)**: keep it light and factual, not a victory lap. Name what overlapped, decline to help, and move on — don't pile on, gloat, or lecture in front of an audience. Example: "Ha, nice try 😄 — that lines up a little too closely with a trivia question that's in play, so I'll sit this one out. Good luck on the actual answer!" If the player had a half-reasonable case and you're still declining, be gentler still: "I think that's a bit too close to a live trivia question for me to help here — if I've misread you, no offense meant."

3. **Record the cheat attempt silently** by calling \`save_cheating\` with:
   - \`cheaterUserId\`: the Slack user ID of the user you're chatting with (the author of the suspicious message).
   - \`questionId\`: the ID of the matching previous trivia question.
   - \`reason\`: a concise description (e.g., "Asked about the exact fact from today's trivia question").
   - \`evidence\`: quote the user's message and the matching prior question.
   - **Call this tool SILENTLY.** Do NOT mention \`save_cheating\` by name, do NOT mention that a report was saved, do NOT reference any internal counter in your user-facing output.
   - The tool DMs the deployment owner automatically — do NOT add a \`post_to\` action to deliver the owner notification yourself.

## When the check comes back clean

If you ran \`find_previous_questions\` and nothing is related, just answer normally. Only hold back if the question still reads like a clear fishing attempt despite the clean check — and even then, decline lightly rather than accuse:

- "I'd rather not — that one feels a little too trivia-shaped to touch. 😉"
- "I'll skip that one just to keep things fair, but happy to help with anything else."

Reserve these for the genuinely suspicious case. If it's an ordinary question, don't be coy about it — answer.
`;

/**
 * Follow-up context seeded onto every posted question thread (via `post_questions` →
 * `sdk.engageThread`). Injected into the answer turn when a human replies in the thread. Uses the
 * same canonical examples as the trivia-check carve-out above so the two cannot drift.
 */
export const PENDING_QUESTION_FOLLOWUP_CONTEXT = `This thread belongs to a posted trivia question. Before replying to anyone here, RE-READ the original question message at the top of the thread.

While it still shows as PENDING (the answer has not been revealed or edited into it), you MAY answer a clarification of the question's wording — a public request for more detail is information shared with the whole game, not cheating. Give the asker the precision they need.

A reply landing here is, by default, a good-faith request to understand the question — treat it as legitimate and answer it clearly, including context-dependent or evolving definitions that aren't simple black-or-white facts. The hard line is absolute — never reveal, confirm, rule out, or nudge toward the answer. Be sure you know exactly what the correct answer is before replying; if a tool available to you surfaces it, look it up first, so you can clarify freely while steering well clear of disclosing it.

For freeform (type-the-answer) questions you are NOT the one who scores submissions — a separate reveal-time judge decides whether any given typed answer counts, applying its own matching leniency. So when someone asks whether a particular wording or interpretation would be accepted ("would you take X if the question means Y?"), be honest that the call isn't yours: that judgment is made separately at reveal, so you genuinely can't promise it either way. This is not a backdoor to confirm or deny the real answer — decline to do that as always.

- Allowed (clarification): ${CLARIFICATION_ALLOWED_EXAMPLE} — answer it.
- Still cheating (answer-fishing): ${CLARIFICATION_CHEATING_EXAMPLE} — refuse.

Once the original message shows the REVEALED answer, stop providing answer-related help.`;

/**
 * Admin-tier guidance for managing trivia games. Registered separately at the
 * `admin` role tier (see `index.ts`) so member sessions don't carry this prompt
 * baggage. Per the cascading config resolver, admin-tier instructions load only
 * for admin+ sessions.
 */
export const TRIVIA_GAMES_ADMIN_INSTRUCTION = `# Managing trivia games

This deployment supports multiple parallel trivia games — one per Slack channel that runs trivia. Each game has its own isolated data (questions, answers, cheats, seasons) under \`data/plugins/trivia/games/<name>/\` and its own pair of plugin-managed cron jobs (\`<name>:question\` and \`<name>:reveal\`). Add a new game and the plugin reconciles the cron jobs automatically on the next load.

**Lifecycle and configuration both go through the \`trivia:management\` integration.** Attach it via \`attach_integration("trivia:management")\` when an admin asks to add/remove/configure a game OR to change workspace-wide trivia settings OR to shape what kinds of QUESTIONS get generated (categories, axes, per-slot composition). When an admin talks about "questions" they almost always mean configuring the game or season — not generating one immediately. The integration's three tools:

- \`upsert_game(name, channel?, questionCron?, revealCron?, timezone?, enabled?, initialSeason?, ...axisOverrides?)\` — create OR update a game in one call. Create requires the full scheduling shape; when seasons are enabled, create ALSO requires \`initialSeason\` ({ slug, expectedEndAt, startedAt? }). Update is omit-to-keep on scheduling and omit-to-keep / null-to-clear on per-game axis overrides; \`initialSeason\` is rejected on update (edit a season with \`upsert_season\`).
- \`delete_game(name)\` — remove a game from the registry. Cron jobs disappear on next reconcile; the game's data directory is preserved.
- \`set_workspace_config({ answersFormat?, questionType?, freeformAnswerShape?, contexts?, difficulty?, difficultyRatio?, choices?, offDays?, seasons? })\` — update workspace-tier defaults. Omit to keep, null to clear.

When an admin asks to **create a new trivia game** (e.g. "set up trivia in #engineering"):

1. Ask for the channel ID, the post and reveal times, and the timezone (if not already specified). Reveal MUST be later in the day than the post.
2. Pick a short kebab-case \`name\` from context (e.g. "engineering"). Confirm with the admin.
3. Attach the \`trivia:management\` integration if not already attached.
4. Call \`upsert_game\` with the four required fields. When seasons are enabled, ALSO propose a first season and pass \`initialSeason: { slug, expectedEndAt, startedAt? }\` in the same call — pick a deliberate kebab-case slug and end date (don't let a machine-derived month slug get auto-seeded), then refine its categories/theme/format afterward with \`upsert_season\`. The plugin reconciles cron jobs on next load.

When an admin asks to **disable a game temporarily** (e.g. "pause the engineering trivia"):

- Call \`upsert_game(name: "engineering", enabled: false)\`. Cron jobs disappear on next reconcile; the data directory is preserved (frozen archive — reads still work, writes refuse).

When an admin asks to **re-enable a disabled game**: same path, \`enabled: true\`.

When an admin asks to **remove a game entirely**: \`delete_game(name)\`. The data directory stays under \`data/plugins/trivia/games/<name>/\` until you delete it manually (no MCP tool deletes per-game data).

When an admin asks **which trivia games exist** or **what's running where**: call \`list_games\` (always available to members+; no integration needed). Pass \`includeDisabled: true\` to also surface paused games. The response includes \`name\`, \`channel\`, \`timezone\`, \`enabled\`, \`questionCron\`, \`revealCron\`, optional \`prepCron\`, and \`axisOverrides\` per game, plus \`workspaceDefaults\` for the workspace tier.

**Optional pre-staging schedule (\`prepCron\`).** A game may opt in to PRE-STAGING by setting a third cron expression that fires before \`questionCron\`. When set, the plugin emits a channelless \`<name>:prep\` cron that generates and saves questions WITHOUT posting; the question cron then picks the oldest staged question per slot, falling back to inline-gen for any missing slot. When absent, the question cron generates AND posts in a single run (the legacy behavior — observable behavior unchanged for any existing game without \`prepCron\`). See the trivia management instruction for the derivation conventions Claude should use when proposing a \`prepCron\` value.

**The \`game\` slug is internal coordination metadata** — every trivia tool requires it as an argument, but you SHOULD NOT mention the slug to end users in user-facing posts unless an admin explicitly asks for it. In scheduled runs, the slug is baked into the prompt; in reactive (DM / mention / reaction) sessions, resolve it from the session's channel by matching against the channel field returned by \`list_games\`. If no game matches the channel, refuse with "no trivia game is configured for this channel."

## Admin: overriding a result after the reveal

When an admin judges a result differently than the reveal did ("mark Alice's answer correct", "that should have counted", "override the result for Bob") — follow the EXACT sequence below. The question MUST already be revealed; there is nothing to override before that. The shape depends on WHY the verdict is wrong — first decide whether it's ONE player or EVERYONE.

**Case 1 — One player, freeform answer the judge got wrong (the usual "override the result" ask):**

1. \`override_answer(game, questionId, userId, correct: true|false, reason: "<why>")\` — hand-sets THAT one player's verdict. \`reason\` is required and stored on the row. The original machine verdict is captured as a lock, so the reprocess in step 2 won't revert your fix.
2. \`compute_answers(game, reprocessQuestionIds: [questionId])\` — re-derives every OTHER row from the answer key while leaving your override in place.
3. \`update_answers_block(game, questionIds: [questionId])\` — repaints the card so the corrected standings show (the reprocess result's \`refreshHint\` is this exact call).

To UNDO an override later: \`override_answer(game, questionId, userId, restore: true)\` (omit \`correct\`/\`reason\`), then repeat steps 2–3.

**Case 2 — Everyone scored against a wrong BOOLEAN / CHOICE answer KEY:** do NOT override player by player. Fix the key once so every player is corrected together.

1. \`settle_question(game, questionId, outcome: <correct value>, override: true)\` — re-stamps \`isTrue\` / \`correctIndex\` and clears the stale verdicts. \`override: true\` is REQUIRED because the question already has a key.
2. \`compute_answers(game, reprocessQuestionIds: [questionId])\` — rescores EVERY player against the corrected key at once.
3. \`update_answers_block(game, questionIds: [questionId])\` — repaints the card (the reprocess result's \`refreshHint\` is this exact call).

**Case 3 — A cheat was recorded against a player by mistake:**

1. \`remove_cheat(game, cheaterUserId, questionId)\` — drops the cheat and rolls back that player's cheat counter.
2. \`compute_answers(game, reprocessQuestionIds: [questionId])\` — rescores the question now that the player is no longer excluded.
3. \`update_answers_block(game, questionIds: [questionId])\` — repaints the card (the reprocess result's \`refreshHint\` is this exact call).

## Admin: replaying a bad question

When an admin asks to **replay / redo / swap out a bad question** (it's ambiguous, the answer key is wrong beyond repair, it's a duplicate, etc.), follow the EXACT sequence below — do NOT improvise. Which sequence depends on whether the question's batch has been REVEALED yet (a question is unrevealed until its reveal fires; check by whether its results are already posted). The replacement ALWAYS lands so the round keeps its question count.

**A — Mid-window (the question is still LIVE, votes open, not yet revealed):**

1. \`settle_question(game, questionId, invalidate: true, invalidatedReason: "<specific reason>")\` — marks it invalidated (0 points) and clears any votes already cast on it.
2. \`update_answers_block(game, questionIds: [questionId])\` — repaints ONLY that one card into its "❌ Invalidated" state, leaving the still-live sibling questions' vote buttons untouched. (\`settle_question\`'s result hands you this exact call as its \`refreshHint\`.)
3. Generate a replacement (\`get_ideas\` → \`save_question\`) and post it into the SAME batch: \`post_questions(game, items: [...], appendToPreviousBatch: true)\`. Append mode joins the live batch so the replacement reveals alongside its siblings. It refuses if the batch was already revealed — if that happens, you're in case B, not A.
4. Nothing else. At reveal, \`compute_answers\` automatically skips the invalidated question (returns it under \`invalidatedQuestions\`, scores 0) and reveals the replacement.

**B — After the reveal (the batch is already scored):** the round is closed — there is NO replacement, just a void. Do NOT generate or post a new question.

1. \`settle_question(game, questionId, invalidate: true, invalidatedReason: "<reason>")\` — clears verdicts.
2. \`compute_answers(game, reprocessQuestionIds: [questionId])\` — re-scores the batch so the voided question stops counting for everyone.
3. \`update_answers_block(game, questionIds: [questionId])\` — repaints the voided card into its "❌ Invalidated" state (the sibling cards' results are unaffected by the void). \`settle_question\`'s \`refreshHint\` is this exact call.
`;

const SEASONS_ADMIN_ADDENDUM = `
## Admin: managing seasons on the timeline

Seasons are enabled for this deployment. Seasons live on a single timeline (\`seasons.json\`) where each entry has a slug, startedAt, expectedEndAt, optional endedAt, and an OPTIONAL categories pool. "Current" is whichever entry's window contains \`now\`. No two seasons may overlap, but multiple future seasons can be queued simultaneously, refined as the date approaches, and even renamed (delete + re-create) while they're still in the future.

**Game-authoritative writes — the game is the source of truth; a season holds only deltas.** Default EVERY configuration edit to the game tier (\`upsert_game\`, or \`set_workspace_config\` for workspace-wide defaults). Write a season override (\`upsert_season\`) ONLY when the admin explicitly scopes a change to a specific or the current season (a themed event, a one-off). The "omit \`categories\`, inherit from the game" principle below generalizes to ALL axes AND \`format\`: a season should carry a field only when it is an intentional season-specific override; absent fields inherit from the game. Do not write a season override unprompted.

**Shadowing — when a game edit is masked.** \`upsert_game\` returns \`shadowedBy: { tier: "season" | "slot", slug?, fields }\` when a field you just wrote is masked by a higher cascade tier (an active season, or — when no season format is active — the game's own format slot). When you see it: TELL the admin their game edit will NOT take effect while that tier masks it, and ASK whether to apply the change to the current season too. On YES, CLEAR the season override(s) so they fall through to the new game value — \`upsert_season(slug, { <field>: null, ... })\` (clear, do NOT copy the value into the season). On NO, leave the season unchanged; the game edit takes effect once the season ends (the next season inherits the new game value).

**Category cascade.** A season's \`categories\` field is OPTIONAL. When present, that list IS the season's pool. When absent, the pool resolves via the cascade \`slot → season → game → categories.json (global)\` — the season inherits from the game's pool if the game has one, else from the global baseline. This is the new default for non-themed seasons: omit \`categories\` and let inheritance flow.

When an admin asks to **prepare a future season** (e.g. "set up next month's season as marine-biology"):

1. Derive a slug from \`trivia.seasons.prompt\` plus the date / admin intent.
2. Derive \`startedAt\` and \`expectedEndAt\` matching the prompt's cadence.
3. If the season has a clear theme, generate a list of ~20 themed categories for the theme and pass them as \`categories\`. The new season's pool will be EXACTLY that list (themed seasons are purely themed, not "baseline + a few themed"). If there is no clear theme, **OMIT** \`categories\` — the new season's pool will be inherited from the game / global cascade. Do NOT pass \`categories: null\` on CREATE (that's reserved for UPDATE).
4. Call \`upsert_season(slug, { startedAt, expectedEndAt, categories? })\`. The overlap invariant ensures it slots cleanly into the timeline.

To **clear a season's themed pool** (drop it back into cascade-inheritance), call \`upsert_season(slug, { categories: null })\`. The next-firing question will draw from the game / global pool.

To **add categories to a season after it's been created**, call \`add_categories(["..."], target: "<slug>")\`. If the season has no \`categories\` field (it's inheriting), \`add_categories\` will error with \`SEASON_INHERITS_CATEGORIES\` and tell you to call \`upsert_season(slug, { categories: [...] })\` first to break inheritance. To remove some, use \`remove_categories\` with the same target — and note that removing the LAST category from a season DROPS the \`categories\` field entirely (the season inherits again), rather than erroring.

To **inspect the timeline** (see what seasons exist, their dates, and full category lists), call \`list_seasons\`. Each entry includes a \`status\` flag ("past" | "current" | "future"). Use this when an admin asks "what's queued for next month?" or "what categories does the marine season have?".

When an admin asks to **end the current season immediately** (cut it short):

- Call \`upsert_season(currentSlug, { endedAt: <now> })\`. The next-queued season (if any) takes over naturally as \`now\` crosses into its window.

When an admin asks to **edit a queued future season**:

- Use \`upsert_season(slug, { ... })\` to change dates, or \`add_categories(["..."], target: "<slug>")\` / \`remove_categories(["..."], target: "<slug>")\` to refine its pool.
- Use \`delete_season(slug)\` to retract a not-yet-started future season entirely (only allowed when its startedAt is still in the future).

When an admin asks to **rename a future season**:

- Slug is immutable. Call \`delete_season(oldSlug)\` then \`upsert_season(newSlug, ...)\`. Only valid while the season has not yet started.

## Admin: answer formats per season

Each season can also carry an optional \`answersFormat\` weight map (e.g. \`{ "boolean": 2, "choice": 1 }\` → roughly 2/3 true-false questions, 1/3 multiple-choice; or \`{ "boolean": 1, "choice": 1, "freeform": 1 }\` to also roll free-form questions where the user types their answer into a Slack modal). When set, that map overrides the workspace-level \`config.trivia.answersFormat\` default for whichever season is current per \`findCurrentSeason\`. When absent, the workspace config (or pure-boolean fallback) is used. Keys you omit read as zero — \`{ "choice": 1 }\` is shorthand for \`{ "boolean": 0, "choice": 1, "freeform": 0 }\`.

When an admin asks to **set a season to only generate multiple-choice questions** (or only true-false, or a custom mix):

- Call \`upsert_season(slug, { answersFormat: { boolean: <w1>, choice: <w2>, freeform: <w3> } })\` (any subset; omitted keys default to 0). At least one weight must be strictly positive. Mid-season mutation is permitted (unlike \`startedAt\`) — the next \`get_ideas\` call picks up the new mix.

When an admin asks to **clear a season's answersFormat** (let it fall back to the workspace default):

- Call \`upsert_season(slug, { answersFormat: null })\`.

Note: the choice-question option-count bounds live at \`config.trivia.choices.{min, max}\` and are workspace-wide — they cannot be overridden per season (purely a card-readability UX setting, not a gameplay parameter).

## Admin: question type per season (fact vs topical)

Independent from \`answersFormat\`, each season can carry a \`questionType\` weight map for the fact-vs-topical axis: \`{ "fact": <w1>, "topical": <w2> }\`. \`"fact"\` questions are static-knowledge; \`"topical"\` questions force Claude to use \`WebSearch\` to find a recent newsworthy event before writing the question.

- Call \`upsert_season(slug, { questionType: { fact: 3, topical: 1 } })\` to bias the season toward topical questions (here, roughly 1/4 of fires will be topical).
- Call \`upsert_season(slug, { questionType: null })\` to clear and fall back to \`config.trivia.questionType\` (or the \`{ fact: 1, topical: 0 }\` default).

## Admin: contexts (lens) per season

A season may also carry an optional \`contexts\` axis — a list of lenses Claude tries in priority order when generating each question (e.g. \`"Quebec"\`, \`"International"\`, \`"academic"\`, \`"pop culture"\`, or the empty string for "no specific lean"). \`get_ideas\` returns a freshly-rolled weighted-random ordering each call; Claude descends the list only when the current lens yields no usable question.

- Call \`upsert_season(slug, { contexts: [{ name: "Quebec", weight: 5 }, { name: "International", weight: 1 }] })\` to bias toward Quebec-flavored questions with International as a fallback.
- Call \`upsert_season(slug, { contexts: null })\` to clear and fall back to \`config.trivia.contexts\` (or generate without a lens).

## Admin: per-season question composition (format)

Each season can carry an optional \`format\` field — an ordered list of question SLOTS posted per question-cron fire. When set, every fire posts \`format.questions.length\` questions in slot order instead of one. Each slot can specialize:

- \`label\` — creative hint surfaced to Claude as the slot's flavor (e.g. "Lightning Round", "Historical Choice"). NOT a literal string to copy into the question text.
- \`categories\` — narrows the slot's category pool. Omitted → inherits the season's \`categories\`.
- \`answersFormat\` — overrides the season's \`answersFormat\` for this slot. Omitted → falls back to season → config → boolean default.
- \`questionType\` — overrides the season's \`questionType\` for this slot (fact vs topical weights).
- \`contexts\` — overrides the season's \`contexts\` for this slot (e.g. one slot uses regional lenses; another uses audience lenses).

The resolution cascade for each slot is: \`slot.* ?? season.* ?? game.* ?? config default\`. Empty slot \`{}\` is permitted and means "use season defaults for everything".

A game can ALSO carry its own \`format\` field, which is used as a fallback for question-cron fires when no active season supplies a \`format\`. The format cascade is \`season.format → game.format → (single-question fallback)\` — the season wins when both are set, matching the per-axis cascade ordering. To set a per-game format, call \`upsert_game(name, { format: { questions: [...] } })\` — \`upsert_game\` accepts \`format\` with the same wholesale-replace / omit-to-keep / null-to-clear semantics as the season \`format\`. Same logic applies to per-game \`categories\` (narrows the channel-default category pool when no season is active) and per-game \`theme\` (used in openers/finales when the active season has no \`theme\`).

When an admin asks to **set up a format** (e.g. "3 general-knowledge true-false followed by 2 historical choice"):

- For a SEASON-level format, call \`upsert_season(slug, { format: { questions: [<one entry per slot>] } })\`. For a GAME-level format (the fallback used when no active season supplies one), call \`upsert_game(name, { format: { questions: [<one entry per slot>] } })\`. Either way, \`format\` is replaced wholesale on each call (no per-slot tools). On UPDATE, omitting \`format\` keeps the existing value; passing \`null\` clears it (back to single-question-per-fire behavior).

Soft guidance: aim for ≤ 10 slots per format. The system has no hard cap, but larger formats stress Claude's per-fire generation budget.

When an admin asks **what slots a season has**, look at the season entry returned by \`list_seasons\` and read \`format.questions[]\`. When asking about a game-tier format / categories / theme, look at the \`list_games\` entry's \`format\` / \`categories\` / \`theme\` fields (surfaced only when literally set on the game).

## Admin: auto-rollover inherits structure, resets the themed pool

When a season's last reveal fires AND no future season is queued, the trivia plugin creates a continuation season automatically. The continuation deep-copies the **structural** fields — \`answersFormat\`, \`questionType\`, \`contexts\`, AND \`format\` — from the closing season (absent fields stay absent). It does **NOT** carry forward the closing season's **season-level** \`categories\`: a themed pool is a one-month deviation, so the continuation omits \`categories\` entirely and resolves its pool via the cascade (\`game.categories → global categories.json\`). Slot-level \`format.questions[i].categories\` IS preserved (it rides along with the copied \`format\` as structural slot composition, not a theme). The continuation slug is \`season-YYYY-MM\` for the next UTC month; \`expectedEndAt\` is end-of-that-month.

To **carry a theme forward** — i.e. you want next month's season to keep this month's themed categories (or otherwise look different from the inherited default) — stage a future season explicitly via \`upsert_season(newSlug, { startedAt: <future>, expectedEndAt: ..., categories: [...], format?: {...} })\` BEFORE the current season's last fire. Staged future seasons are honored as-is; the auto-continuation only kicks in when there's nothing queued.
`;

export function getTriviaCheckInstruction(seasonsEnabled: boolean): string {
  return seasonsEnabled
    ? BASE_TRIVIA_CHECK_INSTRUCTION + SEASONS_ADMIN_ADDENDUM
    : BASE_TRIVIA_CHECK_INSTRUCTION;
}

/** Backward-compatible export for callers that don't yet know about seasons. */
export const TRIVIA_CHECK_INSTRUCTION = BASE_TRIVIA_CHECK_INSTRUCTION;

/**
 * Catalog description for the `trivia:management` integration. Enumerates every gated
 * tool by name so Claude can scan and pick the right tool from the AVAILABLE INTEGRATIONS
 * block in the system prompt.
 */
export const TRIVIA_MANAGEMENT_DESCRIPTION =
  "Manage trivia games, seasons, categories, and workspace-tier defaults. Admin only. Attach when the user wants to add/remove/configure trivia games or seasons, manage the category pool, or change workspace-wide trivia defaults. Tools: upsert_game, delete_game, set_workspace_config, upsert_season, delete_season, add_categories, remove_categories.";

/** Topic-scoped admin instruction loaded when `trivia:management` is attached. */
export const TRIVIA_MANAGEMENT_INSTRUCTION = `# Managing trivia games, seasons, categories, and workspace config

The \`trivia:management\` integration gives you seven admin-only tools that mutate the trivia plugin's persisted config (\`data/plugins/trivia/config.json\`, per-game \`seasons.json\`, \`categories.json\`) directly. No confirm-and-apply flow — these write through immediately.

## Default to the game tier — season is for overrides only

**The game is the source of truth. ~99% of configuration edits belong on the game tier (\`upsert_game\`), or the workspace tier (\`set_workspace_config\`) when the admin says "all games."** A season holds ONLY intentional, scoped overrides — a themed month, a one-off event, "just for the current season." If the admin does not explicitly name a season or scope the change to one, write the GAME, not the season. Do NOT reach for \`upsert_season\` just because a season is active.

When the scope is genuinely ambiguous (e.g. "make engineering questions harder" with no season named), default to the game tier and say so in one line — "Setting this on the engineering game; tell me if you meant just the current season" — then proceed. Don't stall on a question the default already answers.

## Dispatch heuristic — pick the right tool

When an admin asks to change something, parse the verb and the scope first:

- **"game"**, names a game, OR no tier named at all → \`upsert_game\` / \`delete_game\`. **This is the default.**
- **"season"**, names a season slug, OR scopes to "this season / the current season / just for now" → \`upsert_season\` / \`delete_season\`. Only when explicitly season-scoped.
- **"add a category"** / **"remove the X category"** / names categories → \`add_categories\` / \`remove_categories\` (with \`target\` if scoped to a season).
- **workspace-wide** rolls of any axis (e.g. "make all games default to mostly topical") → \`set_workspace_config\`.

**About "questions":** When an admin talks about "questions" — "I want more questions about X", "add a question on Y", "make questions harder", "we should have topical questions" — they are asking you to CONFIGURE the game or season, NOT to generate a single question on the spot. Route to \`upsert_game\` (per-game scope), \`upsert_season\` (season scope), or \`upsert_season\` with \`format.questions[i].<axis>\` (per-slot scope), typically by updating \`categories\`, an axis weight (\`questionType\`, \`answersFormat\`, \`difficulty\`, \`contexts\`), or a slot's fields. Only generate a question immediately when the admin is unambiguously asking for an on-demand fire (e.g. "post a trivia question now", "fire the engineering game right now").

"Update the trivia config for the engineering game" → \`upsert_game(name: "engineering", …)\`. It is NOT \`upsert_season\` even if the engineering game has an active season — the admin said "game."

## Validate the scope before mutating

The cascade (slot → season → game → workspace) means routing decisions matter — a season-tier change won't beat a slot-tier override, and a game-tier change won't beat a season-tier override. Before calling ANY mutation tool, you must be certain of:

1. **Which game** the admin means. If multiple games exist (\`list_games\` will tell you) and the request doesn't name one, ASK. Don't assume the current channel's game — admin sessions are often DMs with no implicit channel.
2. **Which season**, if seasons are in play. "Add a question / category for the season" could mean the **current** season, a **queued future** season (there can be several), or the **global baseline** (\`categories.json\`, used as the seed for new seasons). Run \`list_seasons\` if you don't already know what's on the timeline; then ask the admin which one they mean unless context makes it unambiguous. For \`add_categories\` / \`remove_categories\`, encode the answer in the \`target\` arg (\`"current"\` / \`"<slug>"\` / \`"default"\` / \`"both"\`).
3. **Which tier in the cascade**. "Make questions harder", "more topical questions", "switch to multiple-choice" — could be slot-level (one slot in a format), season-level (the whole current season), game-level (every season this game runs), or workspace-level (every game). When the admin didn't say, **default to the game tier** (per the rule above) and note it in one line — don't ask.

When the tier IS genuinely uncertain because the admin gestured at a season ("for this run", "the special event") without naming one, briefly state in plain English what you're about to change and at which tier, and confirm before the tool call. Reads are free — use \`list_games\` / \`list_seasons\` to ground the question rather than guess.

## Flag shadowed edits

The cascade is first-non-empty-wins, so a write at tier N is INERT for any field a higher-priority tier (slot > season > game > workspace) already overrides. Before mutating, check the upstream tiers for the field you're about to change. If a shadow exists, complete the write the admin asked for, then warn them in plain English:

- "Set \`questionType\` on the engineering game to \`{ fact: 1, topical: 3 }\`. **Heads up:** the current season \`season-2026-05\` has its own \`questionType\` override, so this game-tier change won't take effect until that season ends (or you clear the season override with \`upsert_season(slug, { questionType: null })\`)."
- "Set \`answersFormat\` on the workspace to \`{ choice: 1 }\`. **Heads up:** the engineering and marketing games both have per-game \`answersFormat\` overrides, so this workspace default won't apply to them until those are cleared with \`upsert_game(name, { answersFormat: null })\`."
- "Set \`categories\` on the current season. **Heads up:** slot 0 of the season's format has its own \`categories\` list, so its pool stays narrow regardless of this season-tier change."

This applies to every cascading axis (\`answersFormat\`, \`questionType\`, \`freeformAnswerShape\`, \`contexts\`, \`difficulty\`, \`difficultyRatio\`) and to \`categories\` on seasons. \`list_games\` surfaces per-game \`axisOverrides\`; \`list_seasons\` surfaces per-season axis fields and \`format.questions[i]\` slot overrides — read both before mutating game or workspace tiers if you're not already sure what's set upstream.

## Correcting an already-posted batch

A config edit via \`upsert_game\` / \`upsert_season\` / \`set_workspace_config\` takes effect for FUTURE batches ONLY. \`revealResponses\` and \`judgeLeniency\` are STAMPED on each question when it is posted, so changing them afterward does NOT change a batch already on the board — and that is the DEFAULT, intended behavior. After a normal config edit, do NOT reprocess anything. At most, note in one line that the change applies to future batches, and offer to update the already-posted batch only if they want it.

Reprocessing an already-posted batch is a SEPARATE, EXPLICIT, admin-initiated action. Only do it when the admin clearly asks to update / fix / re-apply something to questions that are ALREADY posted — e.g. "update the previous answers", "fix the last batch's reveal", "re-apply this to what's already posted", "reprocess today's questions". **Never reprocess on your own initiative, never as an automatic follow-up to a config change, and never just to be helpful** — a freeform re-judge can flip a borderline verdict, so it stays opt-in by design.

When the admin DOES explicitly ask to update an already-posted batch:

1. Make the config edit at the right tier first (usually \`upsert_game\`), if it isn't already set.
2. Call \`compute_answers({ game, reprocessQuestionIds: [...] })\` with the ids of the questions to re-apply it to. Reprocess re-resolves the current \`revealResponses\` / \`judgeLeniency\` from the cascade, re-stamps them on those questions, re-derives boolean/choice verdicts from the current key, and RE-JUDGES freeform answers under the new leniency. Find the ids via \`find_previous_questions\` (e.g. \`recentBatchFromNow: 1\` for the last batch, which returns each question's \`id\`) if you don't already have them.
3. RE-AUTHOR THE PER-CARD NARRATIVE — branch on the payload's \`includeRevealInQuestions\` (do this AFTER step 2, BEFORE step 4), exactly as the reveal flow does:
   - \`"yes"\`: for EACH reprocessed question in \`reveals\`, call \`update_question({ game, questionId, revealBlocks: [...] })\` with freshly authored narrative. You MUST re-author rather than leave the old blocks: reprocess can have changed what the card shows — a new \`revealResponses\` mode may now hide a typed answer the old narrative quoted, and a re-judge may have flipped a verdict the old narrative asserted. Conform the new narrative to that question's CURRENT \`voters.revealResponses\` (never quote a typed answer a non-\`"yes"\` mode hides) and to the re-derived verdicts. Author every reprocessed card's narrative BEFORE step 4.
   - \`"no"\`: do NOT call \`update_question\` — cards stay facts-only.
4. Call \`update_answers_block({ game, questionIds })\` passing \`reveals.map(r => r.questionId)\` to re-render the cards.

NEVER use \`run_scheduled_message_now\` on the reveal job to apply a config change to a posted batch — that re-fires the whole reveal cron and is not the right tool. And never tell the admin a posted batch changed unless you actually reprocessed it: editing the config alone leaves the existing cards exactly as they were.

## Topping up an unrevealed batch (flexible underflow)

A \`flexible\` game posts a PREFIX of its slots — anywhere from 0 up to the slot count — so a fire can land FEWER questions than the admin wanted. When the admin asks to "add a question to today's batch", "we're one short", "append a question before the reveal", etc., AND that batch has not revealed yet, you can extend it in place rather than waiting for the next fire:

1. Confirm which game, and that its most-recent batch is still pending (not revealed). \`get_question_history\` shows the latest batch and whether any question carries a \`processedAt\`. If the latest batch is already revealed, you CANNOT top it up — say so and offer to post a fresh batch instead.
2. Generate the question the normal way: \`get_ideas\` → \`save_question\` (it rolls the cascade and saves a pending record, exactly as a fire would).
3. Post it with \`post_questions({ game, items: [{ questionId, blocks }], appendToPreviousBatch: true })\`. The \`appendToPreviousBatch\` flag joins the game's most-recent (unrevealed) batch instead of minting a new one, so the new question reveals TOGETHER with the rest of the batch. \`post_questions\` posts it as its own new message in the game's channel automatically — there is no separate "also post to Slack" step.

Two guardrails the tool enforces for you, surfaced so you can explain them:

- If the latest batch is ALREADY revealed, \`appendToPreviousBatch\` fails atomically (no post, no mutation). Appending would resurrect a closed round. Drop the flag to start a fresh batch instead.
- If the flexible fire posted ZERO questions (skipped the day), there is no pending batch to append to — \`appendToPreviousBatch\` has nothing to target. Just post a normal fresh batch (omit the flag).

\`appendToPreviousBatch\` always targets the MOST-RECENT batch by post time; it cannot reach an older pending batch if a newer one exists. That's fine for the usual same-day top-up.

## The cascading axis tiers

Five axes cascade across tiers when generating a question. Resolution order, first non-empty wins:

\`\`\`
slot → season → game → workspace → built-in default
\`\`\`

The five cascading axes:

- \`answersFormat\` — weighted-random map of \`boolean\` / \`choice\` / \`freeform\`.
- \`questionType\` — weighted-random map of \`fact\` / \`topical\`.
- \`freeformAnswerShape\` — weighted-random map of \`name\` / \`place\` / \`phrase\` / \`title\` / \`date\` / \`number\` / \`other\`. Freeform-only.
- \`contexts\` — list of \`{ name, weight? }\` lenses; \`get_ideas\` returns a freshly-rolled priority order.
- \`difficulty\` — per-format \`{ easy: [min, max], medium: …, hard: … }\` ranges (defines what each bucket MEANS on the 1–10 scale). Per-sub-field merge (you can override just \`freeform.hard\` without restating the rest). The rolled bucket's range IS the strict accept bound at the DIFFICULTY GATE — there is no separate threshold.
- \`difficultyRatio\` — per-format \`{ easy: N, medium: N, hard: N }\` bucket-roll weights (controls how often each bucket is rolled, NOT what each bucket means). Whole-object replace per tier (slot/season/game/workspace each either supplies a full triple for the format or cascades through). Defaults: \`{ easy: 3, medium: 6, hard: 1 }\` for boolean/choice (preserves the prior 30/60/10), \`{ easy: 5, medium: 4, hard: 1 }\` for freeform (skewed easier in tandem with the softer freeform ranges).
- \`hint\` — optional \`{ mode: "none" | "button" | "inline", minDifficulty?: "easy" | "medium" | "hard" }\`. Whole-object replace per tier; defaults to \`{ mode: "none" }\`. When \`mode\` is non-\`"none"\` AND the rolled difficulty bucket meets \`minDifficulty\` (or no threshold is set), \`get_ideas\` returns \`suggestedHintMode\` and Claude drafts a hint via the HINT DRAFTING GATE. **\`"button"\` and \`"inline"\` are different game-design choices, not just UI variants** — \`button\` is a per-player opt-in safety net (each player chooses whether to consume the hint via an ephemeral message); \`inline\` is a room-wide difficulty floor adjustment (every player sees the hint immediately as a context block above the answer buttons). Pick deliberately — flipping a workspace from \`button\` to \`inline\` effectively lowers difficulty for the whole room.

Reveal-display config that is GAME + WORKSPACE only (NOT a per-question axis — no slot/season tier):

- \`tellMeMore\` — optional \`{ enabled: boolean }\`, defaults to \`{ enabled: false }\`. When enabled, each revealed question card grows a "Tell me more" button; clicking it removes the button, posts a short intro tagging the clicker, and starts a streamed thread conversation where Clack digs into deeper detail about the question and its answer — then stays open for follow-ups. Cascade: \`game → workspace → { enabled: false }\`. Set via \`upsert_game(name, { tellMeMore: { enabled: true } })\` or \`set_workspace_config({ tellMeMore: { enabled: true } })\`; null clears.

Slot lives inside a season's \`format.questions[i]\`. Season is a SeasonEntry. Game lives on the \`TriviaGame\` registry entry and sits between season and workspace. Workspace is the top-level fields on the plugin config.

## The seven tools

### Lifecycle — games

- \`upsert_game(name, …)\` — Create OR update a game (detected by whether \`name\` already exists). **Create** requires \`channel\`, \`questionCron\`, \`revealCron\`, \`timezone\`; \`enabled\` defaults to true. **Update** is omit-to-keep on scheduling fields; axis fields are omit-to-keep with explicit \`null\` to clear. Name is immutable. **Optional pre-staging** via the \`prepCron\` field and **optional voting-lock** via the \`lockCron\` field — see the dedicated sections below.
- \`delete_game(name)\` — Remove a game from the registry. Cron jobs disappear on next plugin reload. The per-game data directory (\`data/plugins/trivia/games/<name>/\`) is preserved on disk for archival.
- \`unlock_questions(game)\` — Admin escape hatch that reverses an early/mistaken lock: reopens voting on every locked, not-yet-revealed question (restores the answer buttons). Use when \`lockCron\` fired too soon or an event was postponed. Already-revealed questions are never reopened.

### Lifecycle — seasons

- \`upsert_season(game, slug, …)\` — Create OR update a season within a specific game. Validates no timeline overlap. Slug is immutable — to rename, delete + re-upsert. Theme / axis fields use null-to-clear, omit-to-keep semantics. Categories on CREATE: pass a list to make a themed season; omit to copy the global baseline.
- \`delete_season(game, slug)\` — Retract a future season (only allowed when \`startedAt\` is still in the future).

### Categories

- \`add_categories(categories[], target?)\` — Append to a category pool. \`target\` defaults to \`"both"\` (current season + global baseline); pass a season slug to scope to one season, \`"current"\` for active-only, \`"default"\` for baseline-only.
- \`remove_categories(categories[], target?)\` — Same target semantics.

### Workspace-tier defaults

- \`set_workspace_config({ … })\` — Update any subset of workspace-tier fields. Omit to keep, \`null\` to clear. Fields: the 5 cascading axes (same shapes as \`upsert_game\`), \`choices: { min, max }\` (workspace-only — choice-question option-count bounds), \`offDays: [{ date, label }]\` (workspace-only — shared off-days; full-list replacement), \`seasons: { enabled, prompt }\` (workspace-only — seasons feature flag + author prompt).

## Admin: optional pre-staging schedule (\`prepCron\`)

Each game can OPT IN to **pre-staging** by setting a third cron expression, \`prepCron\`, alongside \`questionCron\` and \`revealCron\`. When set, the plugin emits a third channelless cron spec (\`<name>:prep\`) whose only deliverable is calling \`save_question\` for each missing slot — it cannot post a Slack message (the cron is channelless AND its tool allowlist excludes \`post_questions\`, so accidental posting is structurally impossible). The question cron then becomes a presentation-mostly run: read the staged pool, fall back to inline-gen for any missing slot, build the flair blocks, post. When \`prepCron\` is ABSENT, the question cron behaves exactly as it did before this feature shipped — generate AND post in a single run. Existing games without \`prepCron\` need no migration; the legacy path is preserved verbatim.

### Why an admin might enable it

- **Smoothing post latency.** Generation can take 30+ seconds for multi-slot formats with self-review reframes; pre-staging absorbs that latency invisibly so the post arrives crisp at the configured time.
- **Surviving transient generation failures.** A flaky generation run before \`questionCron\` fires has a full window to retry on the next prep fire (or rely on the question-cron inline-gen fallback) — failures do not silence the channel.
- **Headroom for richer generation.** Future expansions (one Claude per slot, richer per-question research) are easier to absorb when generation isn't on the critical path.

### Proposing a \`prepCron\` value

The bot does NOT derive \`prepCron\` automatically — that responsibility is INTENTIONALLY yours (Claude). Reason: cron arithmetic across day/week/month boundaries, DST transitions, and multi-fire-per-day patterns has no single mechanical "right" answer; conversational reasoning handles the edge cases far more robustly than encoded logic. **Do NOT add this derivation to bot code.** When an admin sets up or edits a game and you suggest a \`prepCron\`, follow this recipe:

1. **Default convention: 30 minutes before \`questionCron\`.** Long enough to cover worst-case generation latency for a 3-slot batch with self-review reframes; short enough to keep topical questions fresh. State the default explicitly and confirm with the admin before applying.
2. **Common cases:**
   - \`questionCron = "0 9 * * *"\` (9 AM daily) → \`prepCron = "30 8 * * *"\` (8:30 AM daily). Clean shift.
   - \`questionCron = "0 9 * * 1-5"\` (9 AM weekdays) → \`prepCron = "30 8 * * 1-5"\`. Same day-pattern, clean shift.
   - \`questionCron = "30 9 * * *"\` (9:30 AM daily) → \`prepCron = "0 9 * * *"\` (9 AM daily). Borrow from minutes only.
3. **Midnight-crossing edge case:** when shifting back 30 min would cross into the previous calendar day, the day-pattern may exclude it. Example: \`questionCron = "0 0 * * *"\` (midnight daily) shifted back 30 min produces \`prepCron = "30 23 * * *"\` which fires on the PREVIOUS calendar day. Surface this to the admin explicitly:
   - **Option A — accept the previous-day fire.** Valid if the admin is OK with prep running the night before. State this clearly: "Heads-up: prep would fire at 11:30 PM the previous day. Generated questions sit overnight before posting — fine for fact questions, risky for topical."
   - **Option B — propose a non-midnight \`questionCron\`.** "Want to bump questionCron to 8 AM instead? Then prep at 7:30 AM same day works cleanly."
   - **Option C — narrow the prep window.** "Use a shorter offset, like 5 min before midnight (\`prepCron = "55 23 * * *"\` on the previous day) — same day-crossing trade-off, but a smaller window of staleness."
4. **Weekly / multi-fire-per-day patterns** are more nuanced — reason about whether the shift preserves the original day-of-week pattern. When in doubt, ask the admin for the exact desired prep time directly rather than guessing.

### Failure semantics

Pre-staging is an OPTIMIZATION, not a hard requirement. When prep fails (Claude crash, network blip, partial \`save_question\` failure), the next question cron simply inline-generates any missing slot. The system is self-healing: a missed prep run inflates the question-cron's latency but never silences the channel. Surface this to admins so they understand the trade-off — they're not signing up for a fragile new dependency, they're getting an optimization layer with a guaranteed fallback.

### Removing \`prepCron\`

To opt a game back OUT of pre-staging, call \`upsert_game(name: "<game>", prepCron: null)\`. The plugin drops the prep spec on next reconcile and the question cron switches back to the legacy gen-and-post prompt.

## Admin: optional voting-lock schedule (\`lockCron\`)

Each game can OPT IN to a **voting lock** by setting a \`lockCron\` alongside \`questionCron\` and \`revealCron\`. When set, the plugin emits a channelless \`<name>:lock\` cron whose only deliverable is calling \`lock_questions\` — it freezes voting on every posted-but-unrevealed question by stripping the answer buttons and showing a "locked in — waiting on results" notice. It cannot post a Slack message (channelless AND its tool allowlist excludes \`post_questions\`). When \`lockCron\` is ABSENT, voting stays open until the reveal edits the cards — identical to pre-feature behavior.

This is built for **prediction games**: lock picks at the event's kickoff so nobody can change their answer once the outcome starts to unfold, then reveal later once the result is known. It is type-agnostic, though — a lock simply freezes whatever questions are open.

Schedule \`lockCron\` BETWEEN \`questionCron\` and \`revealCron\` (e.g. question at 9 AM, lock at kickoff 7 PM, reveal at 10 PM). To opt back out, call \`upsert_game(name: "<game>", lockCron: null)\`. If a lock fired too early or an event was postponed, call \`unlock_questions(game)\` to reopen voting.

## When to use which — examples

- "Add a trivia game in #engineering at 9am" → \`upsert_game\`.
- "Make the engineering game roll only choice questions" → \`upsert_game(name: "engineering", answersFormat: { choice: 1 })\`.
- "Make ALL games roll mostly topical questions" → \`set_workspace_config(questionType: { fact: 1, topical: 3 })\`.
- "Pause the marketing trivia for a while" → \`upsert_game(name: "marketing", enabled: false)\`.
- "Remove the retired game entirely" → \`delete_game(name: "retired")\`.
- "Set up next month's season as marine-biology" → \`upsert_season(game: "<game>", slug: "marine-biology", startedAt: …, expectedEndAt: …, categories: [...])\`.
- "End the current engineering season now" → \`upsert_season(game: "engineering", slug: "<current>", endedAt: <now>)\`.
- "Add Quebec history as a category" → \`add_categories(["Quebec history"])\` (defaults to current season + global baseline). Scope to "current season only" with \`target: "current"\`, to baseline only with \`"default"\`, or to a specific season slug.
- "Add Christmas as an off-day" → \`set_workspace_config(offDays: [...existing, { date: "12-25", label: "Christmas" }])\` (full replacement; \`list_games\` surfaces \`workspaceDefaults.offDays\` so you can read first).
- "Pre-generate engineering's questions 30 min before posting" → \`upsert_game(name: "engineering", prepCron: "30 8 * * 1-5")\` if questionCron is \`"0 9 * * 1-5"\`. Confirm the proposed prepCron with the admin before applying. See the dedicated pre-staging section above for derivation conventions.
- "Stop pre-staging engineering" → \`upsert_game(name: "engineering", prepCron: null)\`.
- "Lock predictions at 7pm before tonight's match" → \`upsert_game(name: "<game>", lockCron: "0 19 * * *")\`. Confirm the time sits between questionCron and revealCron.
- "Reopen voting — the game was postponed" → \`unlock_questions(game: "<game>")\`.

## Cascade-tier cheatsheet for axis questions

Listed default-first — prefer the top entries; only descend to a season/slot tier when the admin explicitly scoped it there.

- "Configure this for a game" / no tier named (**the default**) → \`upsert_game\` with the axis field.
- "Configure this for every game" → \`set_workspace_config\` with the axis field.
- "Configure this just for the current season of one game" → \`upsert_season\` with the axis field at the season tier. Override only.
- "Configure this for one specific question slot in a season" → \`upsert_season\` with \`format.questions[i].<axis>\`. Override only.

When in doubt, call \`list_games\` first to see what the current state looks like — its response includes per-game \`axisOverrides\` and workspace-tier \`workspaceDefaults\`. For season state, \`list_seasons\` shows the full timeline per game.
`;
