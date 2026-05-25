import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";
import { getRole } from "../../roles.js";
import { canCreateUserSkill, canEditUserSkill } from "../../permissions.js";
import {
  readUserSkill,
  writeUserSkill,
  updateUserSkill,
  disableUserSkill,
  restoreUserSkill,
  validateSlug,
  validateDescription,
  userSkillExists,
} from "../../userSkills.js";
import {
  buildCreateSkillModal,
  buildEditSkillModal,
  ACTION_CREATE_OPEN,
  ACTION_EDIT_OPEN_PREFIX,
  ACTION_DISABLE_PREFIX,
  ACTION_RESTORE_PREFIX,
  CALLBACK_CREATE_SUBMIT,
  CALLBACK_EDIT_SUBMIT,
  BLOCK_NAME,
  BLOCK_DESCRIPTION,
  BLOCK_BODY,
  ACTION_NAME_INPUT,
  ACTION_DESCRIPTION_INPUT,
  ACTION_BODY_INPUT,
} from "../userSkillsHomeTab.js";
import { publishHomeView } from "./homeTab.js";
import { t } from "../../i18n/t.js";

/**
 * Wires up the Skills section of the Home Tab: open Create/Edit modals, submit those
 * modals (creating/updating on disk), and the Disable/Restore direct-apply buttons.
 *
 * The Home Tab refreshes itself naturally on the next `app_home_opened` event; we
 * also push a fresh view from the handler so the user sees their change immediately.
 */

export function registerUserSkillsHomeActions(app: App): void {
  registerOpenCreateModal(app);
  registerOpenEditModal(app);
  registerDisable(app);
  registerRestore(app);
  registerCreateSubmit(app);
  registerEditSubmit(app);
}

function registerOpenCreateModal(app: App): void {
  app.action<BlockAction>(ACTION_CREATE_OPEN, async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    const role = await getRole(userId);
    if (!canCreateUserSkill(role)) {
      logger.warn(`Home Tab: ${userId} attempted to create skill without permission`);
      return;
    }
    const trigger = (body as { trigger_id?: string }).trigger_id;
    if (!trigger) return;
    await client.views.open({
      trigger_id: trigger,
      view: buildCreateSkillModal(),
    });
  });
}

function registerOpenEditModal(app: App): void {
  app.action<BlockAction>(
    new RegExp(`^${ACTION_EDIT_OPEN_PREFIX}:[a-z0-9][a-z0-9-]*$`),
    async ({ ack, body, client }) => {
      await ack();
      const slug = extractSlug(body, ACTION_EDIT_OPEN_PREFIX);
      if (!slug) return;
      const userId = body.user.id;
      const role = await getRole(userId);
      const skill = readUserSkill(slug);
      if (!skill) return;
      if (!canEditUserSkill(role, skill.ownerUserId, userId)) return;
      const trigger = (body as { trigger_id?: string }).trigger_id;
      if (!trigger) return;
      await client.views.open({
        trigger_id: trigger,
        view: buildEditSkillModal(skill),
      });
    },
  );
}

function registerDisable(app: App): void {
  app.action<BlockAction>(
    new RegExp(`^${ACTION_DISABLE_PREFIX}:[a-z0-9][a-z0-9-]*$`),
    async ({ ack, body, client }) => {
      await ack();
      const slug = extractSlug(body, ACTION_DISABLE_PREFIX);
      if (!slug) return;
      const userId = body.user.id;
      const role = await getRole(userId);
      const skill = readUserSkill(slug);
      if (!skill) return;
      if (!canEditUserSkill(role, skill.ownerUserId, userId)) return;
      try {
        disableUserSkill(slug);
      } catch (err) {
        logger.error("Home Tab disable error:", err);
      }
      await closeModalIfOpen(client, body, "userSkills.disabled", slug);
      await refreshHomeView(client, userId);
    },
  );
}

function registerRestore(app: App): void {
  app.action<BlockAction>(
    new RegExp(`^${ACTION_RESTORE_PREFIX}:[a-z0-9][a-z0-9-]*$`),
    async ({ ack, body, client }) => {
      await ack();
      const slug = extractSlug(body, ACTION_RESTORE_PREFIX);
      if (!slug) return;
      const userId = body.user.id;
      const role = await getRole(userId);
      const skill = readUserSkill(slug);
      if (!skill) return;
      if (!canEditUserSkill(role, skill.ownerUserId, userId)) return;
      try {
        restoreUserSkill(slug);
      } catch (err) {
        logger.error("Home Tab restore error:", err);
      }
      await closeModalIfOpen(client, body, "userSkills.restored", slug);
      await refreshHomeView(client, userId);
    },
  );
}

function extractViewId(body: BlockAction): string | null {
  if (!("view" in body)) return null;
  const view = body.view;
  if (view === null || typeof view !== "object") return null;
  if (!("id" in view)) return null;
  const { id } = view as { id: string | undefined };
  return typeof id === "string" ? id : null;
}

