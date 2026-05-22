import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { loadJobs, type CronJob } from "../../../../cronJobs.js";
import { logger } from "../../../../logger.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { computeLeaderboard } from "../../domain/computeLeaderboard.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { findTriviaRevealJob, nextFireAfter } from "../../domain/seasonStatus.js";
import {
  parseTsFromPermalink,
  parseChannelFromPermalink,
  fetchMessageReactions as fetchMessageReactionsImpl,
  fetchBotUserId as fetchBotUserIdImpl,
} from "./slack.js";
import { cleanReactionLists, categorizeBoolean, categorizeChoice } from "./categorize.js";
import { pickSeasonMvp, applySeasonRollover } from "./rollover.js";
import { computeRoundSummary } from "./roundSummary.js";
import {
  buildJudgePrompt,
  parseJudgeResponse,
  DEFAULT_JUDGE_MODEL,
  type JudgeQuestionGroup,
  type JudgeVerdict,
} from "../../freeform/judge.js";
import type { ClackSdk } from "../../../sdk.js";
import type {
  TriviaDataLayer,
  TriviaQuestion,
  SubmittedAnswer,
  TriviaUser,
} from "../../core/types.js";
import type {
  ProcessRevealEntry,
  ProcessRevealResult,
  RevealAnswer,
  SeasonStatusOut,
  SlackReactionLike,
  VoterBuckets,
} from "./types.js";

const REVEAL_INSTRUCTION_NAME = "process_responses_instructions";

const DESCRIPTION = `Process the trivia reveal for a game in one call: fetch the question's Slack message, exclude the bot + flagged cheaters + (for choice questions) multi-react voters, categorize the remaining voters, persist their scored answers, return the leaderboard, and (when seasons are enabled) the season status. Replaces the previous orchestration that called fetch_channel_messages, find_previous_questions, get_question_history, submit_answers, retrieve_scores, and (with seasons) check_season_status as separate steps.

DEFAULT BEHAVIOR (\`reprocessQuestionIds\` absent or empty): processes EVERY question in the OLDEST pending BATCH, where batches are groups of questions sharing the same \`batchId\` (stamped by \`post_questions\` per call; one cron-fire batch = one shared id). Questions with an undefined \`batchId\` (legacy rows) are each treated as their own singleton batch. The oldest batch is the one whose smallest \`postedAt\` is earliest; ties broken by lexicographic comparison of the group key. Stamps \`processedAt\` on each processed question before returning. Other pending batches stay pending — they drain one batch per fire on subsequent reveal runs. If no question is pending, returns \`reveals: []\` and a current leaderboard.

REPROCESS MODE (\`reprocessQuestionIds\` non-empty — DESTRUCTIVE): for EACH listed questionId, hard-deletes the prior \`SubmittedAnswer\` rows for that question, then re-derives scoring from the CURRENT Slack reactions and the CURRENT cheats list (which may now include cheaters flagged after the original reveal). Stamps \`processedAt\` (overwriting prior values). Does NOT pick up unrelated pending questions in this mode.

PAYLOAD SHAPE (renderer contract):
- \`reveals: Array<{ questionId, statement, category, emojis, messageLink, wasReprocessed, answer, voters }>\`
  - \`answer\`: \`{ type: "boolean", isTrue }\` for boolean questions; \`{ type: "choice", choices, correctIndex }\` for choice.
  - \`voters.correct\`, \`voters.incorrect\`, \`voters.fenceSitters\` (boolean only — \`[]\` for choice), \`voters.wildcards\` (each carries the \`emoji\` they reacted with so the renderer can riff on it).
- \`leaderboard\`: same shape as retrieve_scores' return.
- \`seasonStatus\` (only when seasons enabled): \`{ currentSlug, isLastFireOfSeason, seasonClosed, newSeasonStarted?, mvp? }\`. When \`isLastFireOfSeason\` is true, the tool ALREADY stamped \`endedAt\` on the closing season and (when no continuation was queued) created a new starter season before returning — the renderer SHALL NOT call \`upsert_season\`.

The renderer's job is two-step: (a) call this tool, (b) render the returned payload using submit_response with the Game Show Presenter voice.`;

