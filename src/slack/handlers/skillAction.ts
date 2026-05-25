import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getStagedIntent } from "../../sessions.js";
import type { StagedIntent } from "../../tools/types.js";
import { getRole } from "../../roles.js";
import { canCreateUserSkill, canEditUserSkill } from "../../permissions.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import {
  writeUserSkill,
  updateUserSkill,
  disableUserSkill,
  restoreUserSkill,
  readUserSkill,
  userSkillExists,
} from "../../userSkills.js";
import { errorMessage } from "../../errors.js";
import { t } from "../../i18n/t.js";
import type { UserRole } from "../../roles.js";

/**
 * Handles the Slack button-click for staged skill intents. Mirrors `configUpdateAction.ts`:
 * decode action value → restore session → re-read intent → re-check permissions → apply.
 * One handler regex (`clack_skill_action_<n>`) serves all four intent types; the staged
 * intent's discriminator tells us which branch to take.
 */

export interface SkillActionDeps {
  getRole: (userId: string) => Promise<UserRole>;
  decodeActionValue: (value: string) => { sessionId: string; ref?: string };
  restoreSession: (sessionId: string) => Promise<SessionInfo | undefined>;
  getStagedIntent: (sessionId: string, ref: string) => Promise<StagedIntent | null>;
  writeUserSkill: typeof writeUserSkill;
  updateUserSkill: typeof updateUserSkill;
  disableUserSkill: typeof disableUserSkill;
  restoreUserSkill: typeof restoreUserSkill;
  readUserSkill: typeof readUserSkill;
  userSkillExists: typeof userSkillExists;
  errorMessage: (err: unknown) => string;
}

export const defaultSkillActionDeps: SkillActionDeps = {
  getRole,
  decodeActionValue,
  restoreSession: (sessionId: string) => activeSessions.restore(sessionId),
  getStagedIntent,
  writeUserSkill,
  updateUserSkill,
  disableUserSkill,
  restoreUserSkill,
  readUserSkill,
  userSkillExists,
  errorMessage,
};

export function registerSkillActionHandler(
  app: App,
  deps: SkillActionDeps = defaultSkillActionDeps,
): void {
  app.action<BlockAction>(/^clack_skill_action_\d+$/, async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, ref } = deps.decodeActionValue(rawValue);
    const userId = body.user.id;
    const role = await deps.getRole(userId);

    if (!ref) {
      logger.error("Skill action handler: missing ref");
      return;
    }

    await respond({ delete_original: true });

    const sessionInfo = await deps.restoreSession(sessionId);
    if (!sessionInfo) {
      logger.error(`Skill action handler: could not restore session ${sessionId}`);
      return;
    }

    const intent = await deps.getStagedIntent(sessionId, ref);
    if (!intent) {
      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: userId,
        thread_ts: sessionInfo.threadTs,
        text: t("userSkills.expired"),
      });
      return;
    }

    try {
      switch (intent.type) {
        case "skill_create":
          await applyCreate(intent, role, userId, sessionInfo, client, deps);
          break;
        case "skill_update":
          await applyUpdate(intent, role, userId, sessionInfo, client, deps);
          break;
        case "skill_disable":
          await applyDisable(intent, role, userId, sessionInfo, client, deps);
          break;
        case "skill_restore":
          await applyRestore(intent, role, userId, sessionInfo, client, deps);
          break;
        default:
          logger.error(
            `Skill action handler: intent ref ${ref} has unsupported type ${intent.type}`,
          );
          break;
      }
    } catch (error) {
      logger.error("Skill action handler error:", error);
    }
  });
}

async function applyCreate(
  intent: Extract<StagedIntent, { type: "skill_create" }>,
  role: UserRole,
  userId: string,
  sessionInfo: SessionInfo,
  client: App["client"],
  deps: SkillActionDeps,
): Promise<void> {
  if (!canCreateUserSkill(role)) {
    await postEphemeralPermissionDenied(client, sessionInfo, userId, intent.slug);
    return;
  }
  if (deps.userSkillExists(intent.slug)) {
    await client.chat.postEphemeral({
      channel: sessionInfo.channelId,
      user: userId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.create_failed", {
        slug: intent.slug,
        error: `slug '${intent.slug}' already exists`,
      }),
    });
    return;
  }
  try {
    deps.writeUserSkill({
      slug: intent.slug,
      description: intent.description,
      body: intent.body,
      ownerUserId: intent.ownerUserId,
    });
    await client.chat.postMessage({
      channel: sessionInfo.channelId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.created", { slug: intent.slug }),
    });
  } catch (error) {
    logger.error("skill_create apply error:", error);
    await client.chat.postEphemeral({
      channel: sessionInfo.channelId,
      user: userId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.create_failed", {
        slug: intent.slug,
        error: deps.errorMessage(error),
      }),
    });
  }
}

