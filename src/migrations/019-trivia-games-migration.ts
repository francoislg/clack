import type { Migration, StaticFileResult } from "./types.js";
import { logger } from "../logger.js";

/**
 * Combined trivia-games upgrade migration. Handles two transitions in one pass:
 *
 * 1. **Cron jobs → `config.trivia.games[]`.** Legacy dispatcher-style trivia cron
 *    jobs (matching `Call send_questions_instructions and follow` or
 *    `Call process_responses_instructions and follow`, with `plugin === "trivia"`)
 *    are paired by channel and rewritten as `legacy-<channel>` entries in
 *    `config.trivia.games[]`. The source jobs are deleted. Inline fat-prompt
 *    trivia jobs (neither dispatcher pattern) are left alone — operators decide.
 *
 * 2. **Flat-file trivia data → per-game directory.** Legacy
 *    `data/plugins/trivia/{questions,answers,cheats,seasons}.json` files are
 *    moved into `data/plugins/trivia/games/<target-name>/`. The target name is:
 *      a. The first newly-created `legacy-<channel>` entry from step 1, if any.
 *      b. Otherwise, the first pre-existing `config.trivia.games[]` entry.
 *      c. Otherwise, a fallback `initialgame` entry with placeholder cron
 *         expressions and `enabled: false`. The operator renames + enables.
 *
 *    During the move, `questions.json` is rewritten to stamp `processedAt =
 *    postedAt` on every entry that has `postedAt` set but no `processedAt`. This
 *    back-fills the new `processedAt` marker on legacy questions so the
 *    `process_reveal_answers` tool's default mode doesn't treat already-revealed
 *    questions as pending. Entries with no `postedAt` (never posted to Slack)
 *    are left untouched. Other moved files (answers, cheats, seasons) are
 *    copied byte-for-byte.
 *
 * Idempotent: once any per-game data file exists under `games/<name>/`, the
 * data-move step is a no-op. Once the dispatcher cron jobs are gone, step 1 is
 * a no-op.
 */

interface CronRun {
  executedAt: string;
  status: "success" | "error" | "skipped";
  responseTs?: string;
  replayOf?: string;
}

interface CronJob {
  id: string;
  cronExpression: string;
  channel: string;
  prompt: string;
  createdBy: string;
  createdAt: string;
  enabled: boolean;
  timezone: string;
  plugin?: string;
  pluginManaged?: boolean;
  specKey?: string;
  requiredTools?: string[];
  skipConditions?: string;
  oneShot?: boolean;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error" | "skipped";
  runs?: CronRun[];
}

interface CronJobsFile {
  jobs?: CronJob[];
}

interface TriviaGameRecord {
  name: string;
  channel: string;
  questionCron: string;
  revealCron: string;
  timezone: string;
  enabled?: boolean;
}

