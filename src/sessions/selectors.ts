import type {
  SessionContext,
  SessionMessage,
  SessionUserMessage,
  SessionAssistantMessage,
  SessionTrigger,
} from "../sessions.js";
import type { SubmitResponsePayload } from "../tools/types.js";

function allMessages(session: SessionContext): SessionMessage[] {
  return session.messages ?? [];
}

export function conversationLog(session: SessionContext): SessionMessage[] {
  return allMessages(session);
}

/** Raw text of the trigger — `messageText` for user-first types, `prompt` for scheduled. */
export function triggerText(session: SessionContext): string {
  const t: SessionTrigger = session.trigger;
  if (t.type === "scheduled") return t.prompt;
  return t.messageText;
}

/** Synthesize a virtual first user message from the trigger, so downstream code that wants
 *  "the thing that started the conversation" keeps a uniform shape. The synthesized message
 *  is NOT appended to `messages[]` — it's derived on read only. */
export function firstUserMessage(session: SessionContext): SessionUserMessage {
  const t: SessionTrigger = session.trigger;
  return {
    role: "user",
    source: "reply",
    text: t.type === "scheduled" ? t.prompt : t.messageText,
    ts: session.createdAt,
  };
}

export function latestAssistantMessage(
  session: SessionContext,
): SessionAssistantMessage | undefined {
  const messages = allMessages(session);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") return m;
  }
  return undefined;
}

export function latestAssistantText(session: SessionContext): string | undefined {
  const m = latestAssistantMessage(session);
  if (!m) return undefined;
  if (m.text) return m.text;
  if (m.payload?.message) return m.payload.message;
  return undefined;
}

export function latestAssistantPayload(session: SessionContext): SubmitResponsePayload | undefined {
  return latestAssistantMessage(session)?.payload;
}

export function userContinuations(session: SessionContext): SessionUserMessage[] {
  return allMessages(session).filter((m): m is SessionUserMessage => m.role === "user");
}
