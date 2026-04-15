import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { truncate } from "../text.js";
import type { StreamEvent } from "../streaming/types.js";
import type { ToolCallRecord } from "../tools/types.js";

export interface ToolUseInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedMessage {
  toolUses: ToolUseInfo[];
  assistantText: string | null;
  /**
   * Tool calls whose `tool_result` arrived during this message, paired with the matching
   * `tool_use` args from an earlier message. One entry per completed call. Populated for ALL
   * tools the SDK dispatches (built-ins, clack MCP, plugin MCP, external MCP).
   */
  completedToolCalls: ToolCallRecord[];
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
  return truncate(text, MAX_LENGTH);
}

/**
 * Stateful parser for SDK messages that emits StreamEvents and extracts
 * structured tool/text info. Used by both askClaude (query mode) and
 * runClaude (worker mode) to ensure identical tool event handling.
 */
interface PendingToolUse {
  name: string;
  args: ToolUseInfo["args"];
  startedAt: number;
}

interface ToolResultTextBlock {
  type: "text";
  text: string;
}

interface ToolResultOtherBlock {
  type: string;
  text?: string;
}

type ToolResultContent = string | Array<ToolResultTextBlock | ToolResultOtherBlock>;

// Cap per-record serialized size so image blocks or large binary tool_results don't bloat
// session files. Text results routinely exceed 10k; tool_call recorder is for debugging shape,
// not preserving every byte. 100k is generous for text, aggressive enough to skip binaries.
const TOOL_RESULT_MAX_CHARS = 100_000;

/**
 * Normalize a tool_result block's content field into a string for record storage.
 * tool_result content can be a plain string or an array of content blocks (text/image).
 * Truncates to TOOL_RESULT_MAX_CHARS to avoid bloating session files on large/binary results.
 */
function stringifyToolResultContent(content: ToolResultContent | null | undefined): string {
  if (content == null) return "";
  const raw = typeof content === "string" ? content : joinContentBlocks(content);
  if (raw.length <= TOOL_RESULT_MAX_CHARS) return raw;
  return `${raw.slice(0, TOOL_RESULT_MAX_CHARS)}… [truncated — ${raw.length - TOOL_RESULT_MAX_CHARS} chars elided]`;
}

function joinContentBlocks(blocks: Array<ToolResultTextBlock | ToolResultOtherBlock>): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
      parts.push(block.text);
    } else {
      parts.push(JSON.stringify(block));
    }
  }
  return parts.join("\n");
}

export class ClaudeMessageParser {
  private emittedToolIds = new Set<string>();
  private _lastAssistantText = "";
  private _result: ParsedResult | null = null;
  private onEvent?: (event: StreamEvent) => void | Promise<void>;
  private pendingToolUses = new Map<string, PendingToolUse>();

  constructor(onEvent?: (event: StreamEvent) => void | Promise<void>) {
    this.onEvent = onEvent;
  }

  get lastAssistantText(): string {
    return this._lastAssistantText;
  }

  get result(): ParsedResult | null {
    return this._result;
  }

  async process(message: SDKMessage): Promise<ParsedMessage> {
    const parsed: ParsedMessage = { toolUses: [], assistantText: null, completedToolCalls: [] };

    // 1. tool_progress — emit tool_start early with empty args if not already seen
    if (message.type === "tool_progress" && this.onEvent) {
      const { tool_use_id: toolUseId, tool_name: toolName } = message;
      if (toolUseId && !this.emittedToolIds.has(toolUseId)) {
        this.emittedToolIds.add(toolUseId);
        await this.onEvent({ type: "tool_start", taskId: toolUseId, toolName, toolArgs: {} });
      }
    }

    // 2. assistant — extract tool_use blocks and text blocks
    if (message.type === "assistant") {
      const content = message.message.content;
      this._lastAssistantText = "";
      for (const block of content) {
        if (block.type === "tool_use") {
          const toolName = block.name || "unknown";
          const toolArgs =
            typeof block.input === "object" && block.input !== null
              ? (block.input as Record<string, unknown>)
              : {};
          const taskId = block.id;

          parsed.toolUses.push({ id: taskId, name: toolName, args: toolArgs });
          if (taskId) {
            this.pendingToolUses.set(taskId, {
              name: toolName,
              args: toolArgs,
              startedAt: Date.now(),
            });
          }

          if (this.onEvent && taskId) {
            if (!this.emittedToolIds.has(taskId)) {
              this.emittedToolIds.add(taskId);
              await this.onEvent({ type: "tool_start", taskId, toolName, toolArgs });
            } else if (Object.keys(toolArgs).length > 0) {
              // Already emitted from tool_progress with empty args — re-emit with real args
              await this.onEvent({ type: "tool_start", taskId, toolName, toolArgs });
            }
          }
        } else if ("text" in block && typeof block.text === "string" && block.text) {
          this._lastAssistantText += block.text;
        }
      }
      parsed.assistantText = this._lastAssistantText;
    }

    // 3. user — extract tool_result blocks, pair with pending tool_use, emit tool_end
    if (message.type === "user") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === "object" && block.type === "tool_result") {
            const isError = block.is_error === true;
            const rawContent = block.content as ToolResultContent | null | undefined;
            const resultText = stringifyToolResultContent(rawContent);

            const pending = this.pendingToolUses.get(block.tool_use_id);
            if (pending) {
              this.pendingToolUses.delete(block.tool_use_id);
              parsed.completedToolCalls.push({
                tool: pending.name,
                args: pending.args,
                result: isError ? { error: resultText } : { content: resultText },
                timestamp: pending.startedAt,
              });
            }

            if (!this.onEvent) continue;
            const errorMessage = isError ? extractToolErrorMessage(block.content) : undefined;
            await this.onEvent({
              type: "tool_end",
              taskId: block.tool_use_id,
              error: isError,
              errorMessage,
            });
          }
        }
      }
    }

    // 4. result — capture into _result
    if (message.type === "result") {
      if (message.subtype === "success") {
        this._result = { success: true, text: message.result || "" };
      } else {
        const errorMsg = message.errors.join(", ") || "Unknown error";
        this._result = { success: false, text: "", error: errorMsg };
      }
    }

    return parsed;
  }
}