interface ConfigShape {
  trivia?: {
    games?: TriviaGameRecord[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

const QUESTION_DISPATCHER_RE = /Call\s+send_questions_instructions\s+and\s+follow/i;
const REVEAL_DISPATCHER_RE = /Call\s+process_responses_instructions\s+and\s+follow/i;

/**
 * Migration-local shape: a question row may have any number of extra fields
 * we don't care about; we only read/write `postedAt` and `processedAt`.
 */
interface QuestionRowWithTimestamps {
  postedAt?: number;
  processedAt?: number;
  [key: string]: number | string | boolean | string[] | undefined;
}

function hasPostedAtNumber(
  value: unknown,
): value is QuestionRowWithTimestamps & { postedAt: number } {
  if (typeof value !== "object" || value === null) return false;
  if (!("postedAt" in value)) return false;
  const candidate: { postedAt: unknown } = value as { postedAt: unknown };
  return typeof candidate.postedAt === "number";
}

function hasProcessedAtNumber(value: object): boolean {
  if (!("processedAt" in value)) return false;
  const candidate: { processedAt: unknown } = value as { processedAt: unknown };
  return typeof candidate.processedAt === "number";
}

/**
 * Stamp `processedAt = postedAt` on every entry that has `postedAt` set but no
 * `processedAt`. Pure function; returns the new content string. Unknown extra
 * fields on each entry are preserved.
 */
function backfillProcessedAt(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Malformed — return the original bytes unchanged. The operator deals with it later.
    return content;
  }
  if (!Array.isArray(parsed)) return content;
  let mutated = false;
  const out = parsed.map((entry: unknown) => {
    if (!hasPostedAtNumber(entry)) return entry;
    if (hasProcessedAtNumber(entry)) return entry;
    mutated = true;
    return { ...entry, processedAt: entry.postedAt };
  });
  if (!mutated) return content;
  return JSON.stringify(out, null, 2) + (content.endsWith("\n") ? "\n" : "");
}

const FALLBACK_GAME_NAME = "initialgame";
const PLUGIN_TRIVIA = "data/plugins/trivia";
const FLAT_FILES = ["questions.json", "answers.json", "cheats.json", "seasons.json"] as const;
const CONFIG_PATH = "data/config.json";
const JOBS_PATH = "data/state/cron-jobs.json";

function classify(job: CronJob): "question" | "reveal" | null {
  if (job.plugin !== "trivia") return null;
  if (QUESTION_DISPATCHER_RE.test(job.prompt)) return "question";
  if (REVEAL_DISPATCHER_RE.test(job.prompt)) return "reveal";
  return null;
}

/** Derive a `name` that is unique within the in-progress games[]. */
function deriveName(channel: string, taken: Set<string>): string {
  const base = `legacy-${channel}`.toLowerCase();
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `legacy-${channel}-${Date.now()}`;
}

/**
 * Fallback entry used only when no schedule exists to inherit from AND there
 * are no pre-existing `config.trivia.games[]` entries to host the legacy data.
 * Operators rename, fill in real values, and set `enabled: true`.
 */
function fallbackInitialGameEntry(): TriviaGameRecord {
  return {
    name: FALLBACK_GAME_NAME,
    channel: "C000000000",
    questionCron: "0 0 * * 0",
    revealCron: "0 0 * * 0",
    timezone: "UTC",
    enabled: false,
  };
}

export const migration: Migration = {
  version: 19,
  name: "Migrate legacy trivia cron jobs + flat data to declarative games model",
  priority: "blocking",
  files: [
    JOBS_PATH,
    CONFIG_PATH,
    `${PLUGIN_TRIVIA}/questions.json`,
    `${PLUGIN_TRIVIA}/answers.json`,
    `${PLUGIN_TRIVIA}/cheats.json`,
    `${PLUGIN_TRIVIA}/seasons.json`,
    `${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/questions.json`,
    `${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/answers.json`,
    `${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/cheats.json`,
    `${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/seasons.json`,
  ],
  static: (files) => {
    const result: Record<string, StaticFileResult> = {};

    const jobsRaw = files[JOBS_PATH];
    const configRaw = files[CONFIG_PATH];

    if (configRaw === null) {
      // No config file — nothing safe to do. The bot will recreate it on first
      // save; refusing to write keeps things conservative.
      return result;
    }

    let config: ConfigShape;
    try {
      config = JSON.parse(configRaw);
    } catch (err) {
      logger.warn(
        `[migration 019] Skipping trivia migration: malformed config.json (${err instanceof Error ? err.message : String(err)}). Admin intervention required.`,
      );
      return result;
    }

    config.trivia = config.trivia ?? {};
    const existingGames = Array.isArray(config.trivia.games) ? config.trivia.games : [];
    const takenNames = new Set(existingGames.map((g) => g.name));
    const takenChannels = new Set(existingGames.map((g) => g.channel));

    // ── Step 1: Cron jobs → games[] ────────────────────────────────────────
    let jobsFile: CronJobsFile = {};
    if (jobsRaw !== null) {
      try {
        jobsFile = JSON.parse(jobsRaw);
      } catch (err) {
        logger.warn(
          `[migration 019] Skipping cron-jobs migration step: malformed cron-jobs.json (${err instanceof Error ? err.message : String(err)}). Continuing with data migration.`,
        );
        jobsFile = {};
      }
    }
    const jobs = jobsFile.jobs ?? [];

    type Pair = { question?: CronJob; reveal?: CronJob };
    const byChannel = new Map<string, Pair>();
    for (const job of jobs) {
      const kind = classify(job);
      if (!kind) continue;
      const pair = byChannel.get(job.channel) ?? {};
      pair[kind] = job;
      byChannel.set(job.channel, pair);
    }

    const newGames: TriviaGameRecord[] = [];
    const consumedJobIds = new Set<string>();

    for (const [channel, pair] of byChannel.entries()) {
      if (takenChannels.has(channel)) {
        // Operator already has a games[] entry for this channel — don't double-migrate;
        // just consume (delete) the legacy jobs.
        if (pair.question) consumedJobIds.add(pair.question.id);
        if (pair.reveal) consumedJobIds.add(pair.reveal.id);
        continue;
      }
      if (!pair.question || !pair.reveal) {
        // Unpaired — leave the lone job alone.
        continue;
      }
      const name = deriveName(channel, takenNames);
      takenNames.add(name);
      takenChannels.add(channel);
      newGames.push({
        name,
        channel,
        questionCron: pair.question.cronExpression,
        revealCron: pair.reveal.cronExpression,
        timezone: pair.question.timezone || pair.reveal.timezone || "UTC",
      });
      consumedJobIds.add(pair.question.id);
      consumedJobIds.add(pair.reveal.id);
    }

    // ── Step 2: Flat data → per-game directory ─────────────────────────────
    // The directory is determined AFTER step 1 so newly-created legacy entries
    // can be inheritance targets.
    const dataAlreadyMigrated = FLAT_FILES.some(
      (file) => files[`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/${file}`] !== null,
    );
    const flatPresent = FLAT_FILES.some((file) => files[`${PLUGIN_TRIVIA}/${file}`] !== null);

    const movedFiles: Record<string, StaticFileResult> = {};
    let dataTargetName: string | null = null;

    if (flatPresent && !dataAlreadyMigrated) {
      // Inheritance order: new legacy → pre-existing → fallback initialgame.
      if (newGames.length > 0) {
        dataTargetName = newGames[0].name;
      } else if (existingGames.length > 0) {
        dataTargetName = existingGames[0].name;
      } else {
        // No schedule anywhere — fall back to `initialgame` with placeholders.
        const fallback = fallbackInitialGameEntry();
        newGames.push(fallback);
        takenNames.add(fallback.name);
        dataTargetName = fallback.name;
      }

      for (const file of FLAT_FILES) {
        const srcPath = `${PLUGIN_TRIVIA}/${file}`;
        const dstPath = `${PLUGIN_TRIVIA}/games/${dataTargetName}/${file}`;
        const content = files[srcPath];
        if (content === null) continue;
        // For questions.json, back-fill processedAt = postedAt during the move so legacy
        // already-revealed questions aren't picked up as pending by process_reveal_answers.
        movedFiles[dstPath] = file === "questions.json" ? backfillProcessedAt(content) : content;
        movedFiles[srcPath] = { delete: true };
      }
    }

    // ── Commit results ─────────────────────────────────────────────────────
    if (newGames.length > 0) {
      config.trivia.games = [...existingGames, ...newGames];
      result[CONFIG_PATH] = JSON.stringify(config, null, 2) + "\n";
    }

    if (consumedJobIds.size > 0) {
      jobsFile.jobs = jobs.filter((j) => !consumedJobIds.has(j.id));
      result[JOBS_PATH] = JSON.stringify(jobsFile, null, 2) + "\n";
    }

    for (const [path, content] of Object.entries(movedFiles)) {
      result[path] = content;
    }

    if (dataTargetName !== null) {
      logger.info(`[migration 019] Moved legacy trivia data into games/${dataTargetName}/.`);
    }

    return result;
  },
};
