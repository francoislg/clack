import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { KnownBlock } from "@slack/types";
import { textResult, errorResult } from "../../../../tools/helpers.js";
// TODO(plugin-isolation): loadJobs reaches into bot-core cron-job state.
// Move to an SDK accessor (e.g. sdk.listOwnerCronJobs) in a follow-up.
import { loadJobs } from "../../../../cronJobs.js";
import { triviaLogger as logger } from "../../core/pluginLogger.js";
import type { TriviaCronJobView } from "../../domain/seasonStatus.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { computeLeaderboard } from "../../domain/computeLeaderboard.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { resolveAdditionalInstructions, resolveInstructions } from "../../domain/instructions.js";
import { findTriviaRevealJob, nextFireAfter } from "../../domain/seasonStatus.js";
import {
  fetchMessageReactions as fetchReactionsViaSlackClient,
  fetchBotUserId as fetchBotUserIdViaSlackClient,
  fetchUserDisplayName as fetchUserDisplayNameViaSlackClient,
} from "./slack.js";
import { pickSeasonMvp, applySeasonRollover } from "./rollover.js";
import { refreshUserDisplayNames } from "./refreshDisplayNames.js";
import { computeRoundSummary } from "./roundSummary.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaDataLayer, TriviaQuestion, SubmittedAnswer } from "../../core/types.js";
import { getAllAnswerTypeHandlers, getAnswerTypeHandler } from "../../answerTypes/registry.js";
import { editRevealIntoCard } from "../../revealCards/editCard.js";
import type {
  ProcessRevealEntry,
  ProcessRevealResult,
  SeasonStatusOut,
  SlackReactionLike,
} from "./types.js";

const REVEAL_INSTRUCTION_NAME = "process_responses_instructions";

const PER_FORMAT_ANSWER_SHAPES = getAllAnswerTypeHandlers()
  .map((h) => `    - ${h.revealAnswerShapeDescription}`)
  .join("\n");

