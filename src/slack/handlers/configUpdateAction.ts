import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getStagedIntent } from "../../sessions.js";
import type { StagedIntent } from "../../tools/types.js";
import { getRole } from "../../roles.js";
import { canEditConfig } from "../../permissions.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import { writeInstructionFile } from "../../configurationFiles.js";
import { errorMessage } from "../../errors.js";
import type { UserRole } from "../../roles.js";

export interface ConfigUpdateActionDeps {
  getRole: (userId: string) => Promise<UserRole>;
  canEditConfig: (role: UserRole) => boolean;
  decodeActionValue: (value: string) => { sessionId: string; ref?: string };
  restoreSession: (sessionId: string) => Promise<SessionInfo | undefined>;
  getStagedIntent: (sessionId: string, ref: string) => Promise<StagedIntent | null>;
  writeInstructionFile: (filename: string, content: string) => void;
  errorMessage: (err: unknown) => string;
}

export const defaultConfigUpdateActionDeps: ConfigUpdateActionDeps = {
  getRole,
  canEditConfig,
  decodeActionValue,
  restoreSession: (sessionId: string) => activeSessions.restore(sessionId),
  getStagedIntent,
  writeInstructionFile,
  errorMessage,
};

export function registerConfigUpdateActionHandler(
  app: App,
  deps: ConfigUpdateActionDeps = defaultConfigUpdateActionDeps,
): void {
  app.action<BlockAction>(/^clack_config_update_\d+$/, async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, ref } = deps.decodeActionValue(rawValue);
    const userId = body.user.id;

    // Defense-in-depth: verify the user has admin+ role
    const role = await deps.getRole(userId);
    if (!deps.canEditConfig(role)) {
      await client.chat.postEphemeral({
        channel: body.channel?.id ?? "",
        user: userId,
        text: "You don't have permission to update configuration. Requires admin role or higher.",
      });
      return;
    }

    if (!ref) {
      logger.error("Config update handler: missing ref");
      return;
    }

    await respond({ delete_original: true });

    const sessionInfo = await deps.restoreSession(sessionId);
    if (!sessionInfo) {
      logger.error(`Config update handler: could not restore session ${sessionId}`);
      return;
    }

    const intent = await deps.getStagedIntent(sessionId, ref);
    if (!intent || intent.type !== "config_update") {
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
      deps.writeInstructionFile(intent.file, intent.content);

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
        text: `Failed to update \`${intent.file}\`: ${deps.errorMessage(error)}`,
      });
    }
  });
}
