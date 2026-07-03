import { CronExpressionParser } from "cron-parser";
import type { ClackSdk } from "../sdk.js";
import type { TriviaGame } from "./core/configTypes.js";

/** Minimum answering time players must have left for a caught-up question to be worth posting. */
const QUESTION_RECOVERY_MARGIN_MS = 2 * 60 * 60 * 1000;

/**
 * Register the trivia delayed-boot handler: after every boot (post settle delay), walk each
 * enabled game and recover cron fires missed while the process was down. Per game the order
 * is lock → reveal → question — the round's chronology — with each fire awaited so the
 * reveal observes the locked state and a caught-up question never lands mid-reveal. Games
 * run one at a time, bounding concurrent Claude sessions to one. `:prep` is never caught up
 * (the question prompt falls back to inline generation).
 */
export function installCatchUp(
  sdk: ClackSdk,
  getGames: () => TriviaGame[],
  now: () => Date = () => new Date(),
): void {
  sdk.onDelayedBoot(async () => {
    for (const game of getGames()) {
      if (game.enabled === false) continue;
      await catchUpGame(sdk, game, now());
    }
  });
}

async function catchUpGame(sdk: ClackSdk, game: TriviaGame, now: Date): Promise<void> {
  if (game.lockCron !== undefined) {
    await runStep(sdk, `${game.name}:lock`, () => fireIfMissed(sdk, `${game.name}:lock`));
  }
  await runStep(sdk, `${game.name}:reveal`, () => fireIfMissed(sdk, `${game.name}:reveal`));
  await runStep(sdk, `${game.name}:question`, () => catchUpQuestion(sdk, game, now));
}

/** Isolate one pipeline step: a failing fire is logged and the pipeline moves on. */
async function runStep(sdk: ClackSdk, label: string, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    sdk.logger.error(`catch-up: step ${label} failed:`, error);
  }
}

/**
 * Lock and reveal fires need no guards beyond "was missed": locking is harmless when
 * nothing is open, and the reveal's empty-batch branch silently skips when no question
 * was posted.
 */
async function fireIfMissed(sdk: ClackSdk, specKey: string): Promise<void> {
  const { lastExpectedRuns } = await sdk.missedRuns(specKey);
  if (lastExpectedRuns.length === 0) return;
  sdk.logger.info(`catch-up: firing missed ${specKey} (${lastExpectedRuns.length} missed slot(s))`);
  await sdk.runCronJobNow(specKey);
}

/**
 * A missed question fires only when catch-up is meaningful: (a) no upcoming regular
 * question fire covers the current round (the next question occurrence is AFTER the next
 * lock/reveal deadline), and (b) players still get at least the recovery margin before
 * that deadline. Otherwise the day is skipped — never backfilled — and the owner is DMed.
 * At most ONE catch-up question fires per game per boot regardless of gap length.
 */
async function catchUpQuestion(sdk: ClackSdk, game: TriviaGame, now: Date): Promise<void> {
  const specKey = `${game.name}:question`;
  const { lastExpectedRuns } = await sdk.missedRuns(specKey);
  if (lastExpectedRuns.length === 0) return;

  let deadline: Date;
  let nextQuestion: Date;
  try {
    const deadlineCron = game.lockCron ?? game.revealCron;
    deadline = CronExpressionParser.parse(deadlineCron, { currentDate: now, tz: game.timezone })
      .next()
      .toDate();
    nextQuestion = CronExpressionParser.parse(game.questionCron, {
      currentDate: now,
      tz: game.timezone,
    })
      .next()
      .toDate();
  } catch (error) {
    sdk.logger.error(
      `catch-up: game "${game.name}" has an unparseable cron — skipping question catch-up`,
      error,
    );
    return;
  }

  const nextFireCoversIt = nextQuestion.getTime() <= deadline.getTime();
  const tooCloseToDeadline = now.getTime() + QUESTION_RECOVERY_MARGIN_MS > deadline.getTime();

  if (!nextFireCoversIt && !tooCloseToDeadline) {
    sdk.logger.info(`catch-up: firing missed ${specKey} (recovery window open)`);
    await sdk.runCronJobNow(specKey);
    return;
  }

  const reason = nextFireCoversIt ? "next regular fire covers the round" : "too close to deadline";
  sdk.logger.info(`catch-up: skipping missed ${specKey} (${reason}) — notifying owner`);
  const dmResult = await sdk.dmOwner(
    sdk.t("catchup.quiz_lost", {
      game: game.name,
      dates: formatDatesInTimezone(lastExpectedRuns, game.timezone),
    }),
  );
  if (!dmResult.ok) {
    sdk.logger.error(`catch-up: failed to notify owner about lost ${specKey}: ${dmResult.error}`);
  }
}

function formatDatesInTimezone(dates: Date[], timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return [...new Set(dates.map((d) => formatter.format(d)))].join(", ");
}
