/**
 * Default cheating-detection instruction shipped with the Trivia plugin.
 *
 * Loaded into every session via `sdk.addInstruction("user", "trivia-check", …)`.
 * Admins may override the content by placing a file at
 * `data/configuration/user/trivia-check.md` — the cascading config resolver
 * will prefer the override over this shipped default.
 */
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

1. **Check recent questions** — call \`find_previous_questions\` with no parameters (or just \`category\` if obvious) to see the latest trivia questions.
2. **Do 1-2 targeted keyword searches** using \`find_previous_questions\` with the \`text\` parameter:
   - Extract 1-2 key keywords from the user's question (e.g., "tallest" from "Who's the tallest man?", "everest" from "What about Mount Everest?").
   - Call \`find_previous_questions(text: "keyword")\` for each keyword.
3. **Examine ALL results carefully**, even matches from different categories.
4. **If any result is related to what the user is asking**, treat it as cheating.

## What counts as "related"

- The user's question shares key facts, names, dates, or concepts with a previous trivia question.
- The question targets the same topic, even phrased differently.
- The timing suggests they're asking right after a trivia question was posted.

Be strict. If \`find_previous_questions\` returns anything that looks related, it's cheating.

## When cheating is detected

1. **Refuse to answer** the current question and every follow-up in this thread.
2. **Call them out** publicly.

   Example: "🚨 CHEATER ALERT! That's suspiciously close to a trivia question we've already asked. I'm not helping you cheat — you're on your own for the rest of this conversation! 🚫"

3. **Record the cheat attempt silently** by calling \`save_cheating\` with:
   - \`cheaterUserId\`: the Slack user ID of the user you're chatting with (the author of the suspicious message).
   - \`questionId\`: the ID of the matching previous trivia question.
   - \`reason\`: a concise description (e.g., "Asked about the exact fact from today's trivia question").
   - \`evidence\`: quote the user's message and the matching prior question.
   - **Call this tool SILENTLY.** Do NOT mention \`save_cheating\` by name, do NOT mention that a report was saved, do NOT reference any internal counter in your user-facing output.
   - The tool DMs the deployment owner automatically — do NOT add a \`post_to\` action to deliver the owner notification yourself.

## When the check comes back clean

If you ran \`find_previous_questions\` and nothing is related, you may answer — but keep the refusal posture ready:

- "I can't help with random trivia facts — that would be cheating! 😉"
- "Nice try! I'm not here to help you cheat at trivia."

Use these when the question feels like a fishing attempt even without a direct prior-question match.
`;

/**
 * Admin-tier guidance for managing trivia games. Registered separately at the
 * `admin` role tier (see `index.ts`) so member sessions don't carry this prompt
 * baggage. Per the cascading config resolver, admin-tier instructions load only
 * for admin+ sessions.
 */
export const TRIVIA_GAMES_ADMIN_INSTRUCTION = `# Managing trivia games

This deployment supports multiple parallel trivia games — one per Slack channel that runs trivia. Each game has its own isolated data (questions, answers, cheats, seasons) under \`data/plugins/trivia/games/<name>/\` and its own pair of plugin-managed cron jobs (\`<name>:question\` and \`<name>:reveal\`). Add a new game and the plugin reconciles the cron jobs automatically on the next load.

**Lifecycle is config-driven**: games live in \`config.trivia.games[]\`. There are no \`create_game\` / \`delete_game\` MCP tools — admins edit the config (directly or via \`propose_config_update\`). Each entry has this shape:

\`\`\`json
{
  "name": "main",                       // unique, ^[a-z0-9-]+$, 1–32 chars
  "channel": "C0123456789",             // Slack channel ID where this game runs
  "questionCron": "0 9 * * 1-5",        // when the daily question posts
  "revealCron":   "0 17 * * 1-5",       // when the answer reveals
  "timezone": "America/Montreal",       // IANA tz for the cron expressions
  "enabled": true                       // optional; defaults to true
}
\`\`\`

When an admin asks to **create a new trivia game** (e.g. "set up trivia in #engineering"):

1. Ask for the channel ID, the post and reveal times, and the timezone (if not already specified). The two times must be on the same day(s); reveal MUST be later in the day than the post.
2. Pick a short kebab-case \`name\` from context (e.g. "engineering"). Confirm with the admin.
3. Call \`propose_config_update\` with a single \`set\` op against \`trivia.games\` that appends the new entry (or use it as appropriate per its API).
4. After approval, the plugin reconciles the new cron jobs automatically on next load. No tool call is needed to "install" the schedules.

When an admin asks to **disable a game temporarily** (e.g. "pause the engineering trivia"):

- Call \`propose_config_update\` to set \`trivia.games[<index>].enabled\` to \`false\`. Cron jobs disappear on next reconcile; the game's data directory is preserved (frozen archive — reads still work, writes refuse).

When an admin asks to **re-enable a disabled game**: same path, set \`enabled\` back to \`true\`.

When an admin asks to **remove a game entirely**: \`propose_config_update\` to delete the entry from \`trivia.games[]\`. The cron jobs disappear on next reconcile; the data directory stays put under \`data/plugins/trivia/games/<name>/\` until you delete it manually (no MCP tool deletes per-game data).

When an admin asks **which trivia games exist** or **what's running where**: call \`list_games\`. Pass \`includeDisabled: true\` to also surface paused games. The response includes \`name\`, \`channel\`, \`timezone\`, and \`enabled\` per game.

**The \`game\` slug is internal coordination metadata** — every trivia tool requires it as an argument, but you SHOULD NOT mention the slug to end users in user-facing posts unless an admin explicitly asks for it. In scheduled runs, the slug is baked into the prompt; in reactive (DM / mention / reaction) sessions, resolve it from the session's channel by matching against \`config.trivia.games[].channel\`. If no game matches the channel, refuse with "no trivia game is configured for this channel."
`;

