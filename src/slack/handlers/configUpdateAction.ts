import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getStagedIntent } from "../../sessions.js";
import type { StagedConfigUpdateIntent, StagedIntent } from "../../tools/types.js";
import { getRole } from "../../roles.js";
import { canEditConfig } from "../../permissions.js";
import { decodeActionValue } from "../blocks.js";
import { stripClickedButton } from "../stripClickedButton.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import {
  writeInstructionFile,
  deleteInstructionFile,
  readInstructionFile,
} from "../../configurationFiles.js";
import { errorMessage } from "../../errors.js";
import { t } from "../../i18n/t.js";
import type { UserRole } from "../../roles.js";

export interface ConfigUpdateActionDeps {
  getRole: (userId: string) => Promise<UserRole>;
  canEditConfig: (role: UserRole) => boolean;
  decodeActionValue: (value: string) => { sessionId: string; ref?: string };
  restoreSession: (sessionId: string) => Promise<SessionInfo | undefined>;
  getStagedIntent: (sessionId: string, ref: string) => Promise<StagedIntent | null>;
  writeInstructionFile: (filename: string, content: string) => void;
  deleteInstructionFile: (filepath: string) => void;
  readInstructionFile: (filepath: string) => {
    default_content: string | null;
    custom_content: string | null;
  };
  errorMessage: (err: unknown) => string;
}

export const defaultConfigUpdateActionDeps: ConfigUpdateActionDeps = {
  getRole,
  canEditConfig,
  decodeActionValue,
  restoreSession: (sessionId: string) => activeSessions.restore(sessionId),
  getStagedIntent,
  writeInstructionFile,
  deleteInstructionFile,
  readInstructionFile,
  errorMessage,
};

export interface ConfigApplyContext {
  postEphemeral: (args: {
    channel: string;
    user: string;
    thread_ts?: string;
    text: string;
  }) => Promise<void>;
  channelId: string;
  threadTs: string;
  userId: string;
}

type ApplyDeps = Pick<
  ConfigUpdateActionDeps,
  "writeInstructionFile" | "deleteInstructionFile" | "readInstructionFile" | "errorMessage"
>;

/**
 * Apply a staged `config_update` intent. Branches on `operation`:
 *  - "delete": removes the override; success message reflects revert-to-default vs file-deleted.
 *  - "write":  writes the content (used by both append and replace at the tool layer).
 * On failure, posts an ephemeral error and swallows the throw.
 */
export async function applyConfigUpdateIntent(
  intent: StagedConfigUpdateIntent,
  ctx: ConfigApplyContext,
  deps: ApplyDeps,
): Promise<void> {
  if (intent.operation === "delete") {
    const { default_content } = deps.readInstructionFile(intent.file);
    try {
      deps.deleteInstructionFile(intent.file);
      await ctx.postEphemeral({
        channel: ctx.channelId,
        user: ctx.userId,
        thread_ts: ctx.threadTs,
        text:
          default_content !== null
            ? t("errors.config_override_removed", { file: intent.file })
            : t("errors.config_file_deleted", { file: intent.file }),
      });
    } catch (error) {
      logger.error("Failed to delete instruction file:", error);
      await ctx.postEphemeral({
        channel: ctx.channelId,
        user: ctx.userId,
        thread_ts: ctx.threadTs,
        text: t("errors.config_delete_failed", {
          file: intent.file,
          error: deps.errorMessage(error),
        }),
      });
    }
    return;
  }

  try {
    deps.writeInstructionFile(intent.file, intent.content);
    await ctx.postEphemeral({
      channel: ctx.channelId,
      user: ctx.userId,
      thread_ts: ctx.threadTs,
      text: t("errors.config_updated", { file: intent.file }),
    });
  } catch (error) {
    logger.error("Failed to write instruction file:", error);
    await ctx.postEphemeral({
      channel: ctx.channelId,
      user: ctx.userId,
      thread_ts: ctx.threadTs,
      text: t("errors.config_update_failed", {
        file: intent.file,
        error: deps.errorMessage(error),
      }),
    });
  }
}

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
        text: t("errors.config_update_permission_denied"),
      });
      return;
    }

    if (!ref) {
      logger.error("Config update handler: missing ref");
      return;
    }

    const stripped = stripClickedButton(body.message, body.actions[0]?.action_id);
    if (stripped) {
      await respond({ replace_original: true, ...stripped });
    }

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
        text: t("errors.config_update_request_expired"),
      });
      return;
    }

    await applyConfigUpdateIntent(
      intent,
      {
        postEphemeral: async (args) => {
          await client.chat.postEphemeral(args);
        },
        channelId: sessionInfo.channelId,
        threadTs: sessionInfo.threadTs,
        userId,
      },
      deps,
    );
  });
}
