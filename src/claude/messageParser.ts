import type { StreamEvent } from "../streaming/types.js";

export interface ToolUseInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedMessage {
  toolUses: ToolUseInfo[];
  assistantText: string | null;
}

export interface ParsedResult {
  success: boolean;
  text: string;
  error?: string;
}

/**
 * Detect known Claude platform error messages that arrive as "successful" text
 * (e.g. rate limits, quota exhaustion). These bypass the SDK's error handling
 * and look like normal assistant output.
 */
export function detectPlatformError(text: string): string | null {
  if (/you've\s+hit\s+your\s+limit/i.test(text) && /resets?\s+\d{1,2}/i.test(text)) {
    return "Claude usage limit reached. The limit resets automatically — please try again later.";
  }
  return null;
}

/**
 * Extract a short error message from a tool_result block's content field.
 * Returns undefined if content is empty or not extractable.
 */
export function extractToolErrorMessage(content: unknown): string | undefined {
  const MAX_LENGTH = 100;
  let text: string | undefined;

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    text = parts.join(" ");
  }

  if (!text || !text.trim()) return undefined;
  text = text.trim();
  return text.length > MAX_LENGTH ? text.substring(0, MAX_LENGTH) + "…" : text;
}

/**
 * Stateful parser for SDK messages that emits StreamEvents and extracts
 * structured tool/text info. Used by both askClaude (query mode) and
 * runClaude (worker mode) to ensure identical tool event handling.
 */
export class ClaudeMessageParser {
  private emittedToolIds = new Set<string>();
  private _lastAssistantText = "";
  private _result: ParsedResult | null = null;
  private onEvent?: (event: StreamEvent) => void | Promise<void>;

  constructor(onEvent?: (event: StreamEvent) => void | Promise<void>) {
    this.onEvent = onEvent;
  }

  get lastAssistantText(): string {
    return this._lastAssistantText;
  }

  get result(): ParsedResult | null {
    return this._result;
  }

  async process(message: { type: string; [key: string]: unknown }): Promise<ParsedMessage> {
    const parsed: ParsedMessage = { toolUses: [], assistantText: null };

    // 1. tool_progress — emit tool_start early with empty args if not already seen
    if (message.type === "tool_progress" && this.onEvent) {
      const toolUseId = message.tool_use_id as string;
      const toolName = message.tool_name as string;
      if (toolUseId && !this.emittedToolIds.has(toolUseId)) {
        this.emittedToolIds.add(toolUseId);
        await this.onEvent({ type: "tool_start", taskId: toolUseId, toolName, toolArgs: {} });
      }
    }

    const msg = message as Record<string, unknown>;
    const innerMsg = msg.message as Record<string, unknown> | undefined;
    const content = innerMsg && typeof innerMsg === "object" ? (innerMsg.content as unknown[]) : undefined;

    // 2. assistant — extract tool_use blocks and text blocks
    if (message.type === "assistant" && Array.isArray(content)) {
      this._lastAssistantText = "";
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;

        if (b.type === "tool_use") {
          const toolName = String(b.name || "unknown");
          const toolArgs = (typeof b.input === "object" && b.input !== null) ? b.input as Record<string, unknown> : {};
          const taskId = b.id ? String(b.id) : undefined;

          parsed.toolUses.push({ id: taskId ?? "", name: toolName, args: toolArgs });

          if (this.onEvent && taskId) {
            if (!this.emittedToolIds.has(taskId)) {
              this.emittedToolIds.add(taskId);
              await this.onEvent({ type: "tool_start", taskId, toolName, toolArgs });
            } else if (Object.keys(toolArgs).length > 0) {
              // Already emitted from tool_progress with empty args — re-emit with real args
              await this.onEvent({ type: "tool_start", taskId, toolName, toolArgs });
            }
          }
        } else if ("text" in b && typeof b.text === "string" && b.text) {
          this._lastAssistantText += b.text;
        }
      }
      parsed.assistantText = this._lastAssistantText;
    }

    // 3. user — extract tool_result blocks and emit tool_end
    if (message.type === "user" && this.onEvent && Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const rb = block as Record<string, unknown>;
        if (rb.type === "tool_result" && rb.tool_use_id) {
          const errorMessage = rb.is_error === true ? extractToolErrorMessage(rb.content) : undefined;
          await this.onEvent({ type: "tool_end", taskId: String(rb.tool_use_id), error: rb.is_error === true, errorMessage });
        }
      }
    }

    // 4. result — capture into _result
    if (message.type === "result") {
      const subtype = (message as Record<string, unknown>).subtype as string | undefined;
      if (subtype === "success") {
        this._result = { success: true, text: (message.result as string) || "" };
      } else {
        const errors = "errors" in message ? (message.errors as string[]) : undefined;
        const errorMsg = errors?.join(", ") ?? "Unknown error";
        this._result = { success: false, text: "", error: errorMsg };
      }
    }

    return parsed;
  }
}
