import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { KnownBlock } from "@slack/types";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { triviaLogger as logger } from "../../core/pluginLogger.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { buildQuestionPointsMap, computeLeaderboard } from "../../domain/computeLeaderboard.js";
import { resolveAllTimeRow, shouldShowAllTimeRow } from "../../domain/allTimeRow.js";
import { resolveTagPlayers } from "../../domain/tagPlayers.js";
import { resolveTeamsConfig } from "../../domain/teams/resolveTeamsConfig.js";
import { computeTeamStandings } from "../../domain/teams/computeTeamStandings.js";
import { computeTeamAllTime } from "../../domain/teams/allTime.js";
import { groupVotersByTeam } from "./teamVoters.js";
import { resolveIncludeRevealInQuestions } from "../../domain/includeRevealInQuestions.js";
import { resolveFinalRevealSummary } from "../../domain/finalRevealSummary.js";
import { findCurrentSeason, findNextSeason } from "../../core/seasonTimeline.js";
import { hasUnrevealedPostedQuestions } from "../../domain/boardState.js";
import { resolveCascade } from "../../domain/resolveCascade.js";
import { buildCascadeContext } from "../../domain/cascadeContext.js";
import { nextCronFireAfter, isLastFireBeforeSeasonEnd } from "../../domain/seasonStatus.js";
import {
  fetchMessageReactions as fetchReactionsViaSlackClient,
  fetchBotUserId as fetchBotUserIdViaSlackClient,
  fetchUserDisplayName as fetchUserDisplayNameViaSlackClient,
} from "./slack.js";
import { pickSeasonMvp } from "./rollover.js";
import { computeRoundSummary, type RoundAnswer } from "./roundSummary.js";
import { buildExcludeSet, isScoredAnswer } from "../../answerTypes/cheaterFilter.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaDataLayer, TriviaQuestion, SubmittedAnswer } from "../../core/types.js";
import { getAllAnswerTypeHandlers, getAnswerTypeHandler } from "../../answerTypes/registry.js";
import type { ReStampAxis } from "../../answerTypes/types.js";
import type { CascadeContext } from "../../core/cascadeAxes.js";
import { selectBatch } from "./batchSelection.js";
import type {
  ProcessRevealEntry,
  ProcessRevealResult,
  SeasonStatusOut,
  SlackReactionLike,
  TeamStandingsOut,
} from "./types.js";

const EMPTY_CHEATER_SET: ReadonlySet<string> = new Set<string>();

const PER_FORMAT_ANSWER_SHAPES = getAllAnswerTypeHandlers()
  .map((h) => `    - ${h.revealAnswerShapeDescription}`)
  .join("\n");

