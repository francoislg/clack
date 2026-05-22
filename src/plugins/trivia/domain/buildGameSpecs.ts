import { CronExpressionParser } from "cron-parser";
import type { CronJobSpec } from "../../sdk.js";
import type { TriviaGame, OffDay } from "../../../config.js";
import { logger } from "../../../logger.js";
import {
  SEND_QUESTIONS_INSTRUCTIONS,
  PROCESS_REVEAL_INSTRUCTIONS,
} from "../prompts/scheduledPrompts.js";

// `WebSearch` is intentionally NOT in this list — it is a built-in Claude tool, globally
// enabled at session start in `src/claude/index.ts` (see `tools` array). Topical questions
// (`questionType: "topical"`) rely on it; the prompt instructs Claude to call it directly.
const QUESTION_REQUIRED_TOOLS = [
  "mcp__trivia__get_ideas",
  "mcp__trivia__find_previous_questions",
  "mcp__trivia__save_question",
  "mcp__trivia__post_questions",
];

/**
 * Single-tool reveal required-tools list. `process_reveal_answers` absorbs every deterministic
 * step the previous orchestration enumerated; seasons-specific behavior is driven by the
 * payload's `seasonStatus` field, not by adding more required tools.
 */
const REVEAL_REQUIRED_TOOLS = ["mcp__trivia__process_reveal_answers"];

/**
 * Build the cron-job specs for a list of trivia games. Each game produces exactly two specs:
 * `<name>:question` and `<name>:reveal`. The reveal spec's `requiredTools` is the same
 * single-tool list regardless of `seasonsEnabled` — seasons handling lives inside
 * `process_reveal_answers`.
 *
 * Side effect: emits a logger warning when a game's `revealCron` would fire on the same day
 * but earlier than `questionCron` for any matching day-of-week.
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

    specs.push({
      specKey: `${game.name}:question`,
      name: `Trivia: ${game.name} — question`,
      cronExpression: game.questionCron,
      channel: game.channel,
      prompt: substituteGame(SEND_QUESTIONS_INSTRUCTIONS, game.name),
      timezone: game.timezone,
      requiredTools: QUESTION_REQUIRED_TOOLS,
      // The question's actual deliverable is the `post_questions` tool — which posts the
      // Slack message and stamps the question record. `submit_response` here is purely a
      // run terminator; the "skipped" mode constrains its schema to `{ skip_response: true }`
      // so Claude cannot accidentally deliver a stray confirmation message.
      submitResponseMode: "skipped",
      ...(skipDates ? { skipDates } : {}),
    });

    specs.push({
      specKey: `${game.name}:reveal`,
      name: `Trivia: ${game.name} — reveal`,
      cronExpression: game.revealCron,
      channel: game.channel,
      prompt: substituteGame(PROCESS_REVEAL_INSTRUCTIONS, game.name),
      timezone: game.timezone,
      requiredTools: REVEAL_REQUIRED_TOOLS,
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
