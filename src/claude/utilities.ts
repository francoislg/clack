import { clackQuery } from "./query.js";
import { basename } from "node:path";
import { logger } from "../logger.js";
import type { ConversationMessage } from "./index.js";

/**
 * Detect the JavaScript runtime from process.execPath and return
 * the appropriate SDK executable literal ('node' | 'bun' | 'deno').
 */
export function detectRuntime(): "node" | "bun" | "deno" {
  const bin = basename(process.execPath).toLowerCase();
  if (bin.startsWith("bun")) return "bun";
  if (bin.startsWith("deno")) return "deno";
  return "node";
}

/**
 * Summarize text that was too long for Slack using a quick Claude call.
 * Returns a condensed version, or a hard-truncated fallback if the call fails.
 */
export async function summarizeForSlack(text: string): Promise<string> {
  const maxChars = 39000; // Slack message limit is ~40k; leave headroom

  const prompt = `The following text needs to be posted to Slack but is too long. Condense it to fit within ${maxChars} characters while preserving the most important information. Keep the same general structure and tone. Output ONLY the condensed text, nothing else.

Text to condense:
${text}`;

  try {
    let summary = "";
    let lastAssistantText = "";

    for await (const message of clackQuery({
      prompt,
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        model: "haiku",
        permissionMode: "bypassPermissions",
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
        summary = message.result || lastAssistantText;
      }
    }

    const result = summary.trim();
    if (result) return result;
  } catch (error) {
    logger.error("Error summarizing text for Slack:", error);
  }

  // Fallback: hard truncate
  return text.substring(0, maxChars) + "\n\n(truncated — full output was too long for Slack)";
}

/**
 * Analyzes an error trace using Claude to get a brief explanation of what went wrong.
 * Uses a lightweight model for quick analysis.
 */
export async function analyzeError(
  errorMessage: string,
  conversationTrace: ConversationMessage[]
): Promise<string> {
  // Format trace for analysis (last 10 messages)
  const recentTrace = conversationTrace.slice(-10);
  const traceText = recentTrace
    .map((m) => {
      let line = `[${m.type}${m.subtype ? `:${m.subtype}` : ""}] ${m.content}`;
      if (m.toolCall) {
        line += `\n  Tool: ${m.toolCall.tool}(${JSON.stringify(m.toolCall.args).substring(0, 200)})`;
        if (Object.keys(m.toolCall.result).length > 0) {
          line += `\n  Result: ${JSON.stringify(m.toolCall.result).substring(0, 200)}`;
        }
      }
      return line;
    })
    .join("\n");

  const prompt = `Analyze this error from a Claude Agent SDK session and provide a brief (2-3 sentence) explanation of what likely went wrong.

Error: ${errorMessage}

Conversation trace (last ${recentTrace.length} messages):
${traceText}

Provide a concise, non-technical explanation suitable for a user who encountered this error.`;

  try {
    let analysis = "";
    let lastAssistantText = "";

    for await (const message of clackQuery({
      prompt,
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        model: "haiku", // Use fast, cheap model for analysis
        permissionMode: "bypassPermissions",
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
        analysis = message.result || lastAssistantText;
      }
    }

    return analysis.trim() || "Unable to analyze the error.";
  } catch (error) {
    logger.error("Error analyzing error trace:", error);
    return "Error analysis unavailable.";
  }
}
