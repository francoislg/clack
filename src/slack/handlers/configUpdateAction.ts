import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession } from "../../sessions.js";
import { decodeActionValue } from "../blocks.js";
import { restoreSessionInfo } from "../state.js";
import { writeInstructionFile } from "../../configurationFiles.js";
import type { StagedConfigUpdateIntent } from "../../tools/types.js";

async function resolveConfigUpdateIntent(sessionId: string, ref: string): Promise<StagedConfigUpdateIntent | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  const intents = (session as unknown as Record<string, unknown>).stagedIntents as Record<string, unknown> | undefined;
  if (!intents || !intents[ref]) return null;

  const intent = intents[ref] as StagedConfigUpdateIntent;
  if (intent.type !== "config_update") return null;

  return intent;
}

export function registerConfigUpdateActionHandler(app: App): void {
  app.action<BlockAction>(/^clack_config_update_\d+$/, async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, ref } = decodeActionValue(rawValue);
    const userId = body.user.id;

    if (!ref) {
      logger.error("Config update handler: missing ref");
      return;
    }

    await respond({ delete_original: true });

    const sessionInfo = await restoreSessionInfo(sessionId);
    if (!sessionInfo) {
      logger.error(`Config update handler: could not restore session ${sessionId}`);
      return;
    }

    const intent = await resolveConfigUpdateIntent(sessionId, ref);
    if (!intent) {
      logger.error(`Config update handler: could not resolve intent ref ${ref}`);
      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: userId,
        thread_ts: sessionInfo.threadTs,
        text: "Sorry, this config update request has expired. Please try again.",
      });
      return;
    }

    try {
      writeInstructionFile(intent.file, intent.content);

      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: userId,
        thread_ts: sessionInfo.threadTs,
        text: `Configuration file \`${intent.file}\` has been updated successfully.`,
      });
    } catch (error) {
      logger.error("Failed to write instruction file:", error);
      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: userId,
        thread_ts: sessionInfo.threadTs,
        text: `Failed to update \`${intent.file}\`: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  });
}
