import { clackQuery as _clackQuery } from "./query.js";
import { logger } from "../logger.js";
import { truncate } from "../text.js";
import { detectRuntime } from "./utilities.js";
import type { EphemeralAttentionLevel } from "../ephemeralRules.js";
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

const CLASSIFIER_DISALLOWED_TOOLS = [
  "Write",
  "Edit",
  "NotebookEdit",
  "Bash",
  "Task",
  "TaskOutput",
  "Read",
  "Glob",
  "Grep",
];

function buildConversationContext(recentMessages?: PreAnalysisMessage[]): string {
  if (!recentMessages || recentMessages.length === 0) return "";
  const lines = recentMessages.map(
    (m) => `[${m.ts ? formatRelativeAge(m.ts) + " " : ""}${m.author}]: ${m.text}`,
  );
  return `\n\nRECENT CHANNEL HISTORY (oldest first):\n${lines.join("\n")}`;
}

function buildTimingLine(
  botName: string,
  location: "thread" | "channel",
  secondsSinceLastBotMessage?: number,
): string {
  if (secondsSinceLastBotMessage == null) return "";
  return `\n\nTIMING: this message arrived ${formatElapsedSeconds(secondsSinceLastBotMessage)} after ${botName}'s last message in this ${location}.`;
}

type ClassifierRun =
  | { ok: true; text: string }
  | { ok: false; reason: "error" | "no_result" | "non_success" };

/** Drive one single-turn classifier call and normalize the outcome: the lowercased result
 *  text on success, or the failure reason. Verdict mapping stays with each caller. */
async function runClassifierQuery(
  systemPrompt: string,
  prompt: string,
  deps: PreAnalysisDeps,
): Promise<ClassifierRun> {
  try {
    let lastAssistantText = "";

    for await (const message of deps.clackQuery({
      prompt,
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        model: "sonnet",
        systemPrompt,
        disallowedTools: CLASSIFIER_DISALLOWED_TOOLS,
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
        if (message.subtype !== "success") return { ok: false, reason: "non_success" };
        return { ok: true, text: resultText };
      }
    }

    return { ok: false, reason: "no_result" };
  } catch (error) {
    logger.warn("Classifier call failed:", error);
    return { ok: false, reason: "error" };
  }
}

function buildClassifyPrompt(
  conversationContext: string,
  timingLine: string,
  messageText: string,
  messageAuthor: string,
  channelName?: string,
): string {
  return `${conversationContext}${timingLine}\n\nMESSAGE TO CLASSIFY:${channelName ? `\nChannel: #${channelName}` : ""}\nFrom: ${messageAuthor}\n\n"""${messageText}"""`;
}

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

  const conversationContext = buildConversationContext(recentMessages);
  const timingLine = buildTimingLine(botName, "thread", secondsSinceLastBotMessage);

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

  const run = await runClassifierQuery(
    systemPrompt,
    buildClassifyPrompt(conversationContext, timingLine, messageText, messageAuthor, channelName),
    deps,
  );
  if (!run.ok) {
    logger.warn(`Pre-analysis: ${run.reason} for "${truncate(messageText, 50)}"`);
    return "skip";
  }

  logger.info(
    `Pre-analysis result: text="${run.text}", message="${truncate(messageText, 50)}"${slackLink ?? ""}`,
  );
  if (run.text.includes("respond")) return "respond";
  // "stop" (auto-disengage) is honored only at the low rung; higher rungs never
  // disengage via the cheap gate, so any stray "stop" there falls through to "skip".
  if (level === "low" && run.text.includes("stop")) return "stop";
  return "skip";
}

function buildChannelContinuationPolicyBlock(
  botName: string,
  level: EphemeralAttentionLevel,
): string {
  const lean =
    level === "high"
      ? `LEAN: this conversation window is at HIGH attention — the channel is actively talking with ${botName}. Classify as "respond" anything plausibly aimed at ${botName} or continuing the anchor topic; "skip" only messages clearly about something else.`
      : level === "medium"
        ? `LEAN: this conversation window is at MEDIUM attention. Classify as "respond" a message that engages the anchor topic or ${botName}'s last channel message; when a message is ambiguous, prefer "skip" — a channel is a shared space and most messages are not for ${botName}.`
        : `LEAN: this conversation window is at LOW attention — it is winding down. Classify as "respond" ONLY direct address or an unmistakable continuation of the anchor conversation; everything ambiguous is "skip".`;

  return `${lean}

Then classify the message:
- "respond" — part of the conversation ${botName}'s anchor post started: a reply to it, a follow-up on its topic, or a message directed at ${botName}.
- "skip" — ordinary channel traffic about something else. This is the DEFAULT: in a channel, unrelated is the norm, and a "skip" costs nothing.
- "stop" — the conversation is explicitly closed ("thanks, all set", "we're done here") or the channel has clearly and durably moved on from the anchor topic.`;
}

