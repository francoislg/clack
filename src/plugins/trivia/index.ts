import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createSdkDataLayer } from "./data.js";
import { SEED_CATEGORIES } from "./seedCategories.js";
import { createAddCategoriesTool } from "./addCategories.js";
import { createRemoveCategoriesTool } from "./removeCategories.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { createSubmitAnswersTool } from "./submitAnswers.js";
import { createRetrieveScoresTool } from "./retrieveScores.js";

const TRIVIA_INSTRUCTIONS = `# Trivia Game Instructions

You have access to trivia game tools. Use them to manage a "Trivia of the Day" game.

## Generating a Question

When asked to generate a trivia question, follow these steps carefully:

1. Call \`get_ideas\` to get 5 suggested categories (recent ones are already excluded)
2. Pick one category that sounds interesting
3. Call \`find_previous_questions(category: "<chosen>")\` to see what's been asked in that category
4. Come up with a TRUE fact/statement about that category that hasn't been covered before
5. Randomly decide whether to keep it true OR modify it to make it false (e.g., swap a key detail)
6. Validate your final statement — confirm whether it's actually TRUE or FALSE
7. **DIFFICULTY CHECK:** Before finalizing, evaluate if the question is too obvious. Ask yourself:
   - Would most people immediately know the answer without thinking?
   - Does the question feel like it could genuinely be true (even if it's false)?
   If the question is too easy, adjust it to make it more challenging
8. Call \`find_previous_questions(text: "<key phrase>")\` to make sure the specific fact hasn't been asked under a different category
9. Choose fun emojis that relate to the category
10. Call \`save_question\` with the category, statement, isTrue, and emojis
11. Format the message as: \`[emoji] TRIVIA OF THE DAY [emoji] — [your statement] — Is this true :+1: or false :-1: ?\`
12. DO NOT give any hints about whether it's true or false in your wording — keep it neutral

If the category you want isn't in the pool, you can suggest adding it with \`add_categories\`.

The goal is to make people pause and think — not to stump them, but to make it interesting enough that they're not 100% certain of the answer!

## Submitting Answers

When processing trivia answers from users, collect all answers and submit them in one batch using \`submit_answers\`. Include:
- The \`questionId\` of the trivia question
- The Slack \`messageLink\` permalink to the trivia message
- The \`postedAt\` timestamp of when it was posted
- An array of answers with each user's \`userId\`, \`displayName\`, and boolean \`answer\`

Users are automatically registered when their answers are submitted.

## Retrieving Scores

Call \`retrieve_scores\` to get the leaderboard. Present it in a fun, engaging format with rankings.`;

export const triviaPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  const data = createSdkDataLayer(sdk);

  // Seed categories on first load
  const categories = await data.loadCategories();
  if (categories.length === 0) {
    await data.saveCategories(SEED_CATEGORIES);
  }

  sdk.addInstruction("user", "instructions", TRIVIA_INSTRUCTIONS);

  sdk.registerTool("owner", createAddCategoriesTool(data), "Adding trivia categories");
  sdk.registerTool("owner", createRemoveCategoriesTool(data), "Removing trivia categories");
  sdk.registerTool("owner", createGetIdeasTool(data), "Getting trivia category ideas");
  sdk.registerTool("owner", createSaveQuestionTool(data), "Saving trivia question — {category}");
  sdk.registerTool(
    "member",
    createFindPreviousQuestionsTool(data),
    "Searching past trivia questions",
  );
  sdk.registerTool("owner", createSubmitAnswersTool(data), "Submitting trivia answers");
  sdk.registerTool("member", createRetrieveScoresTool(data), "Retrieving trivia scores");
};