const DESCRIPTION = `Process the trivia reveal for a game in one call: fetch the question's Slack message, exclude the bot + flagged cheaters, score the stored button clicks (boolean/choice) and modal submissions (freeform), gather the message reactions as commentary (NOT votes), persist scored answers, return the leaderboard, and (when seasons are enabled) the season status. Replaces the previous orchestration that called fetch_channel_messages, find_previous_questions, get_question_history, submit_answers, retrieve_scores, and (with seasons) check_season_status as separate steps.

DEFAULT BEHAVIOR (\`reprocessQuestionIds\` absent or empty): processes EVERY question in the OLDEST pending BATCH, where batches are groups of questions sharing the same \`batchId\` (stamped by \`post_questions\` per call; one cron-fire batch = one shared id). Questions with an undefined \`batchId\` (legacy rows) are each treated as their own singleton batch. The oldest batch is the one whose smallest \`postedAt\` is earliest; ties broken by lexicographic comparison of the group key. Stamps \`processedAt\` on each processed question before returning. Other pending batches stay pending — they drain one batch per fire on subsequent reveal runs. If no question is pending, returns \`reveals: []\` and a current leaderboard.

REPROCESS MODE (\`reprocessQuestionIds\` non-empty — DESTRUCTIVE for boolean/choice; rejected for freeform): for boolean/choice questions, hard-deletes the prior \`SubmittedAnswer\` rows for that question, then re-derives scoring from the CURRENT stored button-click answers + cheats list (which may now include cheaters flagged after the original reveal). For freeform questions the modal submissions are immutable, so the per-handler reveal pipeline rejects reprocess. Stamps \`processedAt\` (overwriting prior values). Does NOT pick up unrelated pending questions in this mode.

PAYLOAD SHAPE (renderer contract):
- \`reveals: Array<{ questionId, statement, category, emojis, messageLink, wasReprocessed, answer, voters, media? }>\` — \`media\` is present ONLY on image-medium questions and carries \`{ title, attribution?, license? }\` for the reveal attribution line (no url/subjectId).
  - \`answer\` (dispatched on \`type\`):
${PER_FORMAT_ANSWER_SHAPES}
  - \`voters\` is a DISCRIMINATED UNION keyed on the question's stamped \`revealResponses\` mode (one of four variants):
    - \`{ revealResponses: "yes", correct: Voter[], incorrect: Voter[], noAnswer: Voter[], reactions: ReactionVoter[] }\` — full per-bucket detail. Freeform \`Voter\`s in correct/incorrect carry an additional \`answerText\` field with the user's typed answer.
    - \`{ revealResponses: "just-correctness", correct, incorrect, noAnswer, reactions }\` — same bucket structure but freeform \`Voter\`s have NO \`answerText\` (admin chose to hide typed strings).
    - \`{ revealResponses: "just-winners", correct: Voter[], incorrectCount: number, noAnswerCount: number, reactions }\` — names the \`correct\` voters ONLY (freeform winners keep \`answerText\`); the missers are reduced to anonymous counts. There are NO \`incorrect\`/\`noAnswer\` named arrays. Use the counts for "N missed" / "everyone got fooled" flair without naming anyone.
    - \`{ revealResponses: "no", reactions }\` — reactions list only; no per-user vote info at all.
  - \`reactions\` (present in every variant) is the message's emoji reactions as COMMENTARY, not votes. Each \`ReactionVoter\` is \`{ userId, displayName, emojis: string[] }\` carrying every emoji that user reacted with so the renderer can riff on it. The bot and cheaters are stripped from every list.
- \`leaderboard\`: same shape as retrieve_scores' return.
- \`roundSummary\` (OPTIONAL): per-player aggregate across the round. Present ONLY when every reveal entry has \`revealResponses === "yes"\` — when ANY entry is \`"just-correctness"\`, \`"just-winners"\`, or \`"no"\`, the field is omitted (the tool cannot produce aggregates without per-user vote info).
- \`seasonStatus\` (only when seasons enabled): \`{ currentSlug, isLastFireOfSeason, seasonClosed, newSeasonStarted?, mvp? }\`. When \`isLastFireOfSeason\` is true, the tool ALREADY stamped \`endedAt\` on the closing season and (when no continuation was queued) created a new starter season before returning — the renderer SHALL NOT call \`upsert_season\`.
- \`instructions\` (optional string): resolved value of the REPLACE cascade \`slot → season → game → workspace\` of the free-form \`instructions\` axis. Present iff some tier sets a non-empty value. Honor verbatim as guidance during reveal rendering (verdict tone, voter-bucket commentary, closer line, leaderboard intro). Absent → ignore.
- \`additionalInstructions\` (optional string): resolved value of the CUMULATIVE \`additionalInstructions\` axis — every non-empty tier concatenated in \`workspace → game → season → slot\` order, each segment tier-labeled (\`[Workspace]\` / \`[Game]\` / \`[Season]\` / \`[Slot N]\`). Honor every labeled rule verbatim. Absent → ignore.

The renderer's job is two-step: (a) call this tool, (b) render the returned payload using submit_response with the Game Show Presenter voice — branching the per-question bucket sections on \`voters.revealResponses\`.`;

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
  /**
   * Resolve a user's current Slack display name. Returns `null` for unresolvable
   * IDs (deactivated, deleted, external) so the caller leaves the stored value
   * untouched. Used to refresh `users.json` entries at reveal time so leaderboard
   * labels track Slack display-name edits.
   */
  fetchUserDisplayName(userId: string): Promise<string | null>;
  /**
   * Replace a posted message's blocks (`chat.update`). Used to repaint each
   * revealed question's original card into its final static state. Throws are
   * caught by `editRevealIntoCard` and treated as non-fatal.
   */
  updateMessage(channel: string, ts: string, blocks: KnownBlock[]): Promise<void>;
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

