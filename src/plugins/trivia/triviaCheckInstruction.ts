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

## Admin: question types per season

Each season can also carry an optional \`questionTypes\` weight map (e.g. \`{ "boolean": 2, "choice": 1 }\` → roughly 2/3 true-false questions, 1/3 multiple-choice). When set, that map overrides the workspace-level \`config.trivia.questionsTypes\` default for whichever season is current per \`findCurrentSeason\`. When absent, the workspace config (or pure-boolean fallback) is used.

When an admin asks to **set a season to only generate multiple-choice questions** (or only true-false, or a custom mix):

- Call \`upsert_season(slug, { questionTypes: { boolean: <w1>, choice: <w2> } })\`. At least one weight must be strictly positive. Mid-season mutation is permitted (unlike \`startedAt\`) — the next \`get_ideas\` call picks up the new mix.

When an admin asks to **clear a season's questionTypes** (let it fall back to the workspace default):

- Call \`upsert_season(slug, { questionTypes: null })\`.

Note: the choice-question option-count bounds live at \`config.trivia.choices.{min, max}\` and are workspace-wide — they cannot be overridden per season (purely a card-readability UX setting, not a gameplay parameter).
`;

export function getTriviaCheckInstruction(seasonsEnabled: boolean): string {
  return seasonsEnabled
    ? BASE_TRIVIA_CHECK_INSTRUCTION + SEASONS_ADMIN_ADDENDUM
    : BASE_TRIVIA_CHECK_INSTRUCTION;
}

/** Backward-compatible export for callers that don't yet know about seasons. */
export const TRIVIA_CHECK_INSTRUCTION = BASE_TRIVIA_CHECK_INSTRUCTION;