/**
 * Slack-touching seam. Production wraps the real Slack WebClient via the plugin SDK;
 * tests pass a fake (no need to construct a full `App["client"]`).
 *
 * `isAvailable()` returns null on success or a user-facing error message when Slack is
 * disconnected — used by the tool to short-circuit before processing.
 * `fetchBotUserId()` returns `""` when unknown (tool falls back to no bot exclusion).
 * `fetchMessageReactions(channel, ts)` returns normalized reactions for the named message.
 */
export interface RevealSlackDeps {
  isAvailable(): string | null;
  fetchBotUserId(): Promise<string>;
  fetchMessageReactions(channel: string, ts: string): Promise<SlackReactionLike[]>;
}

const SLACK_UNAVAILABLE_ERROR =
  "Slack client is not available. The bot's Socket Mode session must be connected for process_reveal_answers to fetch message reactions.";

/** Build the production `RevealSlackDeps` by lazily resolving the Slack client from the SDK. */
export function defaultRevealSlackDeps(sdk: Pick<ClackSdk, "getSlackClient">): RevealSlackDeps {
  return {
    isAvailable() {
      return sdk.getSlackClient() === null ? SLACK_UNAVAILABLE_ERROR : null;
    },
    async fetchBotUserId() {
      const client = sdk.getSlackClient();
      if (!client) return "";
      return fetchBotUserIdImpl(client);
    },
    async fetchMessageReactions(channel, ts) {
      const client = sdk.getSlackClient();
      if (!client) throw new Error("Slack client became unavailable mid-run");
      return fetchMessageReactionsImpl(client, channel, ts);
    },
  };
}

