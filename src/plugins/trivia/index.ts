import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createSdkDataLayer } from "./data.js";
import { createGetPastTopicsTool } from "./getPastTopics.js";
import { createGenerateQuestionTool } from "./generateQuestion.js";
import { createRegisterUserTool } from "./registerUser.js";
import { createSubmitAnswerTool } from "./submitAnswer.js";
import { createRetrieveScoresTool } from "./retrieveScores.js";

const TRIVIA_INSTRUCTIONS = `# Trivia Game Instructions

You have access to trivia game tools. Use them to manage a "Trivia of the Day" game.

## Generating a Question

When asked to generate a trivia question, follow these steps carefully:

1. Call \`get_past_topics\` to retrieve recent topics
2. Analyze the topics covered in those previous questions to identify what's been used recently
3. Choose a completely different topic (e.g., science, history, geography, pop culture, nature, technology, sports, food, etc.)
4. Research and come up with a TRUE fact/statement about that topic
5. Randomly decide whether to keep it true OR modify it to make it false (e.g., swap a key detail like changing "shrimp" to "lobster")
6. Validate your final statement — confirm whether it's actually TRUE or FALSE through research
7. **DIFFICULTY CHECK:** Before finalizing, evaluate if the question is too obvious. Ask yourself:
   - Would most people immediately know the answer without thinking?
   - Is the statement so clearly true or false that there's no doubt?
   - Does the question feel like it could genuinely be true (even if it's false)?
     If the question is too obvious or easy, go back to step 5 and adjust it to make it more challenging and thought-provoking
8. Choose fun emojis that relate to the topic
9. Call \`generate_question\` with the topic, statement, isTrue, and emojis
10. Format the message as: \`[emoji] TRIVIA OF THE DAY [emoji] — [your statement] — Is this true :+1: or false :-1: ?\`
11. DO NOT give any hints about whether it's true or false in your wording — keep it neutral

The goal is to make people pause and think — not to stump them, but to make it interesting enough that they're not 100% certain of the answer!

## Registering Users

When a user wants to play trivia, register them with \`register_user\` using their Slack user ID and display name. Registration is idempotent — calling it again updates the display name.

## Submitting Answers

When a user answers a trivia question, call \`submit_answer\` with their userId, the questionId, and their boolean answer. The tool returns whether they were correct and their updated stats.

## Retrieving Scores

Call \`retrieve_scores\` to get the leaderboard. Present it in a fun, engaging format with rankings.`;

export const triviaPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  const data = createSdkDataLayer(sdk);

  sdk.addInstruction("user", "instructions", TRIVIA_INSTRUCTIONS);

  sdk.registerTool("member", createGetPastTopicsTool(data));
  sdk.registerTool("member", createGenerateQuestionTool(data));
  sdk.registerTool("member", createRegisterUserTool(data));
  sdk.registerTool("member", createSubmitAnswerTool(data));
  sdk.registerTool("member", createRetrieveScoresTool(data));
};