const DESCRIPTION = `Score the trivia reveal for a game in one call and return the render payload — WITHOUT touching Slack and WITHOUT rolling over the season. Fetches the question's Slack message reactions (commentary only), excludes the bot + flagged cheaters, scores the stored button clicks (boolean/choice) and modal submissions (freeform, via the per-answer judge), persists scored answers, stamps \`processedAt\`, and returns the leaderboard, round summary, and (when seasons are enabled) the season status.

This tool does NOT edit any Slack card and does NOT mutate season state. After calling it, the renderer SHALL: (a) call \`refresh_question_cards({ game, questionIds })\` passing \`reveals.map(r => r.questionId)\` to edit each revealed question's card into its final state; (b) on the round's final fire (\`seasonStatus.isLastFireOfSeason === true\` OR \`windDown.eligible === true\`), call \`end_season({ game })\` to perform the (idempotent) close; (c) render the payload via \`submit_response\`.

DEFAULT BEHAVIOR (\`reprocessQuestionIds\` absent/empty AND \`reprocessBatchId\` absent): processes EVERY question in the OLDEST pending BATCH, where batches are groups of questions sharing the same \`batchId\` (stamped by \`post_questions\` per call; one cron-fire batch = one shared id). Questions with an undefined \`batchId\` (legacy rows) are each treated as their own singleton batch. The oldest batch is the one whose smallest \`postedAt\` is earliest; ties broken by lexicographic comparison of the group key. Stamps \`processedAt\` on each processed question before returning. Other pending batches stay pending — they drain one batch per fire on subsequent reveal runs. If no question is pending, returns \`reveals: []\` and a current leaderboard.

REPROCESS MODE (entered when \`reprocessQuestionIds\` is non-empty OR \`reprocessBatchId\` is set; the targeted set is their UNION; targets sorted \`postedAt\`-ascending — NON-DESTRUCTIVE). Reprocess brings each targeted question fully in line with the CURRENT key AND CURRENT config: (1) re-resolves the question's frozen config axes from the live cascade (rebuilt from the question's own stamped slot/season) and re-stamps them — \`revealResponses\` for every format, \`judgeLeniency\` for freeform; (2) re-derives verdicts on RETAINED rows — boolean/choice from the current \`isTrue\`/\`correctIndex\` + cheats, freeform by re-judging every retained \`answerText\` row under the re-stamped \`judgeLeniency\` (overwriting prior verdicts in place). Raw submissions (clicks / \`answerText\`) are the canonical record and are NEVER deleted. A targeted question that has NOT been revealed yet (no \`processedAt\`) is refused with a per-id error ("has not been revealed yet — nothing to reprocess") and skipped without any write — reprocess only touches already-revealed questions; let the default-mode reveal handle never-revealed ones. Use after correcting a key OR after a \`revealResponses\`/\`judgeLeniency\` config change to apply it to an already-posted batch (then call \`refresh_question_cards\` to re-render). Stamps \`processedAt\` (overwriting prior values). Does NOT pick up unrelated pending questions.

PAYLOAD SHAPE (renderer contract):
- \`reveals: Array<{ questionId, statement, category, emojis, messageLink, wasReprocessed, answer, voters, media? }>\` — pass \`reveals.map(r => r.questionId)\` to \`refresh_question_cards\` to repaint the cards. \`media\` is present ONLY on image-medium questions and carries \`{ title, attribution?, license? }\` for the reveal attribution line (no url/subjectId).
  - \`answer\` (dispatched on \`type\`):
${PER_FORMAT_ANSWER_SHAPES}
  - \`voters\` is a DISCRIMINATED UNION keyed on the question's stamped \`revealResponses\` mode (one of four variants):
    - \`{ revealResponses: "yes", correct: Voter[], incorrect: Voter[], noAnswer: Voter[], reactions: ReactionVoter[] }\` — full per-bucket detail. Freeform \`Voter\`s in correct/incorrect carry an additional \`answerText\` field with the user's typed answer.
    - \`{ revealResponses: "just-correctness", correct, incorrect, noAnswer, reactions }\` — same bucket structure but freeform \`Voter\`s have NO \`answerText\` (admin chose to hide typed strings).
    - \`{ revealResponses: "just-winners", correct: Voter[], incorrectCount: number, noAnswerCount: number, reactions }\` — names the \`correct\` voters ONLY (freeform winners keep \`answerText\`); the missers are reduced to anonymous counts. There are NO \`incorrect\`/\`noAnswer\` named arrays.
    - \`{ revealResponses: "no", reactions }\` — reactions list only; no per-user vote info at all.
  - \`reactions\` (present in every variant) is the message's emoji reactions as COMMENTARY, not votes. Each \`ReactionVoter\` is \`{ userId, displayName, emojis: string[] }\`. The bot and cheaters are stripped from every list.
- \`leaderboard\`: same shape as retrieve_scores' return.
- \`roundSummary\` (ALWAYS present): \`{ totalQuestions, perPlayer: Array<{ userId, displayName, correct, answered, roundMvp?, perfectRound? }> }\` — the per-player round scoreboard, an AGGREGATE derived from the scored answers (same source as \`leaderboard\`), INDEPENDENT of every entry's \`revealResponses\`. \`perPlayer\` is empty only when nobody answered this round. Cheaters/bot are excluded. \`perfectRound: true\` marks a player who answered EVERY question correctly on a fire of >= 3 questions.
- \`seasonStatus\` (only when seasons enabled): \`{ currentSlug, isLastFireOfSeason, seasonClosed, hasPriorSeasons, mvp? }\`. This tool REPORTS the status but performs NO rollover — \`seasonClosed\` is always \`false\` here and no continuation season is created. When \`isLastFireOfSeason\` is true, the renderer SHALL call \`end_season({ game })\` to perform the close.
- \`windDown\` (only \`{ eligible: true }\`, else absent): the seasonless analog of \`isLastFireOfSeason\` — present when the game has no active season and no queued season, carries \`disableAfterRound: true\`, and this reveal leaves zero posted-but-unrevealed questions (the board is cleared). REPORT-ONLY: when present, the renderer SHALL call \`end_season({ game })\`, which performs the wind-down.
- \`teamStandings\` (optional — present ONLY when the game's effective teams mode is ON): \`{ scoring, teams: Array<{ name, thisRound, currentSeason, allTime? }>, freeAgents: Array<{ userId, displayName, thisRound, currentSeason, allTime }>, finaleIndividuals? }\`. \`teams\` is ordered current-season points desc (the standings table's column order); a team's \`allTime\` is present ONLY when its name matches a prior season's stamped roster (absent → render that All Time cell empty). \`finaleIndividuals: true\` (season's last fire + \`teamsFinaleIndividuals\` on) directs the renderer to ALSO append the classic individual leaderboard below the team standings. When teams mode is ON, each entry additionally carries \`teamVoters\` (team-grouped voter buckets: a team is Correct when ≥1 member was correct, Incorrect when members answered but none correctly, NoAnswer when nobody answered; members are absorbed — name TEAMS in the narrative, never their members; free agents stay individual; freeform member answer texts arrive UNATTRIBUTED on the team entry).
- \`invalidatedQuestions\` (optional): \`Array<{ questionId, statement, category, emojis, invalidatedReason? }>\` — questions in this batch marked INVALIDATED via \`settle_question({ invalidate: true })\`. Worth 0, never scored; render an "invalidated" line for each and (via \`refresh_question_cards\`) their cards repaint as invalidated. Absent when none.
- \`instructions\` / \`additionalInstructions\` (optional): resolved guidance axes; honor verbatim. Absent → ignore.

PREDICTION DECISION GATE (default mode): if any \`questionType: "prediction"\` in the oldest pending batch is still undecided (\`resolved: false\`), this tool REFUSES (returns \`code: "UNDECIDED_PREDICTIONS"\` + the ids) and scores nothing. Decide each first with \`settle_question\` — pass the real \`outcome\` to answer, or \`invalidate: true\` + \`invalidatedReason\` to drop it.`;