export function createProcessRevealAnswersTool(
  data: TriviaDataLayer,
  sdk: Pick<ClackSdk, "getSlackClient" | "askClaude">,
  getGamesFn: GetGamesFn = defaultGetGames,
  jobsLoader: () => Promise<CronJob[]> = loadJobs,
  slackDeps: RevealSlackDeps = defaultRevealSlackDeps(sdk),
) {
  return tool(
    "process_reveal_answers",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). All reads and writes are scoped to this game's directory.",
        ),
      reprocessQuestionIds: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of questionIds to forcibly reprocess. DESTRUCTIVE: existing SubmittedAnswer rows for each ID are hard-deleted before re-derivation from the current Slack reactions and cheater list. Only these IDs are processed in this mode (does NOT also pick up other pending questions). Leave empty/absent for the default mode (process the oldest unprocessed question).",
        ),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const unavailable = slackDeps.isAvailable();
      if (unavailable !== null) {
        return errorResult(unavailable);
      }

      const scoped = data.forGame(args.game);
      const reprocessIds = args.reprocessQuestionIds ?? [];
      const isReprocessMode = reprocessIds.length > 0;
      const now = Date.now();

      const allQuestions = await scoped.loadQuestions();
      const perIdErrors: Array<{ questionId: string; error: string }> = [];

      // ── Question selection ──────────────────────────────────────────────
      const targets: TriviaQuestion[] = isReprocessMode
        ? selectReprocessTargets(allQuestions, reprocessIds, perIdErrors)
        : selectOldestPendingBatch(allQuestions);

      // ── Bot user ID (singleton per session, fetch once) ─────────────────
      let botUserId = "";
      try {
        botUserId = await slackDeps.fetchBotUserId();
      } catch (err) {
        logger.warn(
          `process_reveal_answers: failed to resolve bot user ID, proceeding without bot exclusion: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // ── Process each target ─────────────────────────────────────────────
      const users = await data.loadUsers();

      // Split freeform targets out: they go through the inline Haiku judge
      // (no Slack reactions to read). Boolean/choice questions stay on the
      // reaction-based path. Reprocess mode is explicitly rejected for freeform
      // — there's no public reactions source to re-derive from.
      const freeformTargets: TriviaQuestion[] = [];
      const reactionTargets: TriviaQuestion[] = [];
      for (const q of targets) {
        if ((q.answersFormat ?? "boolean") === "freeform") {
          if (isReprocessMode) {
            perIdErrors.push({
              questionId: q.id,
              error:
                "reprocess mode is not supported for freeform questions (no reactions to re-derive from)",
            });
            continue;
          }
          freeformTargets.push(q);
        } else {
          reactionTargets.push(q);
        }
      }

      // Resolve both paths into a map keyed by questionId, then re-assemble the
      // `reveals` array in the ORIGINAL `targets` order so the renderer sees
      // questions in the same chronological order they were posted (matters most
      // for multi-slot mixed-format batches).
      const entriesById = new Map<string, ProcessRevealEntry>();

      for (const question of reactionTargets) {
        const entry = await processOneTarget({
          question,
          isReprocessMode,
          now,
          botUserId,
          users,
          scoped,
          data,
          slackDeps,
          perIdErrors,
        });
        if (entry !== null) entriesById.set(question.id, entry);
      }

      if (freeformTargets.length > 0) {
        const freeformEntries = await processFreeformTargets({
          questions: freeformTargets,
          now,
          users,
          scoped,
          sdk,
          perIdErrors,
        });
        for (const entry of freeformEntries) entriesById.set(entry.questionId, entry);
      }

      const reveals: ProcessRevealEntry[] = [];
      for (const target of targets) {
        const entry = entriesById.get(target.id);
        if (entry !== undefined) reveals.push(entry);
      }

      // ── Leaderboard ─────────────────────────────────────────────────────
      const refreshedAnswers = await scoped.loadAnswers();
      const refreshedUsers = await data.loadUsers();
      const currentSlugForBoard = await scoped.getCurrentSeasonSlug();
      const seasonsEnabled = currentSlugForBoard !== null;

      const { leaderboard } = computeLeaderboard(refreshedAnswers, refreshedUsers, {
        sortBy: "totalCorrect",
        primaryFilterSeason: seasonsEnabled ? currentSlugForBoard : null,
        currentSeasonSlug: currentSlugForBoard,
      });

      // ── Season status + rollover ────────────────────────────────────────
      let seasonStatus: SeasonStatusOut | undefined;
      if (seasonsEnabled && currentSlugForBoard !== null) {
        seasonStatus = await computeSeasonStatusAndRollover({
          game: args.game,
          now,
          scoped,
          leaderboard,
          allAnswers: refreshedAnswers,
          jobsLoader,
        });
      }

      const result: ProcessRevealResult = {
        game: args.game,
        reveals,
        leaderboard,
        roundSummary: computeRoundSummary(reveals),
        ...(seasonStatus ? { seasonStatus } : {}),
        ...(perIdErrors.length > 0 ? { errors: perIdErrors } : {}),
      };
      return textResult(result);
    },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Internal orchestration helpers
// ────────────────────────────────────────────────────────────────────────────

function selectOldestPendingBatch(questions: TriviaQuestion[]): TriviaQuestion[] {
  const pending = questions.filter((q) => q.postedAt !== undefined && q.processedAt === undefined);
  if (pending.length === 0) return [];

  const groups = new Map<
    string,
    { key: string; minPostedAt: number; questions: TriviaQuestion[] }
  >();
  for (const q of pending) {
    const key = q.batchId ?? `__singleton__:${q.id}`;
    const existing = groups.get(key);
    const postedAt = q.postedAt ?? 0;
    if (existing === undefined) {
      groups.set(key, { key, minPostedAt: postedAt, questions: [q] });
    } else {
      existing.questions.push(q);
      if (postedAt < existing.minPostedAt) existing.minPostedAt = postedAt;
    }
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (a.minPostedAt !== b.minPostedAt) return a.minPostedAt - b.minPostedAt;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return sorted[0].questions.sort((a, b) => (a.postedAt ?? 0) - (b.postedAt ?? 0));
}

function selectReprocessTargets(
  questions: TriviaQuestion[],
  reprocessIds: string[],
  perIdErrors: Array<{ questionId: string; error: string }>,
): TriviaQuestion[] {
  const targets: TriviaQuestion[] = [];
  for (const id of reprocessIds) {
    const q = questions.find((r) => r.id === id);
    if (q === undefined) {
      perIdErrors.push({ questionId: id, error: "questionId not found" });
      continue;
    }
    if (!q.postedAt || !q.messageLink) {
      perIdErrors.push({
        questionId: id,
        error: "question has no postedAt/messageLink — cannot fetch Slack message",
      });
      continue;
    }
    targets.push(q);
  }
  return targets;
}

interface ProcessOneTargetParams {
  question: TriviaQuestion;
  isReprocessMode: boolean;
  now: number;
  botUserId: string;
  users: Map<string, TriviaUser>;
  scoped: ReturnType<TriviaDataLayer["forGame"]>;
  data: TriviaDataLayer;
  slackDeps: RevealSlackDeps;
  perIdErrors: Array<{ questionId: string; error: string }>;
}

/**
 * Process one target question: fetch reactions, clean against bot+cheaters, categorize voters,
 * persist scored answers, stamp `processedAt`. Returns the reveal entry or `null` when a per-id
 * error was recorded (skip this target, continue the batch).
 */
async function processOneTarget(
  params: ProcessOneTargetParams,
): Promise<ProcessRevealEntry | null> {
  const { question, isReprocessMode, now, botUserId, users, scoped, data, slackDeps, perIdErrors } =
    params;

  if (!question.postedAt || !question.messageLink) {
    perIdErrors.push({
      questionId: question.id,
      error: "question is missing postedAt/messageLink",
    });
    return null;
  }
  const ts = parseTsFromPermalink(question.messageLink);
  const channel = parseChannelFromPermalink(question.messageLink);
  if (ts === null || channel === null) {
    perIdErrors.push({
      questionId: question.id,
      error: `could not parse Slack ts/channel from messageLink: ${question.messageLink}`,
    });
    return null;
  }

  let rawReactions: SlackReactionLike[];
  try {
    rawReactions = await slackDeps.fetchMessageReactions(channel, ts);
  } catch (err) {
    perIdErrors.push({
      questionId: question.id,
      error: `failed to fetch Slack message: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }

  if (isReprocessMode) {
    await scoped.deleteAnswersForQuestion(question.id);
  }

  const cheats = await scoped.loadCheats();
  const cheaterIds = new Set(
    cheats.filter((c) => c.questionId === question.id).map((c) => c.cheaterUserId),
  );
  const cleaned = cleanReactionLists(rawReactions, botUserId, cheaterIds);

  const rawAnswersFormat = question.answersFormat ?? "boolean";
  if (rawAnswersFormat === "freeform") {
    // Freeform reveal is implemented separately (batch Haiku judge) — the
    // caller routes freeform questions through that path before reaching here.
    // Defensive guard: if we get here with freeform, treat as a per-id error.
    perIdErrors.push({
      questionId: question.id,
      error: "freeform questions cannot be processed through the reaction-based reveal path",
    });
    return null;
  }
  const answersFormat: "boolean" | "choice" = rawAnswersFormat;
  let buckets: VoterBuckets;
  let scoredBoolean: Array<{ userId: string; answer: boolean }> = [];
  let scoredChoice: Array<{ userId: string; answerIndex: number }> = [];

  if (answersFormat === "boolean") {
    const isTrue = question.isTrue ?? false;
    const result = categorizeBoolean(cleaned, isTrue, users);
    buckets = result.buckets;
    scoredBoolean = result.scored;
  } else {
    const correctIndex = question.correctIndex ?? -1;
    if (correctIndex < 0) {
      perIdErrors.push({
        questionId: question.id,
        error: "choice question is missing correctIndex",
      });
      return null;
    }
    const result = categorizeChoice(cleaned, correctIndex, users);
    buckets = result.buckets;
    scoredChoice = result.scored;
  }

  // Persist scored answers.
  const currentSlug = await scoped.getCurrentSeasonSlug();
  const seasonTag = currentSlug !== null ? { season: currentSlug } : {};

  if (answersFormat === "boolean") {
    const isTrue = question.isTrue ?? false;
    for (const entry of scoredBoolean) {
      await ensureUser(entry.userId, users, data, now);
      const a: SubmittedAnswer = {
        userId: entry.userId,
        questionId: question.id,
        answer: entry.answer,
        correct: entry.answer === isTrue,
        timestamp: now,
        ...seasonTag,
      };
      await scoped.saveAnswer(a);
    }
  } else {
    const correctIndex = question.correctIndex ?? -1;
    for (const entry of scoredChoice) {
      await ensureUser(entry.userId, users, data, now);
      const a: SubmittedAnswer = {
        userId: entry.userId,
        questionId: question.id,
        answerIndex: entry.answerIndex,
        correct: entry.answerIndex === correctIndex,
        timestamp: now,
        ...seasonTag,
      };
      await scoped.saveAnswer(a);
    }
  }

  await scoped.updateQuestion(question.id, { processedAt: now });

  const revealAnswer: RevealAnswer =
    answersFormat === "boolean"
      ? { type: "boolean", isTrue: question.isTrue ?? false }
      : {
          type: "choice",
          choices: question.choices ?? [],
          correctIndex: question.correctIndex ?? -1,
        };

  return {
    questionId: question.id,
    statement: question.statement,
    category: question.category,
    emojis: question.emojis ?? [],
    messageLink: question.messageLink,
    wasReprocessed: isReprocessMode,
    answer: revealAnswer,
    voters: buckets,
  };
}

