/**
 * Auto-execute logic for actions flagged with `auto: true`.
 * Extracted from core.ts so it can be shared by processMessage and button handlers.
 */
import type { App } from "@slack/bolt";
import { errorMessage } from "../../errors.js";
import { t } from "../../i18n/t.js";
import type { ClaudeResponse } from "../../claude/index.js";
import type { Action, PostToAction } from "../../tools/types.js";
import type { UserRole } from "../../roles.js";
import type { TriggerType } from "../../changes/types.js";
import { canRequestChanges, canCreateUserSkill, canEditUserSkill } from "../../permissions.js";
import {
  writeUserSkill,
  updateUserSkill,
  disableUserSkill,
  restoreUserSkill,
  readUserSkill,
} from "../../userSkills.js";
import { triggerChangeWorkflow } from "./changeAction.js";
import { triggerFollowUp } from "./changeThreadActions.js";
import { postAnswerToChannel, resolveOrigin } from "./dmActions.js";
import { writeInstructionFile } from "../../configurationFiles.js";
import {
  findSessionByThread,
  getSession,
  updateSession,
  type SessionContext,
} from "../../sessions.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import { logger } from "../../logger.js";
import type { StagedChangeIntent } from "../../tools/types.js";
import type { SlackDeliveryContext } from "./changeAction.js";

export interface AutoExecuteDeps {
  canRequestChanges: (role: UserRole) => boolean;
  canCreateUserSkill: (role: UserRole) => boolean;
  canEditUserSkill: (role: UserRole, ownerId: string, callerId: string) => boolean;
  writeUserSkill: typeof writeUserSkill;
  updateUserSkill: typeof updateUserSkill;
  disableUserSkill: typeof disableUserSkill;
  restoreUserSkill: typeof restoreUserSkill;
  readUserSkill: typeof readUserSkill;
  triggerChangeWorkflow: (intent: StagedChangeIntent, slack: SlackDeliveryContext) => Promise<void>;
  triggerFollowUp: (
    session: SessionContext,
    command: string,
    instructions: string | undefined,
    slack: SlackDeliveryContext,
    deps?: unknown,
    userFeedback?: string,
  ) => Promise<void>;
  postAnswerToChannel: typeof postAnswerToChannel;
  resolveOrigin: (
    session: SessionContext,
    sessionInfo: SessionInfo,
  ) => { originChannel: string | undefined; originThreadTs: string | undefined };
  writeInstructionFile: (filename: string, content: string) => void;
  findSessionByThread: (channelId: string, threadTs: string) => Promise<SessionContext | null>;
  getSession: (sessionId: string) => Promise<SessionContext | null>;
  updateSession: (
    sessionId: string,
    updates: { responseTs: string },
  ) => Promise<SessionContext | null>;
  restoreSession: (sessionId: string) => Promise<SessionInfo | null>;
}

export const defaultAutoExecuteDeps: AutoExecuteDeps = {
  canRequestChanges,
  canCreateUserSkill,
  canEditUserSkill,
  writeUserSkill,
  updateUserSkill,
  disableUserSkill,
  restoreUserSkill,
  readUserSkill,
  triggerChangeWorkflow,
  triggerFollowUp: triggerFollowUp as never,
  postAnswerToChannel,
  resolveOrigin,
  writeInstructionFile,
  findSessionByThread,
  getSession,
  updateSession: updateSession as never,
  restoreSession: (sessionId: string) =>
    activeSessions.restore(sessionId) as Promise<SessionInfo | null>,
};

export interface AutoExecuteParams {
  client: App["client"];
  channelId: string;
  threadTs: string;
  userId: string;
  response: ClaudeResponse;
  /** Unified session ID for looking up active change state */
  sessionId: string;
  role: UserRole;
  /** When set, stream progress to this DM thread instead of the channel thread. */
  dmChannel?: string;
  dmThreadTs?: string;
  /** Original trigger type, propagated to change workflow. */
  triggerType?: TriggerType;
}

/**
 * Check for auto-flagged actions in the response and trigger them immediately.
 * Runs after the response is posted to Slack. Errors are caught and posted
 * to the thread without affecting the already-posted response.
 */