/**
 * Slack-touching seam. Production wraps the real Slack WebClient via the plugin SDK;
 * tests pass a fake (no need to construct a full `App["client"]`).
 *
 * `compute_answers` uses `isAvailable()` + `fetchBotUserId()` + `fetchMessageReactions()` +
 * `fetchUserDisplayName()`; it does NOT call `updateMessage` (card edits live in
 * `refresh_question_cards`). `updateMessage` stays on the shared interface because
 * `refresh_question_cards` reuses the same dependency shape.
 */
export interface RevealSlackDeps {
  isAvailable(): string | null;
  fetchBotUserId(): Promise<string>;
  fetchMessageReactions(channel: string, ts: string): Promise<SlackReactionLike[]>;
  /**
   * Resolve a user's current Slack display name. Returns `null` for unresolvable
   * IDs (deactivated, deleted, external) so the caller leaves the stored value
   * untouched.
   */
  fetchUserDisplayName(userId: string): Promise<string | null>;
  /**
   * Replace a posted message's blocks (`chat.update`). Used by `refresh_question_cards`
   * to repaint each revealed question's card. Throws are caught by `editRevealIntoCard`
   * and treated as non-fatal.
   */
  updateMessage(channel: string, ts: string, blocks: KnownBlock[]): Promise<void>;
}

const SLACK_UNAVAILABLE_ERROR =
  "Slack client is not available. The bot's Socket Mode session must be connected for compute_answers to fetch message reactions.";

/**
 * Resolve the bot's user ID, falling back to `""` (no bot exclusion) on failure.
 * Shared by `compute_answers` and `refresh_question_cards` so both degrade identically.
 */
