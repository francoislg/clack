// Messaging surface of the plugin SDK (sibling of users/memory surfaces) — bridge file.

import type { ChatPostMessageArguments } from "@slack/web-api";
import { unfurlOptions } from "../../slack/unfurlOptions.js";
import { logger } from "../../logger.js";
import { detectRuntime } from "../../claude/utilities.js";
import type {
  AskClaudeOptions,
  AskClaudeResult,
  ClackSdk,
  ClackSdkDeps,
  PluginLogger,
  SendMessageOptions,
  SendMessageResult,
  StartThreadConversationOptions,
} from "../sdk.js";
import type { AttentionLevel } from "../../sessions.js";

export function createMessagingSurface(
  pluginName: string,
  pluginLogger: PluginLogger,
  deps: Pick<
    ClackSdkDeps,
    | "clackQuery"
    | "getSlackClient"
    | "loadRoles"
    | "openDmChannel"
    | "registerThreadSession"
    | "startThreadConversation"
  >,
): Pick<
  ClackSdk,
  "askClaude" | "dmOwner" | "sendMessage" | "startThreadConversation" | "engageThread"
> {
  return {
    async askClaude(opts: AskClaudeOptions): Promise<AskClaudeResult> {
      const promptParts: string[] = [];
      if (opts.system !== undefined && opts.system.length > 0) {
        promptParts.push(opts.system);
      }
      for (const m of opts.messages) {
        promptParts.push(m.content);
      }
      const prompt = promptParts.join("\n\n");

      let text = "";
      let lastAssistantText = "";
      let stopReason = "unknown";
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const message of deps.clackQuery({
        prompt,
        options: {
          cwd: process.cwd(),
          executable: detectRuntime(),
          model: opts.model,
          permissionMode: "bypassPermissions",
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
          if (message.subtype === "success") {
            stopReason = "end_turn";
            text = (message.result || lastAssistantText).trim();
          } else {
            stopReason = message.subtype ?? "error";
            text = lastAssistantText.trim();
          }
          if (message.usage) {
            inputTokens = message.usage.input_tokens ?? 0;
            outputTokens = message.usage.output_tokens ?? 0;
          }
        }
      }

      return {
        text,
        stopReason,
        usage: { inputTokens, outputTokens },
      };
    },

    async dmOwner(
      text: string,
      options: { suppressUnfurls?: boolean } = {},
    ): Promise<{ ok: true } | { ok: false; error: string }> {
      const client = deps.getSlackClient();
      if (!client) {
        const error = "Slack client is not connected";
        logger.warn(`[plugin:${pluginName}] dmOwner failed: ${error}`);
        return { ok: false, error };
      }

      const roles = await deps.loadRoles();
      if (!roles.owner) {
        const error = "No owner is configured (set one via the Home Tab)";
        logger.warn(`[plugin:${pluginName}] dmOwner failed: ${error}`);
        return { ok: false, error };
      }

      const dmChannelId = await deps.openDmChannel(client, roles.owner);
      if (!dmChannelId) {
        const error = `Could not open a DM with the owner (${roles.owner})`;
        logger.warn(`[plugin:${pluginName}] dmOwner failed: ${error}`);
        return { ok: false, error };
      }

      try {
        await client.chat.postMessage({
          channel: dmChannelId,
          text,
          ...unfurlOptions(options.suppressUnfurls),
        });
        return { ok: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(`[plugin:${pluginName}] dmOwner postMessage failed: ${error}`);
        return { ok: false, error };
      }
    },

    async engageThread(
      channel: string,
      threadTs: string,
      opts: { attentionLevel?: AttentionLevel; creationContext?: string },
    ): Promise<void> {
      if (!opts.attentionLevel || opts.attentionLevel === "off" || !deps.registerThreadSession) {
        return;
      }
      await deps.registerThreadSession(channel, threadTs, {
        attentionLevel: opts.attentionLevel,
        ...(opts.creationContext !== undefined && { creationContext: opts.creationContext }),
      });
    },

    async sendMessage(opts: SendMessageOptions): Promise<SendMessageResult> {
      const hasText = opts.text !== undefined && opts.text.length > 0;
      const hasBlocks = opts.blocks !== undefined && opts.blocks.length > 0;
      if (!hasText && !hasBlocks) {
        const error = "sendMessage requires text or blocks";
        logger.warn(`[plugin:${pluginName}] sendMessage failed: ${error}`);
        return { ok: false, error };
      }

      const client = deps.getSlackClient();
      if (!client) {
        const error = "Slack client is not connected";
        logger.warn(`[plugin:${pluginName}] sendMessage failed: ${error}`);
        return { ok: false, error };
      }

      try {
        // Cast to the Slack union: it requires text OR blocks non-optional, which
        // we've guaranteed at runtime above but TS can't narrow through the spread.
        const args = {
          channel: opts.channel,
          ...(opts.text !== undefined ? { text: opts.text } : {}),
          ...(opts.blocks !== undefined ? { blocks: opts.blocks } : {}),
          ...(opts.threadTs !== undefined ? { thread_ts: opts.threadTs } : {}),
          ...unfurlOptions(opts.suppressUnfurls),
        } as ChatPostMessageArguments;
        const res = await client.chat.postMessage(args);
        if (!res.ok || typeof res.ts !== "string") {
          const error = `chat.postMessage returned ${res.ok ? "no ts" : "ok=false"}`;
          logger.warn(`[plugin:${pluginName}] sendMessage failed: ${error}`);
          return { ok: false, error };
        }
        return {
          ok: true,
          ts: res.ts,
          channel: typeof res.channel === "string" ? res.channel : opts.channel,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(`[plugin:${pluginName}] sendMessage failed: ${error}`);
        return { ok: false, error };
      }
    },

    async startThreadConversation(opts: StartThreadConversationOptions): Promise<void> {
      const run = deps.startThreadConversation;
      if (!run) {
        pluginLogger.warn(
          "startThreadConversation called but no handler was wired into ClackSdkDeps — ignoring",
        );
        return;
      }
      const client = deps.getSlackClient();
      if (!client) {
        pluginLogger.warn(
          "startThreadConversation called before the Slack client connected — ignoring",
        );
        return;
      }
      await run({
        client,
        channel: opts.channel,
        threadTs: opts.threadTs,
        userId: opts.userId,
        prompt: opts.prompt,
        ...(opts.additionalSystemPrompt !== undefined
          ? { additionalSystemPrompt: opts.additionalSystemPrompt }
          : {}),
        ...(opts.attentionLevel !== undefined ? { attentionLevel: opts.attentionLevel } : {}),
      });
    },
  };
}
