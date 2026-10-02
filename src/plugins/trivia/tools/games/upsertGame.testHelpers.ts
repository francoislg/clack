import type { createUpsertGameTool } from "./upsertGame.js";

export type UpsertGameArgs = Parameters<ReturnType<typeof createUpsertGameTool>["handler"]>[0];

/**
 * Tool handlers are fully typed, so every field has to be present on every
 * call (zod treats missing keys as undefined, but TS doesn't). This helper
 * defaults every field to `undefined` so individual tests only spell out what
 * they're actually exercising — keeps the assertions readable and means
 * adding new optional fields to the tool doesn't ripple into every call site.
 */
export function upsertGameArgs(
  overrides: Partial<UpsertGameArgs> & Pick<UpsertGameArgs, "name">,
): UpsertGameArgs {
  return {
    channel: undefined,
    questionCron: undefined,
    revealCron: undefined,
    prepCron: undefined,
    lockCron: undefined,
    timezone: undefined,
    enabled: undefined,
    answersFormat: undefined,
    questionType: undefined,
    freeformAnswerShape: undefined,
    contexts: undefined,
    difficulty: undefined,
    difficultyRatio: undefined,
    format: undefined,
    categories: undefined,
    theme: undefined,
    liveAnswersVisible: undefined,
    revealResponses: undefined,
    instructions: undefined,
    additionalInstructions: undefined,
    judgeInstructions: undefined,
    hint: undefined,
    allTimeRow: undefined,
    tagPlayers: undefined,
    scrollToTop: undefined,
    disableAfterRound: undefined,
    includeRevealInQuestions: undefined,
    finalRevealSummary: undefined,
    judgeLeniency: undefined,
    choiceEmojiStyle: undefined,
    points: undefined,
    tellMeMore: undefined,
    choices: undefined,
    teams: undefined,
    teamsEnabled: undefined,
    teamsFinaleIndividuals: undefined,
    teamsScoring: undefined,
    answeringType: undefined,
    perfectRoundsAward: undefined,
    initialSeason: undefined,
    ...overrides,
  };
}