export async function handleAutoExecuteActions(
  params: AutoExecuteParams,
  deps: AutoExecuteDeps = defaultAutoExecuteDeps,
): Promise<void> {
  const {
    client,
    channelId,
    threadTs,
    userId,
    response,
    sessionId: _sessionId,
    role,
    dmChannel,
    dmThreadTs,
    triggerType,
  } = params;

  if (!response.response?.actions) return;

  // Handle post_to auto-execute first — available to all roles, not intent-based
  await handlePostToAutoExecute(params, deps);

  if (!response.stagedIntents) return;

  // Filter to actions that have both `auto: true` and a `ref`
  type AutoAction = Action & { auto: true; ref: string };
  const isAutoRefAction = (a: Action): a is AutoAction => {
    if (!("auto" in a) || !("ref" in a)) return false;
    const withAuto = a as { auto?: unknown };
    return withAuto.auto === true;
  };
  const autoActions = response.response.actions.filter(isAutoRefAction);
  if (autoActions.length === 0) return;

  // Skill-* intents have their own permission model (skill_create is member+, the rest
  // are owner-or-admin checked at apply time). Only block at this layer if there's at
  // least one non-skill auto action that requires the legacy `canRequestChanges` gate.
  const hasNonSkillAuto = autoActions.some((a) => {
    const intent = response.stagedIntents?.[a.ref];
    return intent !== undefined && !intent.type.startsWith("skill_");
  });
  if (hasNonSkillAuto && !deps.canRequestChanges(role)) {
    logger.warn(`Auto-execute blocked for non-privileged role "${role}"`);
    return;
  }

  for (const action of autoActions) {
    const intent = response.stagedIntents[action.ref];
    if (!intent) {
      logger.warn(`Auto-execute: could not resolve intent for ref ${action.ref}`);
      continue;
    }

    try {
      switch (intent.type) {
        case "config_update": {
          logger.info(`Auto-executing config update: ${intent.file}`);
          try {
            deps.writeInstructionFile(intent.file, intent.content);
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: t("errors.config_updated", { file: intent.file }),
            });
          } catch (err) {
            logger.error("Auto-execute config update error:", err);
            await client.chat
              .postMessage({
                channel: channelId,
                thread_ts: threadTs,
                text: t("errors.config_update_failed", {
                  file: intent.file,
                  error: errorMessage(err),
                }),
              })
              .catch(() => {});
          }
          break;
        }

        case "change": {
          logger.info(`Auto-executing change action: ${intent.description}`);
          await deps.triggerChangeWorkflow(intent, {
            channelId,
            threadTs,
            userId,
            client,
            ...(dmChannel && dmThreadTs
              ? { streamChannel: dmChannel, streamThreadTs: dmThreadTs }
              : {}),
            triggerType,
          });
          break;
        }

        case "update": {
          const session = await deps.findSessionByThread(channelId, threadTs);
          if (!session?.activeChange) {
            logger.warn(`Auto-execute update: no active change found in thread`);
            continue;
          }

          logger.info(`Auto-executing update follow-up action`);
          await deps.triggerFollowUp(
            session,
            "update",
            intent.instructions,
            {
              channelId,
              threadTs,
              userId,
              client,
              ...(dmChannel && dmThreadTs
                ? { streamChannel: dmChannel, streamThreadTs: dmThreadTs }
                : {}),
            },
            undefined,
            intent.userFeedback,
          );
          break;
        }

        case "skill_create": {
          if (!deps.canCreateUserSkill(role)) {
            logger.warn(`Auto-execute skill_create blocked for role "${role}"`);
            break;
          }
          try {
            deps.writeUserSkill({
              slug: intent.slug,
              description: intent.description,
              body: intent.body,
              ownerUserId: intent.ownerUserId,
            });
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: t("userSkills.created", { slug: intent.slug }),
            });
          } catch (err) {
            logger.error("Auto-execute skill_create error:", err);
            await client.chat
              .postMessage({
                channel: channelId,
                thread_ts: threadTs,
                text: t("userSkills.create_failed", {
                  slug: intent.slug,
                  error: errorMessage(err),
                }),
              })
              .catch(() => {});
          }
          break;
        }

        case "skill_update": {
          const existing = deps.readUserSkill(intent.slug);
          if (!existing) {
            logger.warn(`Auto-execute skill_update: skill '${intent.slug}' not found`);
            break;
          }
          if (!deps.canEditUserSkill(role, existing.ownerUserId, userId)) {
            logger.warn(`Auto-execute skill_update blocked for role "${role}" on '${intent.slug}'`);
            break;
          }
          try {
            deps.updateUserSkill({
              slug: intent.slug,
              description: intent.description,
              body: intent.body,
            });
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: t("userSkills.updated", { slug: intent.slug }),
            });
          } catch (err) {
            logger.error("Auto-execute skill_update error:", err);
            await client.chat
              .postMessage({
                channel: channelId,
                thread_ts: threadTs,
                text: t("userSkills.update_failed", {
                  slug: intent.slug,
                  error: errorMessage(err),
                }),
              })
              .catch(() => {});
          }
          break;
        }

        case "skill_disable": {
          const existing = deps.readUserSkill(intent.slug);
          if (!existing) {
            logger.warn(`Auto-execute skill_disable: skill '${intent.slug}' not found`);
            break;
          }
          if (!deps.canEditUserSkill(role, existing.ownerUserId, userId)) {
            logger.warn(
              `Auto-execute skill_disable blocked for role "${role}" on '${intent.slug}'`,
            );
            break;
          }
          try {
            deps.disableUserSkill(intent.slug);
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: t("userSkills.disabled", { slug: intent.slug }),
            });
          } catch (err) {
            logger.error("Auto-execute skill_disable error:", err);
            await client.chat
              .postMessage({
                channel: channelId,
                thread_ts: threadTs,
                text: t("userSkills.disable_failed", {
                  slug: intent.slug,
                  error: errorMessage(err),
                }),
              })
              .catch(() => {});
          }
          break;
        }

        case "skill_restore": {
          const existing = deps.readUserSkill(intent.slug);
          if (!existing) {
            logger.warn(`Auto-execute skill_restore: skill '${intent.slug}' not found`);
            break;
          }
          if (!deps.canEditUserSkill(role, existing.ownerUserId, userId)) {
            logger.warn(
              `Auto-execute skill_restore blocked for role "${role}" on '${intent.slug}'`,
            );
            break;
          }
          try {
            deps.restoreUserSkill(intent.slug);
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: t("userSkills.restored", { slug: intent.slug }),
            });
          } catch (err) {
            logger.error("Auto-execute skill_restore error:", err);
            await client.chat
              .postMessage({
                channel: channelId,
                thread_ts: threadTs,
                text: t("userSkills.restore_failed", {
                  slug: intent.slug,
                  error: errorMessage(err),
                }),
              })
              .catch(() => {});
          }
          break;
        }

        case "review":
        case "merge":
        case "close": {
          logger.warn(
            `Auto-execute: intent type "${intent.type}" is not supported for auto-execution`,
          );
          break;
        }

        default: {
          const _exhaustive: never = intent;
          logger.warn(
            `Auto-execute: unsupported intent type ${(_exhaustive as { type: string }).type}`,
          );
        }
      }
    } catch (error) {
      logger.error(`Auto-execute error for action type ${action.type}:`, error);
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: t("errors.auto_execute_failed", { error: errorMessage(error) }),
        });
      } catch {
        // Best effort — don't let error reporting crash the flow
      }
    }
  }
}

