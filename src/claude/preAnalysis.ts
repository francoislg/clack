import { clackQuery as _clackQuery } from "./query.js";
import { logger } from "../logger.js";
import { truncate } from "../text.js";
import { detectRuntime } from "./utilities.js";
import type { SDKMessage, Options } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface PreAnalysisDeps {
  clackQuery: (params: {
    prompt: string;
    options?: Omit<Options, "persistSession" | "resume" | "continue">;
  }) => AsyncIterable<SDKMessage>;
}

export const defaultPreAnalysisDeps: PreAnalysisDeps = {
  clackQuery: _clackQuery,
};

export interface PreAnalysisMessage {
  author: string;
  text: string;
  isBot: boolean;
  /** Slack timestamp (Unix seconds as string, e.g. "1700000000.000001") */
  ts?: string;
}

/** Format a Slack timestamp as a human-readable relative age (e.g. "5m ago", "2h ago"). */
export function formatRelativeAge(ts: string, now = Date.now()): string {
  const ageSeconds = now / 1000 - parseFloat(ts);
  if (ageSeconds < 90) return `${Math.round(ageSeconds)}s ago`;
  const ageMinutes = ageSeconds / 60;
  if (ageMinutes < 90) return `${Math.round(ageMinutes)}m ago`;
  const ageHours = ageMinutes / 60;
  if (ageHours < 48) return `${Math.round(ageHours)}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}

export type PreAnalysisResult = "respond" | "skip" | "stop";

/**
 * Pre-analysis gate for auto-respond: asks Claude whether to skip a message.
 * Returns "respond", "skip", or "stop". Defaults to "skip" on error or ambiguity.
 */
export async function runPreAnalysis(
  messageText: string,
  messageAuthor: string,
  botName: string,
  preAnalysisContext: string,
  sharedContext?: string,
  recentMessages?: PreAnalysisMessage[],
  channelName?: string,
  slackLink?: string,
  deps: PreAnalysisDeps = defaultPreAnalysisDeps,
): Promise<PreAnalysisResult> {
  const contextSection = sharedContext
    ? `${sharedContext}\n\nAdditional context: ${preAnalysisContext}`
    : preAnalysisContext;

  const conversationContext =
    recentMessages && recentMessages.length > 0
      ? `\n\nRECENT CHANNEL HISTORY (oldest first):\n${recentMessages.map((m) => `[${m.ts ? formatRelativeAge(m.ts) + " " : ""}${m.author}]: ${m.text}`).join("\n")}`
      : "";

  const systemPrompt = `You are a classifier. You output exactly one word, nothing else.

A Slack bot named "${botName}" monitors this channel. Your job: decide if ${botName} should SKIP this message, RESPOND to it, or STOP tracking the thread entirely.

First, assess the THREAD TONE from the recent history and any channel context:
- CASUAL/PLAYFUL tone — banter, emojis, informal chatter, lightweight back-and-forth. Thank-yous here invite a warm acknowledgement back.
- SERIOUS/TECHNICAL tone — alerts, incidents, formal questions, investigation threads, production issues, code review, focused task work. Thank-yous here are just closing punctuation; the bot should stay out of the way.

Then classify the message:
- "respond" — the message is directed at ${botName}, is a genuine follow-up question that needs a response, OR is a conversational acknowledgement/thank-you ("ok ty", "thanks!", "👍", "appreciate it") **in a CASUAL/PLAYFUL thread** where a warm reply is natural. In serious threads, thank-yous do NOT warrant a respond.
- "skip" — this message is noise, is between other users, is a thank-you in a SERIOUS thread (stay silent and stay engaged — the thread may still need ${botName} later), or anything else where responding would intrude without clear value.
- "stop" — the conversation has shifted to an unrelated topic with no acknowledgement of ${botName}, OR in a SERIOUS thread the work is clearly wrapped up ("fixed", "shipped", "closing this out", final sign-offs after the real work is done). Also use "stop" for stale, long-dormant threads.

Tie-breakers:
- Respond vs skip → prefer skip (don't intrude).
- Respond vs stop → prefer respond only if the tone is casual; otherwise prefer stop in serious threads and skip in ambiguous ones.
- Skip vs stop → prefer skip when the thread's work may still be live; prefer stop when it's clearly wrapped.

${contextSection}

OUTPUT FORMAT: The single word "skip", "respond", or "stop". Nothing else.`;

  try {
    let lastAssistantText = "";

    for await (const message of deps.clackQuery({
      prompt: `${conversationContext}\n\nMESSAGE TO CLASSIFY:${channelName ? `\nChannel: #${channelName}` : ""}\nFrom: ${messageAuthor}\n\n"""${messageText}"""`,
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        model: "sonnet",
        systemPrompt,
        disallowedTools: [
          "Write",
          "Edit",
          "NotebookEdit",
          "Bash",
          "Task",
          "TaskOutput",
          "Read",
          "Glob",
          "Grep",
        ],
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
        const resultText = ((message as { result?: string }).result || lastAssistantText)
          .trim()
          .toLowerCase();
        logger.info(
          `Pre-analysis result: text="${resultText}", message="${truncate(messageText, 50)}"${slackLink ?? ""}`,
        );
        if (message.subtype !== "success") return "skip";
        if (resultText.includes("respond")) return "respond";
        if (resultText.includes("stop")) return "stop";
        return "skip";
      }
    }

    logger.warn(`Pre-analysis: no result message received for "${truncate(messageText, 50)}"`);
    return "skip";
  } catch (error) {
    logger.warn("Pre-analysis call failed:", error);
    return "skip";
  }
}
