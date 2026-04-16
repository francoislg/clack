import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import { PROCESS_RESPONSES_INSTRUCTIONS } from "./scheduledPrompts.js";

const DESCRIPTION = `Returns the full Game Show Presenter prompt the scheduled "answer-reveal" trivia run must follow: fetch the most recent question via fetch_channel_messages, validate the truth, resolve the questionId via find_previous_questions and load any caught-cheater list via get_question_history, silently exclude both the bot and any caught cheaters from every reaction list, categorize voters (correct / incorrect / fence-sitters / wildcards) from the cleaned lists, call submit_answers BEFORE submit_response, then deliver a Block-Kit-formatted answer reveal. The cheater exclusion is silent — never surface it in the reveal. Call this tool at the start of the scheduled answer-reveal run and follow the returned instructions exactly.`;

export function createProcessResponsesInstructionsTool() {
  return tool("process_responses_instructions", DESCRIPTION, {}, async () => {
    return textResult({ prompt: PROCESS_RESPONSES_INSTRUCTIONS });
  });
}
