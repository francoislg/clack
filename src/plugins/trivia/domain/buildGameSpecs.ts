import { CronExpressionParser } from "cron-parser";
import type { CronJobSpec } from "../../sdk.js";
import type { TriviaGame, OffDay } from "../core/configTypes.js";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import {
  SEND_QUESTIONS_INSTRUCTIONS,
  PREP_QUESTIONS_INSTRUCTIONS,
  POST_QUESTIONS_INSTRUCTIONS,
  buildProcessRevealInstructions,
} from "../prompts/scheduledPrompts.js";

// `WebSearch` is intentionally NOT in this list — it is a built-in Claude tool, globally
// enabled at session start in `src/claude/index.ts` (see `tools` array). Topical questions
// (`questionType: "topical"`) rely on it; the prompt instructs Claude to call it directly.
// NOTE: image-search tools are intentionally NOT listed here. They come from
// independently-installed external plugins; the visual-research subflow discovers
// whatever is available at runtime by tool description (not by a name convention).
// Adding them here would couple trivia's schedule to a specific image-search plugin being installed.
const QUESTION_REQUIRED_TOOLS = [
  "mcp__trivia__get_ideas",
  "mcp__trivia__find_previous_questions",
  "mcp__trivia__find_previous_subjects",
  "mcp__trivia__save_question",
  "mcp__trivia__post_questions",
];

/**
 * Prep-cron required-tools list. Notably EXCLUDES `post_questions` — the prep run must not
 * post a Slack message. Defense in depth: the cron spec is also channelless (no `channel`
 * field), which makes the SDK restrict `submit_response` to `{ skip_response: true }`.
 * Either restriction alone would suffice; both are present because the cost is zero and
 * the failure mode (accidental post from prep run) would be highly visible.
 */
const PREP_REQUIRED_TOOLS = [
  "mcp__trivia__get_ideas",
  "mcp__trivia__find_previous_questions",
  "mcp__trivia__find_previous_subjects",
  "mcp__trivia__save_question",
];

/**
 * Reveal required-tools list. `compute_answers` scores and returns the payload (+ `batchId`);
 * `update_answers_block` edits the question cards; `start_new_season` performs the idempotent
 * season rollover the prompt invokes only on the season's last fire (harmless when seasons are
 * off — the prompt simply never calls it).
 */
const REVEAL_REQUIRED_TOOLS = [
  "mcp__trivia__compute_answers",
  "mcp__trivia__update_answers_block",
  "mcp__trivia__start_new_season",
];

/**
 * Build the cron-job specs for a list of trivia games. Each game produces two or three specs:
 *
 * - When `game.prepCron` is ABSENT: two specs — `<name>:question` and `<name>:reveal`. The
 *   question cron uses the legacy `SEND_QUESTIONS_INSTRUCTIONS` prompt (gen + post in one
 *   run, observable behavior unchanged from before the prep/post split).
 * - When `game.prepCron` is SET: three specs — `<name>:prep`, `<name>:question`, `<name>:reveal`.
 *   The prep cron is channelless and gen-only (its `requiredTools` excludes `post_questions`);
 *   the question cron uses `POST_QUESTIONS_INSTRUCTIONS` which checks the staged pool first
 *   and falls back to inline-gen for any missing slot.
 *
 * The reveal spec's `requiredTools` is the same single-tool list regardless of `seasonsEnabled`
 * — seasons handling lives inside `process_reveal_answers`.
 *
 * Side effects: emits a logger warning when a game's `revealCron` would fire on the same day
 * but earlier than `questionCron`, AND a separate warning when `prepCron` would fire AFTER
 * `questionCron` on the next matching date.
 */
/**
 * Substitute every `{game}` placeholder in a prompt template with the named game.
 * Used to bake the game slug into the prompt at reconcile time so scheduled runs
 * pass `game: "<name>"` on every per-game tool call.
 */
function substituteGame(prompt: string, name: string): string {
  return prompt.replace(/\{game\}/g, name);
}

