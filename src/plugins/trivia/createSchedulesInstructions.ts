import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import { CREATE_SCHEDULES_INSTRUCTIONS } from "./scheduledPrompts.js";

const DESCRIPTION = `Returns step-by-step instructions for creating the two daily Trivia cron schedules (question posting + answer reveal) in a Slack channel. Call this tool whenever the user asks to set up, install, configure, or add trivia scheduling. The returned instructions contain the required cron configuration, requiredTools lists, and thin-dispatcher prompts; do NOT attempt to create schedules without calling this tool first. The instructions will tell you to ask the user for the channel, times, and timezone if they aren't already specified.`;

export function createCreateSchedulesInstructionsTool() {
  return tool("create_schedules_instructions", DESCRIPTION, {}, async () => {
    return textResult({ prompt: CREATE_SCHEDULES_INSTRUCTIONS });
  });
}
