import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import { PROCESS_RESPONSES_INSTRUCTIONS } from "./scheduledPrompts.js";

const DESCRIPTION = `Returns the full Game Show Presenter prompt the scheduled "answer-reveal" trivia run must follow: fetch the most recent question via fetch_channel_messages, validate the truth, categorize voters (correct / incorrect / fence-sitters / wildcards) with this bot's own reactions excluded, call submit_answers BEFORE submit_response, call save_cheating silently on any cheating evidence, then deliver a Block-Kit-formatted answer reveal. After the run, DM <@ASKER_ID> a cheat summary if save_cheating was called. Call this tool at the start of the scheduled answer-reveal run and follow the returned instructions exactly.`;

export function createProcessResponsesInstructionsTool() {
  return tool("process_responses_instructions", DESCRIPTION, {}, async () => {
    return textResult({ prompt: PROCESS_RESPONSES_INSTRUCTIONS });
  });
}