async function ensureUser(
  userId: string,
  users: Map<string, TriviaUser>,
  data: TriviaDataLayer,
  now: number,
): Promise<void> {
  if (users.has(userId)) return;
  const u: TriviaUser = { userId, displayName: userId, joinedAt: now };
  users.set(userId, u);
  await data.saveUser(u);
}

interface ProcessFreeformParams {
  questions: TriviaQuestion[];
  now: number;
  users: Map<string, TriviaUser>;
  scoped: ReturnType<TriviaDataLayer["forGame"]>;
  sdk: Pick<ClackSdk, "askClaude">;
  perIdErrors: Array<{ questionId: string; error: string }>;
}

/**
 * Reveal-time judging for the freeform answer format. Collects every pending
 * row for each freeform question in the batch, sends them to Haiku in ONE
 * batched call, applies per-row verdicts via `updateAnswer`, and emits reveal
 * entries with the quoted `answerText` in voter buckets.
 *
 * When the judge call fails or returns malformed output, all pending rows for
 * the affected questions are marked `correct: false` so they don't stay stuck
 * pending across runs, and a per-question error is surfaced in the payload.
 */
async function processFreeformTargets(
  params: ProcessFreeformParams,
): Promise<ProcessRevealEntry[]> {
  const { questions, now, users, scoped, sdk, perIdErrors } = params;
  const allAnswers = await scoped.loadAnswers();

  // Build judge groups for questions that have at least one pending submission.
  // Keep a map of (questionId -> submissions) so we can apply verdicts and build
  // voter buckets after the judge returns.
  const groups: JudgeQuestionGroup[] = [];
  const submissionsByQuestion = new Map<
    string,
    Array<{ key: string; userId: string; answerText: string }>
  >();

  questions.forEach((question, qIdx) => {
    const pendingRows = allAnswers.filter(
      (a) => a.questionId === question.id && a.correct === undefined,
    );
    const subs = pendingRows.map((row, sIdx) => ({
      key: `${qIdx + 1}.${sIdx + 1}`,
      userId: row.userId,
      answerText: row.answerText ?? "",
    }));
    submissionsByQuestion.set(question.id, subs);
    groups.push({ question, submissions: subs });
  });

  // Skip the judge call entirely when no submission exists across the batch.
  const hasAnySubmission = groups.some((g) => g.submissions.length > 0);
  let verdicts: JudgeVerdict[] = [];
  let judgeFailed = false;
  if (hasAnySubmission) {
    const prompt = buildJudgePrompt(groups);
    try {
      const response = await sdk.askClaude({
        model: DEFAULT_JUDGE_MODEL,
        system: prompt.system,
        messages: prompt.messages,
        max_tokens: 1500,
      });
      verdicts = parseJudgeResponse(response.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[trivia:freeform] judge call/parse failed: ${msg}`);
      judgeFailed = true;
    }
  }

  // Index verdicts by key for fast lookup.
  const verdictByKey = new Map<string, JudgeVerdict>();
  for (const v of verdicts) verdictByKey.set(v.key, v);

  const entries: ProcessRevealEntry[] = [];
  for (const question of questions) {
    if (!question.messageLink) {
      perIdErrors.push({
        questionId: question.id,
        error: "freeform question is missing messageLink",
      });
      continue;
    }
    const subs = submissionsByQuestion.get(question.id) ?? [];

    const correctVoters: Array<{
      userId: string;
      displayName: string;
      answerText: string;
    }> = [];
    const incorrectVoters: Array<{
      userId: string;
      displayName: string;
      answerText: string;
    }> = [];

    for (const sub of subs) {
      let verdict = verdictByKey.get(sub.key);
      // Judge failure or missing verdict: commit the row as incorrect with a
      // clear reason rather than leaving it pending forever.
      if (verdict === undefined) {
        verdict = {
          key: sub.key,
          correct: false,
          reason: judgeFailed ? "judge-error" : "judge-missing-verdict",
        };
      }
      await scoped.updateAnswer(sub.userId, question.id, {
        correct: verdict.correct,
        ...(verdict.reason !== undefined ? { judgeReason: verdict.reason } : {}),
      });
      const displayName = users.get(sub.userId)?.displayName ?? sub.userId;
      const target = verdict.correct ? correctVoters : incorrectVoters;
      target.push({ userId: sub.userId, displayName, answerText: sub.answerText });
    }

    if (judgeFailed && subs.length > 0) {
      perIdErrors.push({
        questionId: question.id,
        error:
          "freeform judge call failed — submissions committed as incorrect (reason: judge-error)",
      });
    }

    await scoped.updateQuestion(question.id, { processedAt: now });

    entries.push({
      questionId: question.id,
      statement: question.statement,
      category: question.category,
      emojis: question.emojis ?? [],
      messageLink: question.messageLink,
      wasReprocessed: false,
      answer: {
        type: "freeform",
        expectedAnswer: question.expectedAnswer ?? "",
        ...(question.acceptableAnswers !== undefined
          ? { acceptableAnswers: question.acceptableAnswers }
          : {}),
        ...(question.gradingNotes !== undefined ? { gradingNotes: question.gradingNotes } : {}),
      },
      voters: {
        correct: correctVoters,
        incorrect: incorrectVoters,
        fenceSitters: [],
        wildcards: [],
      },
    });
  }

  return entries;
}

interface SeasonStatusParams {
  game: string;
  now: number;
  scoped: ReturnType<TriviaDataLayer["forGame"]>;
  leaderboard: ReturnType<typeof computeLeaderboard>["leaderboard"];
  allAnswers: SubmittedAnswer[];
  jobsLoader: () => Promise<CronJob[]>;
}

async function computeSeasonStatusAndRollover(
  params: SeasonStatusParams,
): Promise<SeasonStatusOut | undefined> {
  const { game, now, scoped, leaderboard, allAnswers, jobsLoader } = params;
  const state = await scoped.loadSeasonsState();
  const current = state ? findCurrentSeason(state, now) : null;
  if (current === null || state === null) return undefined;

  const jobs = await jobsLoader();
  const revealJob = findTriviaRevealJob(jobs, game, REVEAL_INSTRUCTION_NAME);
  const nextFire = revealJob ? nextFireAfter(revealJob, new Date(now)) : null;
  const isLastFireOfSeason =
    revealJob !== null && (nextFire === null || nextFire.getTime() > current.expectedEndAt);

  let seasonClosed = false;
  let newSeasonStarted: SeasonStatusOut["newSeasonStarted"];

  if (isLastFireOfSeason) {
    const outcome = applySeasonRollover(state, current.slug, now);
    seasonClosed = outcome.seasonClosed;
    newSeasonStarted = outcome.newSeasonStarted;
    if (seasonClosed || newSeasonStarted !== undefined) {
      await scoped.saveSeasonsState(state);
    }
  }

  const hasPriorSeasons = allAnswers.some((a) => a.season !== current.slug);
  const mvp = pickSeasonMvp(leaderboard);
  return {
    currentSlug: current.slug,
    isLastFireOfSeason,
    seasonClosed,
    hasPriorSeasons,
    ...(newSeasonStarted ? { newSeasonStarted } : {}),
    ...(mvp ? { mvp } : {}),
  };
}