export function createProcessRevealAnswersTool(
  data: TriviaDataLayer,
  sdk: Pick<ClackSdk, "getSlackClient" | "askClaude" | "actionId">,
  getGamesFn: GetGamesFn = defaultGetGames,
  jobsLoader: () => Promise<TriviaCronJobView[]> = loadJobs,
  slackDeps: RevealSlackDeps = defaultRevealSlackDeps(sdk),
  getTriviaConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
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

      // Refresh display names against live Slack profiles BEFORE the per-handler
      // loop so both the voter lists rendered inside `processReveal` and the
      // leaderboard built below see the same fresh labels. `users.json` is
      // global and only ever written on first click — Slack profile edits would
      // otherwise never propagate. Scope the refresh to users who have at least
      // one answer in this game (i.e. anyone who could appear on this game's
      // leaderboard or voter lists). Errors are swallowed per-user.
      const answersForRefresh = await scoped.loadAnswers();
      await refreshUserDisplayNames({
        userIds: new Set(answersForRefresh.map((a) => a.userId)),
        users,
        data,
        fetchDisplayName: (userId) => slackDeps.fetchUserDisplayName(userId),
        logger,
      });

      // Split freeform targets out: they go through the inline Haiku judge
      // (no Slack reactions to read). Boolean/choice questions stay on the
      // Each target's full reveal processing is owned by its answer-type
      // handler — the reveal flow just iterates, calls `handler.processReveal`,
      // and accumulates outcomes. No format-string branching lives here.
      const entriesById = new Map<string, ProcessRevealEntry>();
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
        const outcome = await handler.processReveal(question, revealDeps);
        if (outcome.ok) {
          // Image-medium questions carry attribution for the reveal's "📷 Image: …"
          // line. Stamp it centrally (DRY across answer-type handlers); expose only
          // title/attribution/license — never url/subjectId (not needed; leak surface).
          const entry: ProcessRevealEntry =
            question.media !== undefined
              ? {
                  ...outcome.entry,
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
              : outcome.entry;
          entriesById.set(question.id, entry);
          // Repaint the original question card into its final static state. This
          // is a non-fatal side effect: editRevealIntoCard swallows its own
          // failures, so a failed edit never affects the payload below.
          await editRevealIntoCard({
            updateMessage: (channel, ts, blocks) => slackDeps.updateMessage(channel, ts, blocks),
            question,
            entry,
            actionId: sdk.actionId,
          });
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

      // Gate `roundSummary` on the discriminated `revealResponses` mode of
      // EVERY reveal entry: aggregate per-player counts would leak across
      // restricted slots, so the whole field drops out when any slot is
      // anything other than "yes". Mixed-mode batches are rare in practice;
      // selective masking would be a confusing compromise.
      const allYes = reveals.length > 0 && reveals.every((r) => r.voters.revealResponses === "yes");

      // Resolve the two free-form guidance axes for this reveal. Strategy for
      // multi-question batches: use the first target's slot index (when set).
      // Resolving per-question would multiply payload size for a feature whose
      // value at reveal time is whole-batch tone guidance, not per-slot tuning.
      const triviaConfig = getTriviaConfigFn();
      const gameEntry = getGamesFn().find((g) => g.name === args.game) ?? null;
      const currentSeasonForResolution = findCurrentSeason(await scoped.loadSeasonsState(), now);
      const firstSlotIndex =
        targets.length > 0 && targets[0].slot !== undefined ? targets[0].slot.index : null;
      const resolvedInstructions = resolveInstructions(
        currentSeasonForResolution,
        firstSlotIndex,
        gameEntry,
        triviaConfig,
      );
      const resolvedAdditionalInstructions = resolveAdditionalInstructions(
        currentSeasonForResolution,
        firstSlotIndex,
        gameEntry,
        triviaConfig,
      );

      const result: ProcessRevealResult = {
        game: args.game,
        reveals,
        leaderboard,
        ...(allYes ? { roundSummary: computeRoundSummary(reveals) } : {}),
        ...(seasonStatus ? { seasonStatus } : {}),
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

interface SeasonStatusParams {
  game: string;
  now: number;
  scoped: ReturnType<TriviaDataLayer["forGame"]>;
  leaderboard: ReturnType<typeof computeLeaderboard>["leaderboard"];
  allAnswers: SubmittedAnswer[];
  jobsLoader: () => Promise<TriviaCronJobView[]>;
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
