import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import { SEND_QUESTIONS_INSTRUCTIONS } from "./scheduledPrompts.js";

const DESCRIPTION = `Returns the full Game Show Presenter prompt the scheduled "question-posting" trivia run must follow: 10-step flow (get_ideas → research → duplicate check → validation → difficulty gate → save_question → Block Kit formatting with four style variants → submit_response with reactions: ["+1", "-1"]). Call this tool at the start of the scheduled question-posting run and follow the returned instructions exactly.`;

export function createSendQuestionsInstructionsTool() {
  return tool("send_questions_instructions", DESCRIPTION, {}, async () => {
    return textResult({ prompt: SEND_QUESTIONS_INSTRUCTIONS });
  });
}