const SEASONS_ADMIN_ADDENDUM = `
## Admin: managing seasons on the timeline

Seasons are enabled for this deployment. Seasons live on a single timeline (\`seasons.json\`) where each entry has a slug, startedAt, expectedEndAt, optional endedAt, and categories pool. "Current" is whichever entry's window contains \`now\`. No two seasons may overlap, but multiple future seasons can be queued simultaneously, refined as the date approaches, and even renamed (delete + re-create) while they're still in the future.

When an admin asks to **prepare a future season** (e.g. "set up next month's season as marine-biology"):

1. Derive a slug from \`trivia.seasons.prompt\` plus the date / admin intent.
2. Derive \`startedAt\` and \`expectedEndAt\` matching the prompt's cadence.
3. If the season has a clear theme, generate a list of ~20 themed categories for the theme and pass them as \`categories\`. The new season's pool will be EXACTLY that list (themed seasons are purely themed, not "baseline + a few themed"). If there is no clear theme, OMIT \`categories\` — the new season copies the \`categories.json\` baseline pool.
4. Call \`upsert_season(slug, { startedAt, expectedEndAt, categories? })\`. The overlap invariant ensures it slots cleanly into the timeline.

To **add categories to a season after it's been created** (themed or not), call \`add_categories(["..."], target: "<slug>")\`. To remove some, use \`remove_categories\` with the same target.

To **inspect the timeline** (see what seasons exist, their dates, and full category lists), call \`list_seasons\`. Each entry includes a \`status\` flag ("past" | "current" | "future"). Use this when an admin asks "what's queued for next month?" or "what categories does the marine season have?".

When an admin asks to **end the current season immediately** (cut it short):

- Call \`upsert_season(currentSlug, { endedAt: <now> })\`. The next-queued season (if any) takes over naturally as \`now\` crosses into its window.

When an admin asks to **edit a queued future season**:

- Use \`upsert_season(slug, { ... })\` to change dates, or \`add_categories(["..."], target: "<slug>")\` / \`remove_categories(["..."], target: "<slug>")\` to refine its pool.
- Use \`delete_season(slug)\` to retract a not-yet-started future season entirely (only allowed when its startedAt is still in the future).

When an admin asks to **rename a future season**:

- Slug is immutable. Call \`delete_season(oldSlug)\` then \`upsert_season(newSlug, ...)\`. Only valid while the season has not yet started.

## Admin: answer formats per season

Each season can also carry an optional \`answersFormat\` weight map (e.g. \`{ "boolean": 2, "choice": 1 }\` → roughly 2/3 true-false questions, 1/3 multiple-choice). When set, that map overrides the workspace-level \`config.trivia.answersFormat\` default for whichever season is current per \`findCurrentSeason\`. When absent, the workspace config (or pure-boolean fallback) is used.

When an admin asks to **set a season to only generate multiple-choice questions** (or only true-false, or a custom mix):

- Call \`upsert_season(slug, { answersFormat: { boolean: <w1>, choice: <w2> } })\`. At least one weight must be strictly positive. Mid-season mutation is permitted (unlike \`startedAt\`) — the next \`get_ideas\` call picks up the new mix.

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

The resolution cascade for each slot is: \`slot.* ?? season.* ?? config default\`. Empty slot \`{}\` is permitted and means "use season defaults for everything".

When an admin asks to **set up a format** (e.g. "3 general-knowledge true-false followed by 2 historical choice"):

- Call \`upsert_season(slug, { format: { questions: [<one entry per slot>] } })\`. Format is replaced wholesale on each call (no per-slot tools). On UPDATE, omitting \`format\` keeps the existing value; passing \`null\` clears it (back to single-question-per-fire behavior).

Soft guidance: aim for ≤ 10 slots per format. The system has no hard cap, but larger formats stress Claude's per-fire generation budget.

When an admin asks **what slots a season has**, look at the season entry returned by \`list_seasons\` and read \`format.questions[]\`.

## Admin: auto-rollover is now "repeat" semantics

When a season's last reveal fires AND no future season is queued, the trivia plugin creates a continuation season automatically. As of this change, the continuation INHERITS \`categories\`, \`answersFormat\`, \`questionType\`, \`contexts\`, AND \`format\` from the closing season (deep-copied; the old behavior of resetting \`categories\` to the global baseline is gone). The continuation slug is \`season-YYYY-MM\` for the next UTC month; \`expectedEndAt\` is end-of-that-month (this part is unchanged).

To **break the inheritance chain** — i.e. you want next month's season to look different from this one's — stage a future season explicitly via \`upsert_season(newSlug, { startedAt: <future>, expectedEndAt: ..., categories: [...], format?: {...} })\` BEFORE the current season's last fire. Staged future seasons are honored as-is; the inheritance rule only kicks in when there's nothing queued.
`;

export function getTriviaCheckInstruction(seasonsEnabled: boolean): string {
  return seasonsEnabled
    ? BASE_TRIVIA_CHECK_INSTRUCTION + SEASONS_ADMIN_ADDENDUM
    : BASE_TRIVIA_CHECK_INSTRUCTION;
}

/** Backward-compatible export for callers that don't yet know about seasons. */
export const TRIVIA_CHECK_INSTRUCTION = BASE_TRIVIA_CHECK_INSTRUCTION;
