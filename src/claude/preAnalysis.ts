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

/** Format an elapsed duration in seconds as a compact human-readable string (e.g. "5s", "2h"). */
export function formatElapsedSeconds(ageSeconds: number): string {
  if (ageSeconds < 90) return `${Math.round(ageSeconds)}s`;
  const ageMinutes = ageSeconds / 60;
  if (ageMinutes < 90) return `${Math.round(ageMinutes)}m`;
  const ageHours = ageMinutes / 60;
  if (ageHours < 48) return `${Math.round(ageHours)}h`;
  return `${Math.round(ageHours / 24)}d`;
}

/** Format a Slack timestamp as a human-readable relative age (e.g. "5m ago", "2h ago"). */
export function formatRelativeAge(ts: string, now = Date.now()): string {
  return `${formatElapsedSeconds(now / 1000 - parseFloat(ts))} ago`;
}

export type PreAnalysisResult = "respond" | "skip" | "stop";

/** Verdict for active-run pre-analysis: append the message onto the live run, or skip it. */
export type ActiveRunPreAnalysisResult = "append" | "skip";

/**
 * The attention rungs whose pre-analysis gate actually runs. `"always"` short-circuits (no
 * classifier call) and `"off"` is filtered before the gate, so only these three reach the
 * classifier. The rung selects the POLICY block — its lean and tie-breakers — while the rest
 * of the prompt (direct-address override, thread-tone assessment, timing) is shared.
 * `"stop"` (auto-disengage) is offered ONLY at `"low"`.
 */
export type PreAnalysisLevel = "low" | "medium" | "high";

