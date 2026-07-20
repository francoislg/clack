import { CronExpressionParser } from "cron-parser";
import type { CronJobSpec } from "../../../plugins-sdk/sdk.js";
import type { TriviaGame, OffDay } from "../core/configTypes.js";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import {
  SEND_QUESTIONS_INSTRUCTIONS,
  PREP_QUESTIONS_INSTRUCTIONS,
  POST_QUESTIONS_INSTRUCTIONS,
  LOCK_QUESTIONS_INSTRUCTIONS,
  buildProcessRevealInstructions,
} from "../prompts/scheduledPrompts.js";

// `WebSearch` is intentionally NOT in this list — it is a built-in Claude tool, globally
// enabled at session start in `src/claude/index.ts` (see `tools` array). Topical questions
// (`questionType: "topical"`) rely on it; the prompt instructs Claude to call it directly.
// NOTE: image-search tools are intentionally NOT listed here. They come from
// independently-installed external plugins; the visual-research subflow discovers
// whatever is available at runtime by tool description (not by a name convention).
// Adding them here would couple trivia's schedule to a specific image-search plugin being installed.
// The `requiredTools` gate refuses `submit_response` until EVERY listed tool is called, so a list
// may name ONLY tools called on 100% of valid runs — never a generation-conditional one. For the
// question cron, `get_ideas` opens every generation flow. `find_previous_questions` (skipped by
// prediction generation), `find_previous_subjects` (image subflow only), and `save_question`
// (skipped when a slot is served from the staged pool) are NOT guaranteed and are excluded.
const QUESTION_BASE_REQUIRED_TOOLS = ["mcp__trivia__get_ideas"];

// `post_questions` is the guaranteed deliverable for a NON-flexible game (≥1 question always
// posted), so the gate keeps it. A flexible game may legitimately post zero questions on a fire,
// and `post_questions`'s schema rejects an empty `items` — requiring it would deadlock that skip.
// Resolved per game at spec-build time from the game's own `format.flexible`. A SEASON-imposed
// flexible format is invisible here (`buildGameSpecs` is season-independent), so such games keep
// `post_questions` required — a documented residual gap.
function questionRequiredTools(game: TriviaGame): string[] {
  const tools = [...QUESTION_BASE_REQUIRED_TOOLS];
  if (game.format?.flexible !== true) tools.push("mcp__trivia__post_questions");
  return tools;
}

/**
 * Prep-cron required-tools list. EXCLUDES `post_questions` — the prep run must not post a Slack
 * message (defense in depth: the cron spec is also channelless, which makes the SDK restrict
 * `submit_response` to `{ skip_response: true }`). Also EXCLUDES `save_question` and
 * `find_previous_subjects` for the same reason as the question list: a prep fire whose pool is
 * already full correctly NO-OPs (zero `save_question` calls), and `find_previous_subjects` only
 * fires in the image subflow — gating on either would deadlock those runs. Only the always-run
 * discovery calls remain.
 */
const PREP_REQUIRED_TOOLS = ["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions"];

/**
 * Lock-cron required-tools list — the single tool `lock_questions`. Like the prep spec,
 * the lock spec is channelless (so `submit_response` is locked to `{ skip_response: true }`)
 * AND deliberately excludes `post_questions`: locking only edits existing cards, it must
 * never deliver a new message. Either restriction alone would suffice; both are present.
 */
const LOCK_REQUIRED_TOOLS = ["mcp__trivia__lock_questions"];

// Reveal required-tools list. `compute_answers` is the ONLY tool called on every reveal — it
// scores and returns the payload even on an empty batch (`reveals: []`). `settle_question`
// (predictions only), `refresh_question_cards` (skipped on an empty batch), `end_season`
// (round's final fire only), and `set_reveal_narrative` (`includeRevealInQuestions: "yes"` only) are
// each conditional; gating on them force-calls a mutating tool with fabricated args on the runs
// where they don't apply (observed in production), so they are excluded.
const REVEAL_REQUIRED_TOOLS = ["mcp__trivia__compute_answers"];

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
      requiredTools: questionRequiredTools(game),
      // The question's actual deliverable is the `post_questions` tool — which posts the
      // Slack message and stamps the question record. `submit_response` here is purely a
      // run terminator; the "skipped" mode constrains its schema to `{ skip_response: true }`
      // so Claude cannot accidentally deliver a stray confirmation message.
      submitResponseMode: "skipped",
      // Pre-attach the `trivia` topic so persona / reveal-tone / finale-tone instruction
      // files load into the system prompt from turn 1. See `plugin-topic-instructions`.
      // `response-rendering` because this fire composes Claude-authored Block Kit.
      attachedTopics: ["trivia", "response-rendering"],
      // Trivia is button-driven; keep auto-respond conservative so Clack doesn't chime into
      // chatter in the game thread.
      attentionLevel: "low",
      ...(skipDates ? { skipDates } : {}),
    });

    // Lock spec — only emitted when the game opts in via `lockCron`. Channelless
    // (no `channel` field) so the SDK locks `submit_response` to `{ skip_response: true }`,
    // AND `requiredTools` is just `lock_questions` (no `post_questions`) — locking edits
    // existing cards via chat.update and must never post a new message.
    if (game.lockCron !== undefined) {
      specs.push({
        specKey: `${game.name}:lock`,
        name: `Trivia: ${game.name} — lock`,
        cronExpression: game.lockCron,
        // Intentionally NO `channel` field — channelless cron.
        prompt: substituteGame(LOCK_QUESTIONS_INSTRUCTIONS, game.name),
        timezone: game.timezone,
        requiredTools: LOCK_REQUIRED_TOOLS,
        submitResponseMode: "skipped",
        attachedTopics: ["trivia"],
        ...(skipDates ? { skipDates } : {}),
      });
    }

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
      // `response-rendering` because the reveal posts a rich Claude-authored message.
      attachedTopics: ["trivia", "response-rendering"],
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