/**
 * Auto-execute post_to actions. Runs before intent-based auto-execute
 * because post_to is snapshot-based (not intent-based) and available to all roles.
 */
async function handlePostToAutoExecute(
  params: AutoExecuteParams,
  deps: AutoExecuteDeps,
): Promise<void> {
  const { client, channelId, threadTs, response, sessionId } = params;

  if (!response.response?.actions) return;

  const postToActions = response.response.actions.filter(
    (a: Action): a is PostToAction => a.type === "post_to" && a.auto === true,
  );
  if (postToActions.length === 0) return;

  const session = await deps.getSession(sessionId);
  if (!session) {
    logger.warn(`post_to auto-execute: session ${sessionId} not found`);
    return;
  }

  const sessionInfo = await deps.restoreSession(sessionId);

  for (const action of postToActions) {
    const snapshot = action._snapshotId ? session.snapshots?.[action._snapshotId] : undefined;

    if (!snapshot) {
      logger.warn(
        `post_to auto-execute: missing snapshot for session ${sessionId} (snapshotId: ${action._snapshotId ?? "none"})`,
      );
      await client.chat
        .postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: t("errors.auto_post_no_content"),
        })
        .catch(() => {});
      continue;
    }

    // Resolve target via fallback chain: explicit → origin → assistant → session channel
    const origin = sessionInfo
      ? deps.resolveOrigin(session, sessionInfo)
      : { originChannel: undefined, originThreadTs: undefined };

    const targetChannel =
      action.channel || origin.originChannel || session.assistantCurrentChannelId || channelId;
    const targetThreadTs = action.thread_ts || origin.originThreadTs || undefined;

    if (!targetChannel) {
      logger.warn(`post_to auto-execute: no target channel for session ${sessionId}`);
      continue;
    }

    try {
      logger.info(
        `Auto-executing post_to: channel=${targetChannel}, thread=${targetThreadTs ?? "(top-level)"}`,
      );
      const postResult = await deps.postAnswerToChannel(
        client,
        snapshot,
        targetChannel,
        targetThreadTs,
        undefined,
        {
          sessionId,
          ...(action.actions && action.actions.length > 0 && { actions: action.actions }),
          ...(action.reactions && action.reactions.length > 0 && { reactions: action.reactions }),
          ...(action.suppress_unfurls === true && { suppressUnfurls: true }),
        },
      );
      // Track top-level posts so thread replies can find this session
      if (!targetThreadTs && postResult.ts) {
        await deps.updateSession(sessionId, { responseTs: postResult.ts });
      }
    } catch (error) {
      logger.error("post_to auto-execute failed:", error);
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: t("errors.auto_post_failed", { error: errorMessage(error) }),
        });
      } catch {
        // Best effort
      }
    }
  }
}