/** The classify + tie-breaker + output-format section, keyed by attention level. */
function buildPolicyBlock(botName: string, level: PreAnalysisLevel): string {
  if (level === "low") {
    return `Then classify the message:
- "respond" — directed at ${botName} (see above), a genuine follow-up question that needs a response, OR a conversational acknowledgement/thank-you ("ok ty", "thanks!", "👍", "appreciate it") **in a CASUAL/PLAYFUL thread** where a warm reply is natural. In serious threads, thank-yous do NOT warrant a respond.
- "skip" — noise, a message between other users, a thank-you in a SERIOUS thread, or anything else where responding would intrude without clear value. The thread stays engaged — ${botName} may still be needed later. This is the default whenever nothing above clearly applies.
- "stop" — choose this only when the user explicitly signs off ("thanks, all set", "we're done here", "closing this out") or the conversation has clearly moved to a different topic with no involvement from ${botName} across several messages. A serious or technical tone is not by itself a reason to stop, and a thread simply going quiet is not a reason to stop — quiet threads often resume.

Tie-breakers (apply only after the direct-address check):
- Respond vs skip → prefer skip; don't intrude on chatter that isn't aimed at the bot.
- Skip vs stop → prefer skip; keep the thread engaged unless the user has clearly signed off or moved on.`;
  }

  const lean =
    level === "high"
      ? `LEAN: this thread is set to HIGH attention — ${botName} should respond to nearly everything. Only "skip" a message that is unmistakably side-talk between other users with no bearing on ${botName} or the thread topic.`
      : `LEAN: this thread is set to MEDIUM attention — ${botName} should respond whenever a message is plausibly relevant to the thread or to ${botName}'s last answer. "skip" only clear cross-talk between other people or contentless noise.`;

  return `${lean}

Then classify the message:
- "respond" — directed at ${botName} (see above), a genuine follow-up or clarification, a reaction to ${botName}'s last answer, OR a conversational acknowledgement/thank-you where a brief warm reply is natural. When in doubt, prefer "respond".
- "skip" — a message clearly between other users that does not involve ${botName}, or contentless noise (a lone emoji adding nothing). The thread stays engaged regardless.

Tie-breaker (apply only after the direct-address check): respond vs skip → prefer respond; this thread wants ${botName} engaged.`;
}

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
  secondsSinceLastBotMessage?: number,
  deps: PreAnalysisDeps = defaultPreAnalysisDeps,
  level: PreAnalysisLevel = "low",
): Promise<PreAnalysisResult> {
  const contextSection = sharedContext
    ? `${sharedContext}\n\nAdditional context: ${preAnalysisContext}`
    : preAnalysisContext;

  const conversationContext =
    recentMessages && recentMessages.length > 0
      ? `\n\nRECENT CHANNEL HISTORY (oldest first):\n${recentMessages.map((m) => `[${m.ts ? formatRelativeAge(m.ts) + " " : ""}${m.author}]: ${m.text}`).join("\n")}`
      : "";

  const timingLine =
    secondsSinceLastBotMessage != null
      ? `\n\nTIMING: this message arrived ${formatElapsedSeconds(secondsSinceLastBotMessage)} after ${botName}'s last message in this thread.`
      : "";

  const directAddress =
    level === "low"
      ? `A message is DIRECTED AT ${botName} when it names ${botName} in plain text ("${botName}, ...", "come on ${botName}", "hey ${botName}") OR is an imperative or question that only makes sense aimed at ${botName} ("can you retry?", "try it with a worker", "why is it null?"). A directed message is NEVER "skip" — the user is talking to the bot. Pick the verdict by intent: a request, question, or course-correction → "respond"; an explicit sign-off or stop instruction ("${botName}, stop", "ok ${botName}, we're done") → "stop". This takes priority over the thread-tone assessment below. (An explicit <@mention> is handled elsewhere and never reaches you, so a by-name reference is the signal the user wants ${botName} specifically — as opposed to chatter that merely contains the name, like "I'll ask ${botName} later", which is NOT direct address.)`
      : `A message is DIRECTED AT ${botName} when it names ${botName} in plain text ("${botName}, ...", "come on ${botName}", "hey ${botName}") OR is an imperative or question that only makes sense aimed at ${botName} ("can you retry?", "try it with a worker", "why is it null?"). A directed message is ALWAYS "respond" — the user is talking to the bot, whether that's a request, a course-correction, or a sign-off (${botName} replies and can wind the thread down itself). (An explicit <@mention> is handled elsewhere and never reaches you, so a by-name reference is the signal the user wants ${botName} specifically — chatter that merely contains the name, like "I'll ask ${botName} later", is NOT direct address.)`;

  const summaryVerb =
    level === "low"
      ? "SKIP this message, RESPOND to it, or STOP tracking the thread entirely"
      : "SKIP this message or RESPOND to it";
  const outputVerdicts = level === "low" ? `"skip", "respond", or "stop"` : `"skip" or "respond"`;
  const timingTail = level === "low" ? `"skip" or "stop"` : `"skip"`;

  const systemPrompt = `You are a classifier. You output exactly one word, nothing else.

A Slack bot named "${botName}" monitors this channel. Your job: decide if ${botName} should ${summaryVerb}.

HIGHEST-PRIORITY SIGNAL — DIRECT ADDRESS (evaluate this before anything else):
${directAddress}

If the message is NOT directed at ${botName}, assess the THREAD TONE from the recent history and any channel context:
- CASUAL/PLAYFUL tone — banter, emojis, informal chatter, lightweight back-and-forth. Thank-yous here invite a warm acknowledgement back.
- SERIOUS/TECHNICAL tone — alerts, incidents, formal questions, investigation threads, production issues, code review, focused task work. Thank-yous here are just closing punctuation; the bot should stay out of the way.

${buildPolicyBlock(botName, level)}

TIMING: when you are told how long ago ${botName} last spoke in this thread, weigh it as a decaying signal. A message arriving shortly after ${botName}'s last message is very likely a direct reply to it — lean strongly toward "respond". The longer the gap, the weaker that lean — but elapsed time alone is never a reason to ${timingTail}; a reply that lands days later can still be meant for ${botName}.

${contextSection}

OUTPUT FORMAT: The single word ${outputVerdicts}. Nothing else.`;

  try {
    let lastAssistantText = "";

    for await (const message of deps.clackQuery({
      prompt: `${conversationContext}${timingLine}\n\nMESSAGE TO CLASSIFY:${channelName ? `\nChannel: #${channelName}` : ""}\nFrom: ${messageAuthor}\n\n"""${messageText}"""`,
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
        // "stop" (auto-disengage) is honored only at the low rung; higher rungs never
        // disengage via the cheap gate, so any stray "stop" there falls through to "skip".
        if (level === "low" && resultText.includes("stop")) return "stop";
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

/**
 * Active-run pre-analysis gate: when a Claude run is already in flight for this thread,
 * decide whether the new message should be APPENDED to the running conversation (via
 * `handle.sendUpdate`) or SKIPPED entirely. Different from `runPreAnalysis`: there's no
 * "stop" verdict (the live run owns the thread; disengagement isn't this gate's job),
 * and the bias is much lighter — when the user is actively engaged, almost any message
 * they send is plausibly meant for the bot. Default on error/ambiguity is "append" so
 * we err on the side of delivering the message.
 */
export async function runActiveRunPreAnalysis(
  messageText: string,
  messageAuthor: string,
  botName: string,
  preAnalysisContext: string,
  sharedContext?: string,
  recentMessages?: PreAnalysisMessage[],
  channelName?: string,
  slackLink?: string,
  secondsSinceLastBotMessage?: number,
  deps: PreAnalysisDeps = defaultPreAnalysisDeps,
): Promise<ActiveRunPreAnalysisResult> {
  const contextSection = sharedContext
    ? `${sharedContext}\n\nAdditional context: ${preAnalysisContext}`
    : preAnalysisContext;

  const conversationContext =
    recentMessages && recentMessages.length > 0
      ? `\n\nRECENT CHANNEL HISTORY (oldest first):\n${recentMessages.map((m) => `[${m.ts ? formatRelativeAge(m.ts) + " " : ""}${m.author}]: ${m.text}`).join("\n")}`
      : "";

  const timingLine =
    secondsSinceLastBotMessage != null
      ? `\n\nTIMING: this message arrived ${formatElapsedSeconds(secondsSinceLastBotMessage)} after ${botName}'s last message in this thread.`
      : "";

  const systemPrompt = `You are a classifier. You output exactly one word, nothing else.

A Slack bot named "${botName}" is currently producing a response in this thread. Your job: decide whether a new incoming message should be APPENDED onto ${botName}'s running turn (so the model sees it and folds it into its current answer), or SKIPPED (the message is unrelated chatter that ${botName} should ignore).

DIRECT ADDRESS: if the message names ${botName} in plain text ("${botName}, ...", "come on ${botName}") or is an imperative or question that only makes sense aimed at ${botName}, it is directed at the bot — always "append", never "skip". (A bare mention of the name in passing, like "I'll ask ${botName} later", is NOT direct address.)

Bias toward APPEND — the user is actively engaged with the bot in this thread, and the cost of skipping a relevant message is high. Only SKIP when the message is clearly unrelated cross-talk, an emoji-only acknowledgement that adds no information, or a side conversation between other users that doesn't address ${botName}.

- "append" — the message is from the user engaging with ${botName}: a clarification, a follow-up question, additional context, a course-correction, even a "wait, also do X". Default to this.
- "skip" — the message is unrelated cross-talk, an empty acknowledgement, or clearly directed at someone else.

TIMING: when you are told how long ago ${botName} last spoke in this thread, treat a short gap as a strong signal the message is a direct reply — lean to "append". A longer gap weakens that lean but is never on its own a reason to "skip".

${contextSection}

OUTPUT FORMAT: The single word "append" or "skip". Nothing else.`;

  try {
    let lastAssistantText = "";

    for await (const message of deps.clackQuery({
      prompt: `${conversationContext}${timingLine}\n\nMESSAGE TO CLASSIFY:${channelName ? `\nChannel: #${channelName}` : ""}\nFrom: ${messageAuthor}\n\n"""${messageText}"""`,
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
          `Active-run pre-analysis: text="${resultText}", message="${truncate(messageText, 50)}"${slackLink ?? ""}`,
        );
        if (message.subtype !== "success") return "append";
        if (resultText.includes("skip")) return "skip";
        return "append";
      }
    }

    logger.warn(
      `Active-run pre-analysis: no result message received for "${truncate(messageText, 50)}"`,
    );
    return "append";
  } catch (error) {
    logger.warn("Active-run pre-analysis call failed:", error);
    return "append";
  }
}