export async function resolveBotUserId(
  slackDeps: Pick<RevealSlackDeps, "fetchBotUserId">,
  toolName: string,
): Promise<string> {
  try {
    return await slackDeps.fetchBotUserId();
  } catch (err) {
    logger.warn(
      `${toolName}: failed to resolve bot user ID, proceeding without bot exclusion: ${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }
}

/** Build the production `RevealSlackDeps` by lazily resolving the Slack client from the SDK. */
export function defaultRevealSlackDeps(sdk: Pick<ClackSdk, "getSlackClient">): RevealSlackDeps {
  return {
    isAvailable() {
      return sdk.getSlackClient() === null ? SLACK_UNAVAILABLE_ERROR : null;
    },
    async fetchBotUserId() {
      const client = sdk.getSlackClient();
      if (!client) return "";
      return fetchBotUserIdViaSlackClient(client);
    },
    async fetchMessageReactions(channel, ts) {
      const client = sdk.getSlackClient();
      if (!client) throw new Error("Slack client became unavailable mid-run");
      return fetchReactionsViaSlackClient(client, channel, ts);
    },
    async fetchUserDisplayName(userId) {
      const client = sdk.getSlackClient();
      if (!client) return null;
      return fetchUserDisplayNameViaSlackClient(client, userId);
    },
    async updateMessage(channel, ts, blocks) {
      const client = sdk.getSlackClient();
      if (!client) throw new Error("Slack client became unavailable mid-run");
      await client.chat.update({ channel, ts, blocks });
    },
  };
}

export function createComputeAnswersTool(
  data: TriviaDataLayer,
  sdk: Pick<ClackSdk, "getSlackClient" | "askClaude" | "actionId">,
  getGamesFn: GetGamesFn = defaultGetGames,
  slackDeps: RevealSlackDeps = defaultRevealSlackDeps(sdk),
  getTriviaConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
) {
  return tool(
    "compute_answers",
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
          "Optional list of questionIds to forcibly reprocess. NON-DESTRUCTIVE: the verdict (`correct`) is re-derived on each RETAINED answer row from the question's current key + cheater list; raw answer rows are never deleted. Leave empty/absent (and omit reprocessBatchId) for the default mode (process the oldest unprocessed batch).",
        ),
      reprocessBatchId: z
        .string()
        .optional()
        .describe(
          "Optional batch handle to reprocess as a unit — every question sharing this batchId (or the single legacy row whose id equals it). Reprocess mode is entered when reprocessQuestionIds is non-empty OR this is set; when both are given the targeted set is their union. Use to apply a revealResponses/judgeLeniency config change to an already-posted batch.",
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
      const reprocessBatchId =
        args.reprocessBatchId !== undefined && args.reprocessBatchId.length > 0
          ? args.reprocessBatchId
          : undefined;
      const isReprocessMode = reprocessIds.length > 0 || reprocessBatchId !== undefined;
      const now = Date.now();

      const allQuestions = await scoped.loadQuestions();
      const perIdErrors: Array<{ questionId: string; error: string }> = [];

      // ── Question selection ──────────────────────────────────────────────
      const targets: TriviaQuestion[] = isReprocessMode
        ? selectReprocessTargets(allQuestions, reprocessIds, reprocessBatchId, perIdErrors)
        : selectOldestPendingBatch(allQuestions);

      // ── Prediction-decision gate (default reveal only) ──────────────────
      // A prediction still `resolved: false` has not been decided. Every prediction in
      // the batch MUST be decided first — answered (`settle_question` with the outcome)
      // or invalidated (`settle_question` with `invalidate`). Refuse, before any write,
      // when one is still pending, so Claude can't silently drop it from the reveal.
      if (!isReprocessMode) {
        const undecided = targets.filter((q) => q.resolved === false);
        if (undecided.length > 0) {
          return errorResult(
            JSON.stringify({
              code: "UNDECIDED_PREDICTIONS",
              message:
                "Every prediction in the reveal batch needs an explicit decision before scoring. For each id below, call settle_question — pass the real `outcome` to answer it, or `invalidate: true` + `invalidatedReason` to drop it (scores 0, shown as invalidated).",
              undecided: undecided.map((q) => ({
                questionId: q.id,
                statement: q.statement,
                category: q.category,
              })),
            }),
          );
        }
      }

      // ── Bot user ID (singleton per session, fetch once) ─────────────────
      const botUserId = await resolveBotUserId(slackDeps, "compute_answers");

      // ── Process each target ─────────────────────────────────────────────
      // Warm answerer identities through the registry BEFORE loading the lookup so both the
      // voter lists rendered inside `processReveal` and the leaderboard built below see the
      // same fresh labels. The registry handles TTL-gated refresh and fetch failures.
      const answersForRefresh = await scoped.loadAnswers();
      await data.refreshIdentities(answersForRefresh.map((a) => a.userId));
      const users = await data.loadUsers();

      const gameEntry = getGamesFn().find((g) => g.name === args.game) ?? null;
      const triviaConfig = getTriviaConfigFn();
      const seasonsStateForResolution = await scoped.loadSeasonsState();
      const currentSeasonForResolution = findCurrentSeason(seasonsStateForResolution, now);
      const teamsConfig = resolveTeamsConfig(currentSeasonForResolution, gameEntry, triviaConfig);

      // Each target's reveal scoring is owned by its answer-type handler — the
      // flow just iterates, calls `handler.processReveal`, and accumulates
      // outcomes. No card editing happens here (that is `refresh_question_cards`).
      const entriesById = new Map<string, ProcessRevealEntry>();
      // Invalidated questions are worth 0 and never scored — surface them so the reveal
      // post can render an "invalidated" line, and stamp `processedAt` so they're done.
      const invalidatedQuestions: Array<{
        questionId: string;
        statement: string;
        category: string;
        emojis: string[];
        invalidatedReason?: string;
      }> = [];
      const revealDeps = {
        scoped,
        data,
        users,
        botUserId,
        fetchMessageReactions: (channel: string, ts: string) =>
          slackDeps.fetchMessageReactions(channel, ts),
        askClaude: sdk.askClaude,
        now,
        isReprocessMode,
      };
      for (const question of targets) {
        const handler = getAnswerTypeHandler(question.answersFormat);
        // Invalidated → 0 points, never scored. Surface it (for the "invalidated" reveal
        // line + the card repaint) and stamp `processedAt` so it's terminal.
        if (question.invalidated === true) {
          invalidatedQuestions.push({
            questionId: question.id,
            statement: question.statement,
            category: question.category,
            emojis: question.emojis,
            ...(question.invalidatedReason !== undefined
              ? { invalidatedReason: question.invalidatedReason }
              : {}),
          });
          await scoped.updateQuestion(question.id, { processedAt: now });
          continue;
        }
        // Defense: a still-keyless question (only reachable via reprocess targeting a
        // pending prediction) can't be scored — skip it without a verdict.
        if (!handler.hasAnswerKey(question)) {
          continue;
        }
        // Reprocess re-applies CURRENT config: re-resolve each format's frozen
        // axes from the live cascade (rebuilt from this question's own stamped
        // slot/season) and re-stamp them before scoring. Isolated per question —
        // a resolution failure records a per-id error and skips it, never a
        // silent clobber of the stamped value.
        if (isReprocessMode) {
          try {
            await reStampReprocessedConfig(
              scoped,
              question,
              handler.reprocessReStampAxes,
              buildCascadeContext(
                currentSeasonForResolution,
                gameEntry,
                question.slot?.index ?? null,
                triviaConfig,
              ),
            );
          } catch (err) {
            perIdErrors.push({
              questionId: question.id,
              error: err instanceof Error ? err.message : String(err),
            });
            continue;
          }
        }
        const outcome = await handler.processReveal(question, revealDeps);
        if (outcome.ok) {
          // Image-medium questions carry attribution for the reveal's "📷 Image: …"
          // line. Stamp it centrally; expose only title/attribution/license.
          const entry: ProcessRevealEntry = {
            ...outcome.entry,
            ...(question.media !== undefined
              ? {
                  media: {
                    title: question.media.title,
                    ...(question.media.attribution !== undefined
                      ? { attribution: question.media.attribution }
                      : {}),
                    ...(question.media.license !== undefined
                      ? { license: question.media.license }
                      : {}),
                  },
                }
              : {}),
            ...(question.points !== undefined && question.points > 1
              ? { points: question.points }
              : {}),
          };
          if (teamsConfig.enabled) {
            const teamVoters = groupVotersByTeam(entry.voters, teamsConfig.roster);
            if (teamVoters !== undefined) entry.teamVoters = teamVoters;
          }
          entriesById.set(question.id, entry);
        } else {
          perIdErrors.push({ questionId: question.id, error: outcome.error });
        }
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

      // Re-read questions so the points join reflects any stamp written during this run.
      const questionPoints = buildQuestionPointsMap(await scoped.loadQuestions());

      const { leaderboard } = computeLeaderboard(refreshedAnswers, refreshedUsers, questionPoints, {
        sortBy: "totalCorrect",
        primaryFilterSeason: seasonsEnabled ? currentSlugForBoard : null,
        currentSeasonSlug: currentSlugForBoard,
      });

      // ── Season status (REPORT ONLY — the close lives in end_season) ─
      // `isLastFireOfSeason` is derived from the game's OWN `revealCron` (plugin
      // config), never from the bot-core cron-job registry.
      let seasonStatus: SeasonStatusOut | undefined;
      if (seasonsEnabled && currentSlugForBoard !== null) {
        seasonStatus = await computeSeasonStatus({
          now,
          scoped,
          leaderboard,
          allAnswers: refreshedAnswers,
          revealCron: gameEntry?.revealCron,
          timezone: gameEntry?.timezone,
        });
      }

      // ── Seasonless wind-down eligibility (REPORT ONLY — the disable lives in
      // end_season). The seasonless analog of `isLastFireOfSeason`: no active
      // season, no queued season, `disableAfterRound` set, board cleared. The
      // questions are re-loaded because the processing loop above stamped
      // `processedAt` on disk.
      let windDown: { eligible: true } | undefined;
      if (
        currentSeasonForResolution === null &&
        gameEntry?.disableAfterRound === true &&
        findNextSeason(seasonsStateForResolution, now) === null
      ) {
        const questionsAfterProcessing = await scoped.loadQuestions();
        if (!hasUnrevealedPostedQuestions(questionsAfterProcessing)) {
          windDown = { eligible: true };
        }
      }

      // Per-player round scoreboard — AGGREGATE from scored answers (same source
      // as the leaderboard), independent of `revealResponses`. Cheaters/bot/
      // pending rows filtered with the standard `isScoredAnswer`.
      const revealedQuestionIds = reveals.map((r) => r.questionId);
      const cheats = await scoped.loadCheats();
      const cheaterIdsByQuestion = new Map<string, Set<string>>();
      for (const c of cheats) {
        const set = cheaterIdsByQuestion.get(c.questionId) ?? new Set<string>();
        set.add(c.cheaterUserId);
        cheaterIdsByQuestion.set(c.questionId, set);
      }
      const revealedIdSet = new Set(revealedQuestionIds);
      const scoredRoundAnswers: RoundAnswer[] = [];
      const scoredRoundRows: SubmittedAnswer[] = [];
      for (const a of refreshedAnswers) {
        if (!revealedIdSet.has(a.questionId)) continue;
        const cheaterIds = cheaterIdsByQuestion.get(a.questionId) ?? EMPTY_CHEATER_SET;
        if (!isScoredAnswer(a, cheaterIds, botUserId)) continue;
        scoredRoundAnswers.push({
          questionId: a.questionId,
          userId: a.userId,
          correct: a.correct === true,
        });
        scoredRoundRows.push(a);
      }
      const roundSummary = computeRoundSummary(
        revealedQuestionIds,
        scoredRoundAnswers,
        (userId) => refreshedUsers.get(userId)?.displayName ?? userId,
        questionPoints,
      );

      // Teams-mode standings block. Present ONLY when teams mode is effectively
      // ON — the teams-off payload stays byte-identical to pre-teams behavior.
      let teamStandingsOut: TeamStandingsOut | undefined;
      if (teamsConfig.enabled) {
        const excludes = buildExcludeSet(botUserId, EMPTY_CHEATER_SET);
        const roundStandings = computeTeamStandings(
          scoredRoundRows,
          teamsConfig.roster,
          teamsConfig.scoring,
          null,
          questionPoints,
        );
        const seasonStandings = computeTeamStandings(
          refreshedAnswers,
          teamsConfig.roster,
          teamsConfig.scoring,
          currentSlugForBoard,
          questionPoints,
          excludes,
        );
        const allTimeByName = computeTeamAllTime(
          refreshedAnswers,
          seasonsStateForResolution,
          teamsConfig.roster,
          teamsConfig.scoring,
          currentSlugForBoard,
          questionPoints,
          excludes,
        );
        const roundByName = new Map(roundStandings.map((s) => [s.name, s.points]));

        const teamUserIds = new Set(teamsConfig.roster.flatMap((t) => t.userIds));
        const roundPointsByUser = new Map(roundSummary.perPlayer.map((p) => [p.userId, p.points]));
        const freeAgents = leaderboard
          .filter((entry) => !teamUserIds.has(entry.userId))
          .map((entry) => ({
            userId: entry.userId,
            displayName: entry.displayName,
            thisRound: roundPointsByUser.get(entry.userId) ?? 0,
            currentSeason: entry.currentSeasonPoints ?? 0,
            allTime: entry.totalPoints,
          }));

        teamStandingsOut = {
          scoring: teamsConfig.scoring,
          // seasonStandings is already sorted season-points-desc — the table's
          // column order.
          teams: seasonStandings.map((s) => {
            const allTime = allTimeByName.get(s.name);
            return {
              name: s.name,
              thisRound: roundByName.get(s.name) ?? 0,
              currentSeason: s.points,
              ...(allTime !== undefined ? { allTime } : {}),
            };
          }),
          freeAgents,
          ...(seasonStatus?.isLastFireOfSeason === true && teamsConfig.finaleIndividuals
            ? { finaleIndividuals: true as const }
            : {}),
        };
      }

      // Resolve the two free-form guidance axes for this reveal.
      const firstSlotIndex =
        targets.length > 0 && targets[0].slot !== undefined ? targets[0].slot.index : null;
      const revealCascadeCtx = buildCascadeContext(
        currentSeasonForResolution,
        gameEntry,
        firstSlotIndex,
        triviaConfig,
      );
      const resolvedInstructions = resolveCascade("instructions", revealCascadeCtx).value;
      const resolvedAdditionalInstructions = resolveCascade(
        "additionalInstructions",
        revealCascadeCtx,
      ).value;

      const result: ProcessRevealResult = {
        game: args.game,
        reveals,
        leaderboard,
        roundSummary,
        includeRevealInQuestions: resolveIncludeRevealInQuestions(gameEntry, triviaConfig),
        finalRevealSummary: resolveFinalRevealSummary(gameEntry, triviaConfig),
        tagPlayers: resolveTagPlayers(gameEntry, triviaConfig),
        ...(seasonStatus ? { seasonStatus } : {}),
        ...(windDown !== undefined ? { windDown } : {}),
        ...(teamStandingsOut !== undefined ? { teamStandings: teamStandingsOut } : {}),
        ...(seasonStatus
          ? {
              showAllTimeRow: shouldShowAllTimeRow(
                resolveAllTimeRow(gameEntry, triviaConfig),
                seasonStatus.isLastFireOfSeason,
              ),
            }
          : {}),
        ...(invalidatedQuestions.length > 0 ? { invalidatedQuestions } : {}),
        ...(perIdErrors.length > 0 ? { errors: perIdErrors } : {}),
        ...(resolvedInstructions !== null ? { instructions: resolvedInstructions } : {}),
        ...(resolvedAdditionalInstructions !== null
          ? { additionalInstructions: resolvedAdditionalInstructions }
          : {}),
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
  reprocessBatchId: string | undefined,
  perIdErrors: Array<{ questionId: string; error: string }>,
): TriviaQuestion[] {
  const byId = new Map<string, TriviaQuestion>();
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
    byId.set(q.id, q);
  }
  if (reprocessBatchId !== undefined) {
    for (const q of selectBatch(questions, reprocessBatchId)) byId.set(q.id, q);
  }
  // A never-revealed target (no `processedAt`) has nothing to RE-process; stamping it
  // would leak its answer via the projector and drop it from the pending-batch reveal
  // flow. Refuse it with a per-id error (uniformly across both selection paths) and let
  // the default-mode reveal handle it instead. Applied last so it also covers batchId
  // members.
  const targets: TriviaQuestion[] = [];
  for (const q of [...byId.values()].sort((a, b) => (a.postedAt ?? 0) - (b.postedAt ?? 0))) {
    if (q.processedAt === undefined) {
      perIdErrors.push({
        questionId: q.id,
        error: "question has not been revealed yet — nothing to reprocess",
      });
      continue;
    }
    targets.push(q);
  }
  return targets;
}

/**
 * Re-resolve a reprocessed question's frozen config axes from the live cascade
 * and re-stamp them on the record (and the in-memory object, so the scorer/judge
 * read the new value). Which axes apply is the handler's call; the assignment is
 * keyed per axis so each lands on its correctly-typed field.
 */
async function reStampReprocessedConfig(
  scoped: ReturnType<TriviaDataLayer["forGame"]>,
  question: TriviaQuestion,
  axes: readonly ReStampAxis[],
  ctx: CascadeContext,
): Promise<void> {
  const updates: Partial<TriviaQuestion> = {};
  for (const axis of axes) {
    if (axis === "revealResponses") {
      updates.revealResponses = resolveCascade("revealResponses", ctx).value;
    } else if (axis === "judgeLeniency") {
      updates.judgeLeniency = resolveCascade("judgeLeniency", ctx).value;
    } else {
      // Compile error if a ReStampAxis member gains no branch here — keeps the
      // axis set and the re-stamp logic from silently drifting apart.
      throw new Error(`unhandled ReStampAxis: ${String(axis satisfies never)}`);
    }
  }
  // Persist first; mirror onto the in-memory object only once the write lands, so
  // a failed write leaves memory and disk consistent (the caller skips the question).
  await scoped.updateQuestion(question.id, updates);
  Object.assign(question, updates);
}

interface SeasonStatusParams {
  now: number;
  scoped: ReturnType<TriviaDataLayer["forGame"]>;
  leaderboard: ReturnType<typeof computeLeaderboard>["leaderboard"];
  allAnswers: SubmittedAnswer[];
  /** The game's own reveal cron (plugin config), used to find the next fire. */
  revealCron: string | undefined;
  timezone: string | undefined;
}

/**
 * Compute the season status for the reveal payload — REPORT ONLY. Performs NO
 * rollover and mutates NO state: `seasonClosed` is always `false` and no
 * continuation season is created. The rollover (stamp `endedAt`, create the
 * continuation) is owned by `end_season`, which the reveal prompt calls on
 * the last fire. Keeping the irreversible mutation off the compute step is what
 * lets compute be re-run safely.
 *
 * `isLastFireOfSeason` = "the next reveal fire lands after the season's
 * `expectedEndAt`". The next-fire instant is derived from the game's own
 * `revealCron` (plugin config) — the bot-core cron-job registry is NOT consulted.
 */
async function computeSeasonStatus(
  params: SeasonStatusParams,
): Promise<SeasonStatusOut | undefined> {
  const { now, scoped, leaderboard, allAnswers, revealCron, timezone } = params;
  const state = await scoped.loadSeasonsState();
  const current = state ? findCurrentSeason(state, now) : null;
  if (current === null || state === null) return undefined;

  const nextFire = revealCron ? nextCronFireAfter(revealCron, timezone, new Date(now)) : null;
  const isLastFireOfSeason =
    revealCron !== undefined && isLastFireBeforeSeasonEnd(nextFire, current.expectedEndAt);

  const hasPriorSeasons = allAnswers.some((a) => a.season !== current.slug);
  const mvp = pickSeasonMvp(leaderboard);
  return {
    currentSlug: current.slug,
    isLastFireOfSeason,
    seasonClosed: false,
    hasPriorSeasons,
    ...(mvp ? { mvp } : {}),
  };
}
