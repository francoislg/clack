import type { createUpsertSeasonTool } from "./upsertSeason.js";

export type UpsertSeasonArgs = Parameters<ReturnType<typeof createUpsertSeasonTool>["handler"]>[0];

/**
 * The `upsert_season` handler types every argument as required, so this
 * defaults every optional field to `undefined` and a test spells out only the
 * fields it exercises.
 */
export function upsertSeasonArgs(
  overrides: Partial<UpsertSeasonArgs> & Pick<UpsertSeasonArgs, "game" | "slug">,
): UpsertSeasonArgs {
  return {
    startedAt: undefined,
    expectedEndAt: undefined,
    endedAt: undefined,
    categories: undefined,
    answersFormat: undefined,
    questionType: undefined,
    promptMedium: undefined,
    freeformAnswerShape: undefined,
    contexts: undefined,
    difficulty: undefined,
    difficultyRatio: undefined,
    theme: undefined,
    format: undefined,
    slotOverrides: undefined,
    liveAnswersVisible: undefined,
    revealResponses: undefined,
    instructions: undefined,
    additionalInstructions: undefined,
    judgeInstructions: undefined,
    hint: undefined,
    judgeLeniency: undefined,
    choices: undefined,
    choiceEmojiStyle: undefined,
    points: undefined,
    teams: undefined,
    teamsEnabled: undefined,
    teamsFinaleIndividuals: undefined,
    teamsScoring: undefined,
    answeringType: undefined,
    perfectRoundsAward: undefined,
    phases: undefined,
    ...overrides,
  };
}
