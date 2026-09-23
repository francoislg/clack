import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

export type ResultOutcome = { ok: true; text: string } | { ok: false; error: string };

/**
 * How a turn ended. A turn that ends on an API error is reported with subtype "success",
 * `is_error: true`, and the error text in `result`, so the subtype alone doesn't mean success.
 */
export function resultOutcome(message: SDKResultMessage): ResultOutcome {
  if (message.subtype !== "success") {
    return { ok: false, error: message.errors.join(", ") || message.subtype };
  }
  if (message.is_error) {
    const status = message.api_error_status ? ` (HTTP ${message.api_error_status})` : "";
    return { ok: false, error: `${message.result || "API error"}${status}` };
  }
  return { ok: true, text: message.result };
}

/**
 * A consumed one-shot query. `text` is the result text, or the last assistant message's text
 * when the result carries none (and on failure); `result` is absent when the stream ended
 * without a result message.
 */
export type CollectedTurn = ResultOutcome & { text: string; result?: SDKResultMessage };

function assistantText(message: SDKMessage): string | undefined {
  if (message.type !== "assistant" || !message.message?.content) return undefined;
  let text = "";
  for (const block of message.message.content) {
    if ("text" in block && typeof block.text === "string") text += block.text;
  }
  return text;
}

/** Consumes `messages` up to the first result message and reports how the turn ended. */
export async function collectTurn(messages: AsyncIterable<SDKMessage>): Promise<CollectedTurn> {
  let lastAssistantText = "";
  for await (const message of messages) {
    lastAssistantText = assistantText(message) ?? lastAssistantText;
    if (message.type === "result") {
      const outcome = resultOutcome(message);
      return outcome.ok
        ? { ...outcome, text: outcome.text || lastAssistantText, result: message }
        : { ...outcome, text: lastAssistantText, result: message };
    }
  }
  return { ok: false, error: "no result", text: lastAssistantText };
}
