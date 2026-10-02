import type { createSetWorkspaceConfigTool } from "./setWorkspaceConfig.js";

export type SetWorkspaceConfigArgs = Parameters<
  ReturnType<typeof createSetWorkspaceConfigTool>["handler"]
>[0];

/**
 * The `set_workspace_config` handler types every argument as required, so this
 * defaults every field to `undefined` and a test spells out only the fields it
 * exercises.
 */
export function setWorkspaceConfigArgs(
  overrides: Partial<SetWorkspaceConfigArgs> = {},
): SetWorkspaceConfigArgs {
  return {
    answersFormat: undefined,
    questionType: undefined,
    freeformAnswerShape: undefined,
    contexts: undefined,
    difficulty: undefined,
    difficultyRatio: undefined,
    choices: undefined,
    choiceEmojiStyle: undefined,
    points: undefined,
    offDays: undefined,
    seasons: undefined,
    liveAnswersVisible: undefined,
    revealResponses: undefined,
    instructions: undefined,
    additionalInstructions: undefined,
    judgeInstructions: undefined,
    hint: undefined,
    allTimeRow: undefined,
    tagPlayers: undefined,
    scrollToTop: undefined,
    includeRevealInQuestions: undefined,
    finalRevealSummary: undefined,
    judgeLeniency: undefined,
    tellMeMore: undefined,
    teams: undefined,
    teamsEnabled: undefined,
    teamsFinaleIndividuals: undefined,
    teamsScoring: undefined,
    answeringType: undefined,
    perfectRoundsAward: undefined,
    ...overrides,
  };
}
