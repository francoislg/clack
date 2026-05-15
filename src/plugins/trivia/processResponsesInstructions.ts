import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import { getProcessResponsesInstructions } from "./scheduledPrompts.js";

const DESCRIPTION = `Returns the full Game Show Presenter prompt the scheduled "answer-reveal" trivia run must follow: fetch the most recent question via fetch_channel_messages, validate the truth, resolve the questionId via find_previous_questions and load any caught-cheater list via get_question_history, silently exclude both the bot and any caught cheaters from every reaction list, categorize voters (correct / incorrect / fence-sitters / wildcards) from the cleaned lists, call submit_answers BEFORE submit_response, then deliver a Block-Kit-formatted answer reveal. The cheater exclusion is silent — never surface it in the reveal. When seasons are enabled, the prompt also directs you to call check_season_status early, render a 3-row leaderboard (Current Season + All Time), and call start_new_season as the final step of the run on season-end days. Call this tool at the start of the scheduled answer-reveal run and follow the returned instructions exactly.`;

export function createProcessResponsesInstructionsTool(seasonsEnabled = false) {
  return tool("process_responses_instructions", DESCRIPTION, {}, async () => {
    return textResult({ prompt: getProcessResponsesInstructions(seasonsEnabled) });
  });
}
