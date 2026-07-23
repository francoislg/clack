import type {
  ScopedTriviaDataLayer,
  SubmittedAnswer,
  TeamAnswerSlot,
  TriviaDataLayer,
} from "../core/types.js";
import type { TeamDef } from "../core/configTypes.js";
import { buildTeamIndexByUser } from "../domain/teams/computeTeamStandings.js";
import { createIndividualAnswering } from "./individual.js";
import { isTeamOwnerKey, teamNameFromOwnerKey, teamOwnerKey } from "./teamKey.js";
import type { AnswerPatch, AnsweringStrategy, OwnerLabelDeps } from "./types.js";

/** Project a persisted team slot into the shared `SubmittedAnswer` shape consumers expect. */
export function projectTeamSlotToRow(slot: TeamAnswerSlot): SubmittedAnswer {
  return {
    userId: teamOwnerKey(slot.teamName),
    questionId: slot.questionId,
    ...(slot.answer !== undefined ? { answer: slot.answer } : {}),
    ...(slot.answerIndex !== undefined ? { answerIndex: slot.answerIndex } : {}),
    ...(slot.answerText !== undefined ? { answerText: slot.answerText } : {}),
    ...(slot.correct !== undefined ? { correct: slot.correct } : {}),
    ...(slot.judgeReason !== undefined ? { judgeReason: slot.judgeReason } : {}),
    ...(slot.originalVerdict !== undefined ? { originalVerdict: slot.originalVerdict } : {}),
    timestamp: slot.timestamp,
    ...(slot.season !== undefined ? { season: slot.season } : {}),
  };
}

/**
 * Shared-buzzer ownership: for a clicker in the stamped roster, the TEAM owns one
 * answer slot per question (`team-answers.json`, keyed `(teamName, questionId)`),
 * and any member's click OVERWRITES it (last-click-wins). Clickers absent from
 * the roster ("free agents") fall through to `IndividualAnswering` verbatim, so
 * consumers never see the branch — it lives here alone.
 *
 * `ownerKey` is `team:<name>` for team rows and the `userId` for free-agent rows.
 * Team writes NEVER touch identity plumbing (`recordJoin` / `refreshIdentities`):
 * a synthetic `team:` key must never reach the user registry.
 *
 * The roster is the one FROZEN at post time (`question.teamsStamp`), passed in by
 * `selectAnsweringStrategy` — membership for a question is decided when it is
 * posted, immune to later roster edits.
 */
export function createByTeamAnswering(
  scoped: ScopedTriviaDataLayer,
  data: Pick<TriviaDataLayer, "recordJoin" | "refreshIdentities">,
  roster: readonly TeamDef[],
): AnsweringStrategy {
  const individual = createIndividualAnswering(scoped, data);
  const teamIndexByUser = buildTeamIndexByUser(roster);

  function teamNameFor(userId: string): string | undefined {
    const idx = teamIndexByUser.get(userId);
    return idx === undefined ? undefined : roster[idx]?.name;
  }

  async function slotFor(
    teamName: string,
    questionId: string,
  ): Promise<TeamAnswerSlot | undefined> {
    const slots = await scoped.loadTeamAnswers();
    return slots.find((s) => s.teamName === teamName && s.questionId === questionId);
  }

  async function getCurrentAnswerFor(
    userId: string,
    questionId: string,
  ): Promise<SubmittedAnswer | undefined> {
    const teamName = teamNameFor(userId);
    if (teamName === undefined) return individual.getCurrentAnswerFor(userId, questionId);
    const slot = await slotFor(teamName, questionId);
    return slot === undefined ? undefined : projectTeamSlotToRow(slot);
  }

  async function answer(
    userId: string,
    questionId: string,
    patch: AnswerPatch,
    opts: { season?: string },
  ): Promise<void> {
    const teamName = teamNameFor(userId);
    if (teamName === undefined) {
      await individual.answer(userId, questionId, patch, opts);
      return;
    }
    // Full-slot overwrite = the override primitive. The overwriting member's id is
    // retained as `lastAnsweredBy` for audit; no identity side effects for team writes.
    const slot: TeamAnswerSlot = {
      teamName,
      questionId,
      ...(patch.answer !== undefined ? { answer: patch.answer } : {}),
      ...(patch.answerIndex !== undefined ? { answerIndex: patch.answerIndex } : {}),
      ...(patch.answerText !== undefined ? { answerText: patch.answerText } : {}),
      ...(patch.correct !== undefined ? { correct: patch.correct } : {}),
      ...(patch.judgeReason !== undefined ? { judgeReason: patch.judgeReason } : {}),
      lastAnsweredBy: userId,
      timestamp: Date.now(),
      ...(opts.season !== undefined ? { season: opts.season } : {}),
    };
    await scoped.upsertTeamAnswer(slot);
  }

  async function getFinalAnswers(questionId: string): Promise<SubmittedAnswer[]> {
    const raw = await scoped.loadAnswers();
    // Free agents only: a roster member's clicks for a byTeam question land on the
    // team slot, never answers.json. Filtering members defends against stray rows.
    const freeAgents = raw.filter(
      (a) => a.questionId === questionId && teamNameFor(a.userId) === undefined,
    );
    const slots = await scoped.loadTeamAnswers();
    const teamRows = slots.filter((s) => s.questionId === questionId).map(projectTeamSlotToRow);
    return [...freeAgents, ...teamRows];
  }

  async function getAllScoredAnswers(): Promise<SubmittedAnswer[]> {
    // GAME-WIDE, so — unlike getFinalAnswers — it must NOT filter roster members:
    // this strategy carries ONE question's roster, but a member may have legitimate
    // individual rows on OTHER (individual-mode) questions that must keep their credit.
    // No double-count risk: a question is either individual (member rows, no slots) or
    // byTeam (slots, no member rows) — stamps are frozen, never both.
    const raw = await scoped.loadAnswers();
    const slots = await scoped.loadTeamAnswers();
    return [...raw, ...slots.map(projectTeamSlotToRow)];
  }

  async function applyVerdict(
    ownerKey: string,
    questionId: string,
    patch: AnswerPatch,
  ): Promise<void> {
    if (!isTeamOwnerKey(ownerKey)) {
      await individual.applyVerdict(ownerKey, questionId, patch);
      return;
    }
    const teamName = teamNameFromOwnerKey(ownerKey);
    const existing = await slotFor(teamName, questionId);
    if (existing === undefined) return;
    await scoped.upsertTeamAnswer({ ...existing, ...patch });
  }

  function ownerLabel(ownerKey: string, deps: OwnerLabelDeps): string {
    if (isTeamOwnerKey(ownerKey)) return `*${teamNameFromOwnerKey(ownerKey)}*`;
    return individual.ownerLabel(ownerKey, deps);
  }

  return {
    getCurrentAnswerFor,
    answer,
    getFinalAnswers,
    getAllScoredAnswers,
    applyVerdict,
    ownerLabel,
  };
}
