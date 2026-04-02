import { clackQuery } from "./query.js";
import { logger } from "../logger.js";
import { detectRuntime } from "./utilities.js";

/**
 * Pre-analysis gate for auto-respond: asks Claude whether to skip a message.
 * Returns true (respond) or false (skip). Defaults to true (respond) on error or ambiguity.
 */
export async function runPreAnalysis(
  messageText: string,
  preAnalysisContext: string,
  sharedContext?: string,
  recentMessages?: string[],
): Promise<boolean> {
  const contextSection = sharedContext
    ? `Background context:\n${sharedContext}\n\nFiltering criteria: ${preAnalysisContext}`
    : `Filtering criteria: ${preAnalysisContext}`;

  const conversationContext = recentMessages && recentMessages.length > 0
    ? `\n\nRECENT CHANNEL HISTORY (oldest first):\n${recentMessages.map((m) => `> ${m}`).join("\n")}`
    : "";

  const systemPrompt = `You are a binary classifier. You output exactly one word, nothing else.

The following message was sent in a channel where a bot monitors and responds to messages. Your job: decide if the bot should SKIP this message or RESPOND to it. The bot should respond to almost everything — only skip obvious noise.

${contextSection}

OUTPUT FORMAT: The single word "skip" or "respond". Nothing else.`;

  try {
    let lastAssistantText = "";

    for await (const message of clackQuery({
      prompt: `${conversationContext}\n\nMESSAGE TO CLASSIFY:\n\n"""${messageText}"""`,
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        model: "sonnet",
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
      if (message.type === "result") {
        const resultText = ((message as { result?: string }).result || lastAssistantText).trim().toLowerCase();
        logger.info(`Pre-analysis result: text="${resultText}", message="${messageText.slice(0, 50)}"`);
        if (message.subtype !== "success") return true;
        return !resultText.includes("skip");
      }
    }

    logger.warn(`Pre-analysis: no result message received for "${messageText.slice(0, 50)}"`);
    return true;
  } catch (error) {
    logger.warn("Pre-analysis call failed:", error);
    return true;
  }
}