/**
 * Channel-continuation gate for ephemeral conversation windows: unlike the thread gate,
 * the message is TOP-LEVEL channel traffic, so unrelatedness is the default prior — the
 * question is whether this message is part of the conversation the bot's anchor post
 * started. Returns null when the classifier call fails, so the caller leaves the rule
 * untouched (no ratchet, no deletion) instead of treating the failure as a verdict.
 */
export async function runChannelContinuationPreAnalysis(
  messageText: string,
  messageAuthor: string,
  botName: string,
  anchorText: string,
  level: EphemeralAttentionLevel,
  sharedContext?: string,
  recentMessages?: PreAnalysisMessage[],
  channelName?: string,
  slackLink?: string,
  secondsSinceLastBotMessage?: number,
  deps: PreAnalysisDeps = defaultPreAnalysisDeps,
): Promise<PreAnalysisResult | null> {
  const conversationContext = buildConversationContext(recentMessages);
  const timingLine = buildTimingLine(botName, "channel", secondsSinceLastBotMessage);

  const systemPrompt = `You are a classifier. You output exactly one word, nothing else.

A Slack bot named "${botName}" recently posted a top-level message in this channel and is temporarily following the conversation it started. The message you are classifying is a NEW TOP-LEVEL CHANNEL MESSAGE — not a thread reply. In a channel, most messages are NOT about the bot's post; unrelatedness is the default assumption. Your job: decide whether this message is part of the conversation the bot's post started.

THE BOT'S ANCHOR POST (judge relatedness against this, not just vibes):
"""${anchorText}"""

HIGHEST-PRIORITY SIGNAL — DIRECT ADDRESS: if the message names ${botName} in plain text ("${botName}, ...", "hey ${botName}") or is an imperative or question that only makes sense aimed at ${botName}'s post, it is part of the conversation — "respond". (A passing mention like "I'll ask ${botName} later" is NOT direct address.)

${buildChannelContinuationPolicyBlock(botName, level)}

TIMING: weigh the gap since ${botName} last spoke as a decaying lean. A message minutes after the bot's post is plausibly a reply to it — lean "respond" for ambiguous cases. After hours (including overnight), the lean is gone: only clear topical linkage to the anchor post or direct address earns "respond". Elapsed time alone is never a reason for "stop".
${sharedContext ? `\n${sharedContext}\n` : ""}
OUTPUT FORMAT: The single word "respond", "skip", or "stop". Nothing else.`;

  const run = await runClassifierQuery(
    systemPrompt,
    buildClassifyPrompt(conversationContext, timingLine, messageText, messageAuthor, channelName),
    deps,
  );
  if (!run.ok) {
    logger.warn(
      `Channel-continuation pre-analysis: ${run.reason} for "${truncate(messageText, 50)}"`,
    );
    return null;
  }

  logger.info(
    `Channel-continuation pre-analysis: text="${run.text}", message="${truncate(messageText, 50)}"${slackLink ?? ""}`,
  );
  if (run.text.includes("respond")) return "respond";
  if (run.text.includes("stop")) return "stop";
  return "skip";
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

  const conversationContext = buildConversationContext(recentMessages);
  const timingLine = buildTimingLine(botName, "thread", secondsSinceLastBotMessage);

  const systemPrompt = `You are a classifier. You output exactly one word, nothing else.

A Slack bot named "${botName}" is currently producing a response in this thread. Your job: decide whether a new incoming message should be APPENDED onto ${botName}'s running turn (so the model sees it and folds it into its current answer), or SKIPPED (the message is unrelated chatter that ${botName} should ignore).

DIRECT ADDRESS: if the message names ${botName} in plain text ("${botName}, ...", "come on ${botName}") or is an imperative or question that only makes sense aimed at ${botName}, it is directed at the bot — always "append", never "skip". (A bare mention of the name in passing, like "I'll ask ${botName} later", is NOT direct address.)

Bias toward APPEND — the user is actively engaged with the bot in this thread, and the cost of skipping a relevant message is high. Only SKIP when the message is clearly unrelated cross-talk, an emoji-only acknowledgement that adds no information, or a side conversation between other users that doesn't address ${botName}.

- "append" — the message is from the user engaging with ${botName}: a clarification, a follow-up question, additional context, a course-correction, even a "wait, also do X". Default to this.
- "skip" — the message is unrelated cross-talk, an empty acknowledgement, or clearly directed at someone else.

TIMING: when you are told how long ago ${botName} last spoke in this thread, treat a short gap as a strong signal the message is a direct reply — lean to "append". A longer gap weakens that lean but is never on its own a reason to "skip".

${contextSection}

OUTPUT FORMAT: The single word "append" or "skip". Nothing else.`;

  const run = await runClassifierQuery(
    systemPrompt,
    buildClassifyPrompt(conversationContext, timingLine, messageText, messageAuthor, channelName),
    deps,
  );
  if (!run.ok) {
    logger.warn(`Active-run pre-analysis: ${run.reason} for "${truncate(messageText, 50)}"`);
    return "append";
  }

  logger.info(
    `Active-run pre-analysis: text="${run.text}", message="${truncate(messageText, 50)}"${slackLink ?? ""}`,
  );
  if (run.text.includes("skip")) return "skip";
  return "append";
}