async function applyUpdate(
  intent: Extract<StagedIntent, { type: "skill_update" }>,
  role: UserRole,
  userId: string,
  sessionInfo: SessionInfo,
  client: App["client"],
  deps: SkillActionDeps,
): Promise<void> {
  const existing = deps.readUserSkill(intent.slug);
  if (!existing) {
    await client.chat.postEphemeral({
      channel: sessionInfo.channelId,
      user: userId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.update_failed", { slug: intent.slug, error: "not found" }),
    });
    return;
  }
  if (!canEditUserSkill(role, existing.ownerUserId, userId)) {
    await postEphemeralPermissionDenied(client, sessionInfo, userId, intent.slug);
    return;
  }
  try {
    deps.updateUserSkill({
      slug: intent.slug,
      description: intent.description,
      body: intent.body,
    });
    await client.chat.postMessage({
      channel: sessionInfo.channelId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.updated", { slug: intent.slug }),
    });
  } catch (error) {
    logger.error("skill_update apply error:", error);
    await client.chat.postEphemeral({
      channel: sessionInfo.channelId,
      user: userId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.update_failed", {
        slug: intent.slug,
        error: deps.errorMessage(error),
      }),
    });
  }
}

async function applyDisable(
  intent: Extract<StagedIntent, { type: "skill_disable" }>,
  role: UserRole,
  userId: string,
  sessionInfo: SessionInfo,
  client: App["client"],
  deps: SkillActionDeps,
): Promise<void> {
  const existing = deps.readUserSkill(intent.slug);
  if (!existing) {
    await client.chat.postEphemeral({
      channel: sessionInfo.channelId,
      user: userId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.disable_failed", { slug: intent.slug, error: "not found" }),
    });
    return;
  }
  if (!canEditUserSkill(role, existing.ownerUserId, userId)) {
    await postEphemeralPermissionDenied(client, sessionInfo, userId, intent.slug);
    return;
  }
  try {
    deps.disableUserSkill(intent.slug);
    await client.chat.postMessage({
      channel: sessionInfo.channelId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.disabled", { slug: intent.slug }),
    });
  } catch (error) {
    logger.error("skill_disable apply error:", error);
    await client.chat.postEphemeral({
      channel: sessionInfo.channelId,
      user: userId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.disable_failed", {
        slug: intent.slug,
        error: deps.errorMessage(error),
      }),
    });
  }
}

async function applyRestore(
  intent: Extract<StagedIntent, { type: "skill_restore" }>,
  role: UserRole,
  userId: string,
  sessionInfo: SessionInfo,
  client: App["client"],
  deps: SkillActionDeps,
): Promise<void> {
  const existing = deps.readUserSkill(intent.slug);
  if (!existing) {
    await client.chat.postEphemeral({
      channel: sessionInfo.channelId,
      user: userId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.restore_failed", { slug: intent.slug, error: "not found" }),
    });
    return;
  }
  if (!canEditUserSkill(role, existing.ownerUserId, userId)) {
    await postEphemeralPermissionDenied(client, sessionInfo, userId, intent.slug);
    return;
  }
  try {
    deps.restoreUserSkill(intent.slug);
    await client.chat.postMessage({
      channel: sessionInfo.channelId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.restored", { slug: intent.slug }),
    });
  } catch (error) {
    logger.error("skill_restore apply error:", error);
    await client.chat.postEphemeral({
      channel: sessionInfo.channelId,
      user: userId,
      thread_ts: sessionInfo.threadTs,
      text: t("userSkills.restore_failed", {
        slug: intent.slug,
        error: deps.errorMessage(error),
      }),
    });
  }
}

async function postEphemeralPermissionDenied(
  client: App["client"],
  sessionInfo: SessionInfo,
  userId: string,
  slug: string,
): Promise<void> {
  await client.chat.postEphemeral({
    channel: sessionInfo.channelId,
    user: userId,
    thread_ts: sessionInfo.threadTs,
    text: t("userSkills.permission_denied", { slug }),
  });
}