export function buildGameSpecs(games: TriviaGame[], offDays?: OffDay[]): CronJobSpec[] {
  const specs: CronJobSpec[] = [];
  const skipDates = offDays && offDays.length > 0 ? offDays : undefined;

  for (const game of games) {
    // `enabled` defaults to true when absent (parser shape) — skip only on explicit false.
    if (game.enabled === false) continue;

    warnIfRevealBeforeQuestion(game);
    if (game.prepCron !== undefined) warnIfPrepAfterQuestion(game);

    // Prep spec — only emitted when the game opts in via `prepCron`. Channelless (no
    // `channel` field) so the SDK locks `submit_response` to `{ skip_response: true }`,
    // AND `requiredTools` excludes `post_questions` so the tool is structurally
    // unavailable to Claude during the prep run. Either restriction would suffice;
    // both are present as defense in depth.
    if (game.prepCron !== undefined) {
      specs.push({
        specKey: `${game.name}:prep`,
        name: `Trivia: ${game.name} — prep`,
        cronExpression: game.prepCron,
        // Intentionally NO `channel` field — channelless cron.
        prompt: substituteGame(PREP_QUESTIONS_INSTRUCTIONS, game.name),
        timezone: game.timezone,
        requiredTools: PREP_REQUIRED_TOOLS,
        submitResponseMode: "skipped",
        attachedTopics: ["trivia"],
        ...(skipDates ? { skipDates } : {}),
      });
    }

    specs.push({
      specKey: `${game.name}:question`,
      name: `Trivia: ${game.name} — question`,
      cronExpression: game.questionCron,
      channel: game.channel,
      // Route to the new POST prompt when prep is configured; otherwise the legacy SEND
      // prompt. Games opting out of prep pay no overhead — no staged-pool query language,
      // no wasted `find_previous_questions` call at fire time.
      prompt: substituteGame(
        game.prepCron !== undefined ? POST_QUESTIONS_INSTRUCTIONS : SEND_QUESTIONS_INSTRUCTIONS,
        game.name,
      ),
      timezone: game.timezone,
      requiredTools: QUESTION_REQUIRED_TOOLS,
      // The question's actual deliverable is the `post_questions` tool — which posts the
      // Slack message and stamps the question record. `submit_response` here is purely a
      // run terminator; the "skipped" mode constrains its schema to `{ skip_response: true }`
      // so Claude cannot accidentally deliver a stray confirmation message.
      submitResponseMode: "skipped",
      // Pre-attach the `trivia` topic so persona / reveal-tone / finale-tone instruction
      // files load into the system prompt from turn 1. See `plugin-topic-instructions`.
      attachedTopics: ["trivia"],
      // Trivia is button-driven; keep auto-respond conservative so Clack doesn't chime into
      // chatter in the game thread.
      attentionLevel: "low",
      ...(skipDates ? { skipDates } : {}),
    });

    specs.push({
      specKey: `${game.name}:reveal`,
      name: `Trivia: ${game.name} — reveal`,
      cronExpression: game.revealCron,
      channel: game.channel,
      // Built per call (not a const) so its leaderboard/podium labels resolve to the
      // workspace language via the plugin translator wired at init. See
      // `buildProcessRevealInstructions`.
      prompt: substituteGame(buildProcessRevealInstructions(), game.name),
      timezone: game.timezone,
      requiredTools: REVEAL_REQUIRED_TOOLS,
      attachedTopics: ["trivia"],
      attentionLevel: "low",
      ...(skipDates ? { skipDates } : {}),
    });
  }

  return specs;
}

/**
 * For each cron expression, compute the next fire time (in the game's timezone). When the reveal's
 * next-fire falls on the same calendar date but earlier than the question's, log a warning. Only
 * checks the immediate next fire — a deeper analysis (every weekday over a month) would be more
 * exhaustive but typical misconfigurations show up on the first comparison.
 */
function warnIfRevealBeforeQuestion(game: TriviaGame): void {
  try {
    const q = CronExpressionParser.parse(game.questionCron, { tz: game.timezone }).next().toDate();
    const r = CronExpressionParser.parse(game.revealCron, { tz: game.timezone }).next().toDate();
    if (r < q) {
      logger.warn(
        `[plugin:trivia] game "${game.name}": revealCron ("${game.revealCron}") fires before questionCron ("${game.questionCron}") on the next matching date in ${game.timezone}. Schedules will still be created, but this is almost certainly a misconfiguration.`,
      );
    }
  } catch {
    // Cron parsing already validated at config-load time; if it fails here we silently skip the
    // warning — the bad spec will fail validation in reconcileCronJobs anyway.
  }
}

/**
 * Mirror of `warnIfRevealBeforeQuestion` for the prep/question relationship: the prep cron's
 * next fire MUST be earlier than the question cron's next fire — otherwise prep is generating
 * for a fire that's already passed. Only checks the immediate next fire for each cron in the
 * game's timezone; deeper analysis (every weekday over a month) would catch more but typical
 * misconfigurations show up on the first comparison.
 *
 * Called only when `game.prepCron` is set. The bad spec set is still emitted (the caller has
 * already pushed before this returns) — the warning is advisory, not blocking.
 */
function warnIfPrepAfterQuestion(game: TriviaGame): void {
  if (game.prepCron === undefined) return;
  try {
    const p = CronExpressionParser.parse(game.prepCron, { tz: game.timezone }).next().toDate();
    const q = CronExpressionParser.parse(game.questionCron, { tz: game.timezone }).next().toDate();
    if (p > q) {
      logger.warn(
        `[plugin:trivia] game "${game.name}": prepCron ("${game.prepCron}") fires AFTER questionCron ("${game.questionCron}") on the next matching date in ${game.timezone}. Pre-staging will not happen in time for the next question fire. Schedules will still be created, but this is almost certainly a misconfiguration.`,
      );
    }
  } catch {
    // Parser already validated at config-load time; silent skip on parse failure here.
  }
}
