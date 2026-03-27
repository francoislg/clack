import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { detectRuntime } from "./utilities.js";

/**
 * Pre-analysis gate for auto-respond: asks Haiku whether Clack should respond
 * to a message, given admin-provided context.
 * Returns true (respond) or false (skip). Defaults to false on error or ambiguity.
 */
export async function runPreAnalysis(
  messageText: string,
  preAnalysisContext: string,
  sharedContext?: string
): Promise<boolean> {
  const contextSection = sharedContext
    ? `Background context:\n${sharedContext}\n\nFiltering criteria: ${preAnalysisContext}`
    : `Filtering criteria: ${preAnalysisContext}`;

  const systemPrompt = `You are a message filter. Given the context and filtering criteria below, decide whether the assistant should respond to this message.

${contextSection}

Reply with exactly one word: "yes" if the assistant should respond, or "no" if it should not. Nothing else.`;

  try {
    let lastAssistantText = "";

    for await (const message of query({
      prompt: messageText,
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        model: "haiku",
        systemPrompt,
        disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash", "Task", "TaskOutput", "Read", "Glob", "Grep"],
        maxTurns: 1,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        lastAssistantText = "";
        for (const block of message.message.content) {
          if ("text" in block && typeof block.text === "string") {
            lastAssistantText += block.text;
          }
        }
      }
      if (message.type === "result" && message.subtype === "success") {
        const resultText = (message.result || lastAssistantText).trim().toLowerCase();
        const firstWord = resultText.split(/\s+/)[0];
        return firstWord === "yes";
      }
    }

    return false;
  } catch (error) {
    logger.debug("Pre-analysis call failed:", error);
    return false;
  }
}