async function closeModalIfOpen(
  client: App["client"],
  body: BlockAction,
  messageKey: "userSkills.disabled" | "userSkills.restored",
  slug: string,
): Promise<void> {
  const viewId = extractViewId(body);
  if (!viewId) return;
  try {
    await client.views.update({
      view_id: viewId,
      view: {
        type: "modal",
        title: { type: "plain_text", text: t("userSkills.modal_edit_title") },
        close: { type: "plain_text", text: t("common.cancel") },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: t(messageKey, { slug }) },
          },
        ],
      },
    });
  } catch (err) {
    logger.warn("Failed to update modal after disable/restore:", err);
  }
}

function registerCreateSubmit(app: App): void {
  app.view<ViewSubmitAction>(CALLBACK_CREATE_SUBMIT, async ({ ack, body, client }) => {
    const userId = body.user.id;
    const state = body.view.state.values;
    const name = readInputValue(state, BLOCK_NAME, ACTION_NAME_INPUT) ?? "";
    const description = readInputValue(state, BLOCK_DESCRIPTION, ACTION_DESCRIPTION_INPUT) ?? "";
    const bodyText = readInputValue(state, BLOCK_BODY, ACTION_BODY_INPUT) ?? "";

    const errors: Record<string, string> = {};

    const slugCheck = validateSlug(name);
    if (!slugCheck.ok) errors[BLOCK_NAME] = slugCheck.reason;
    else if (userSkillExists(name)) {
      errors[BLOCK_NAME] = `A skill named '${name}' already exists.`;
    }

    const descCheck = validateDescription(description);
    if (!descCheck.ok) errors[BLOCK_DESCRIPTION] = descCheck.reason;

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: "errors", errors });
      return;
    }

    const role = await getRole(userId);
    if (!canCreateUserSkill(role)) {
      await ack({
        response_action: "errors",
        errors: { [BLOCK_NAME]: "You do not have permission to create skills." },
      });
      return;
    }

    try {
      writeUserSkill({
        slug: name,
        description,
        body: bodyText,
        ownerUserId: userId,
      });
      await ack();
      await refreshHomeView(client, userId);
    } catch (err) {
      logger.error("Home Tab create-submit error:", err);
      await ack({
        response_action: "errors",
        errors: { [BLOCK_NAME]: errorMessage(err) },
      });
    }
  });
}

function registerEditSubmit(app: App): void {
  app.view<ViewSubmitAction>(CALLBACK_EDIT_SUBMIT, async ({ ack, body, client }) => {
    const userId = body.user.id;
    const state = body.view.state.values;
    const description = readInputValue(state, BLOCK_DESCRIPTION, ACTION_DESCRIPTION_INPUT) ?? "";
    const bodyText = readInputValue(state, BLOCK_BODY, ACTION_BODY_INPUT) ?? "";

    const metadata = parseSlugMetadata(body.view.private_metadata);
    if (!metadata) {
      await ack({
        response_action: "errors",
        errors: { [BLOCK_DESCRIPTION]: "Could not identify skill — refresh and try again." },
      });
      return;
    }

    const existing = readUserSkill(metadata.slug);
    if (!existing) {
      await ack({
        response_action: "errors",
        errors: { [BLOCK_DESCRIPTION]: "Skill no longer exists." },
      });
      return;
    }

    const role = await getRole(userId);
    if (!canEditUserSkill(role, existing.ownerUserId, userId)) {
      await ack({
        response_action: "errors",
        errors: { [BLOCK_DESCRIPTION]: "You do not have permission to edit this skill." },
      });
      return;
    }

    const descCheck = validateDescription(description);
    if (!descCheck.ok) {
      await ack({
        response_action: "errors",
        errors: { [BLOCK_DESCRIPTION]: descCheck.reason },
      });
      return;
    }

    try {
      updateUserSkill({ slug: metadata.slug, description, body: bodyText });
      await ack();
      await refreshHomeView(client, userId);
    } catch (err) {
      logger.error("Home Tab edit-submit error:", err);
      await ack({
        response_action: "errors",
        errors: { [BLOCK_DESCRIPTION]: errorMessage(err) },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSlug(body: BlockAction, prefix: string): string | null {
  const action = body.actions[0];
  const actionId = "action_id" in action ? action.action_id : undefined;
  if (typeof actionId !== "string") return null;
  if (!actionId.startsWith(`${prefix}:`)) return null;
  return actionId.slice(prefix.length + 1);
}

type ModalState = Record<string, Record<string, { value?: string | null }>>;

function readInputValue(state: ModalState, block: string, action: string): string | null {
  const blockState = state[block];
  if (!blockState) return null;
  const inputState = blockState[action];
  if (!inputState) return null;
  return typeof inputState.value === "string" ? inputState.value : null;
}

interface PrivateMetadata {
  slug: string;
}

function parseSlugMetadata(raw: string): PrivateMetadata | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { slug?: unknown }).slug === "string"
    ) {
      return { slug: (parsed as { slug: string }).slug };
    }
  } catch {
    // not JSON
  }
  return null;
}

async function refreshHomeView(client: App["client"], userId: string): Promise<void> {
  try {
    await publishHomeView(client, userId);
  } catch (err) {
    logger.warn("Failed to refresh Home view after skill action:", err);
  }
}
