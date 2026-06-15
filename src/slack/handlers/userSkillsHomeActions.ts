import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { z } from "zod";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";
import { getRole } from "../../roles.js";
import {
  canCreateUserSkill,
  canEditUserSkillContent,
  canManageUserSkill,
  canDeleteUserSkill,
} from "../../permissions.js";
import {
  readUserSkill,
  writeUserSkill,
  updateUserSkill,
  disableUserSkill,
  restoreUserSkill,
  deleteUserSkill,
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
  ACTION_DELETE_PREFIX,
  CALLBACK_CREATE_SUBMIT,
  CALLBACK_EDIT_SUBMIT,
  BLOCK_NAME,
  BLOCK_DESCRIPTION,
  BLOCK_BODY,
  BLOCK_EDITABLE,
  ACTION_NAME_INPUT,
  ACTION_DESCRIPTION_INPUT,
  ACTION_BODY_INPUT,
  ACTION_EDITABLE_INPUT,
  EDITABLE_OPTION_VALUE,
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
  registerDelete(app);
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
      if (
        !canEditUserSkillContent(role, skill.ownerUserId, userId, skill.editableByAnyone ?? false)
      )
        return;
      const trigger = (body as { trigger_id?: string }).trigger_id;
      if (!trigger) return;
      await client.views.open({
        trigger_id: trigger,
        view: buildEditSkillModal(
          skill,
          canManageUserSkill(role, skill.ownerUserId, userId),
          canDeleteUserSkill(role),
        ),
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
      if (!canManageUserSkill(role, skill.ownerUserId, userId)) return;
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
      if (!canManageUserSkill(role, skill.ownerUserId, userId)) return;
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

function registerDelete(app: App): void {
  app.action<BlockAction>(
    new RegExp(`^${ACTION_DELETE_PREFIX}:[a-z0-9][a-z0-9-]*$`),
    async ({ ack, body, client }) => {
      await ack();
      const slug = extractSlug(body, ACTION_DELETE_PREFIX);
      if (!slug) return;
      const userId = body.user.id;
      const role = await getRole(userId);
      const skill = readUserSkill(slug);
      if (!skill) return;
      if (!canDeleteUserSkill(role)) return;
      try {
        deleteUserSkill(slug);
      } catch (err) {
        logger.error("Home Tab skill removal error:", err);
      }
      await closeModalIfOpen(client, body, "userSkills.deleted", slug);
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
  messageKey: "userSkills.disabled" | "userSkills.restored" | "userSkills.deleted",
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
    logger.warn("Failed to update modal after skill lifecycle action:", err);
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
    const bodyText = readInputValue(state, BLOCK_BODY, ACTION_BODY_INPUT);

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
    if (
      !canEditUserSkillContent(
        role,
        existing.ownerUserId,
        userId,
        existing.editableByAnyone ?? false,
      )
    ) {
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

    // The editable-by-everyone checkbox is rendered only for managers; only honor it
    // when the submitter can actually manage the skill (defense-in-depth).
    const canManage = canManageUserSkill(role, existing.ownerUserId, userId);
    const editableByAnyone = canManage
      ? readCheckboxChecked(state, BLOCK_EDITABLE, ACTION_EDITABLE_INPUT, EDITABLE_OPTION_VALUE)
      : undefined;

    try {
      // When the body input was omitted (body too long for the modal), preserve
      // the existing body — never round-trip through Slack and risk truncation.
      const updates =
        bodyText === null
          ? { slug: metadata.slug, description, editableByAnyone }
          : { slug: metadata.slug, description, body: bodyText, editableByAnyone };
      updateUserSkill(updates);
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

type ModalState = Record<
  string,
  Record<string, { value?: string | null; selected_options?: Array<{ value: string }> }>
>;

function readInputValue(state: ModalState, block: string, action: string): string | null {
  const blockState = state[block];
  if (!blockState) return null;
  const inputState = blockState[action];
  if (!inputState) return null;
  return typeof inputState.value === "string" ? inputState.value : null;
}

function readCheckboxChecked(
  state: ModalState,
  block: string,
  action: string,
  optionValue: string,
): boolean {
  const selected = state[block]?.[action]?.selected_options;
  if (!Array.isArray(selected)) return false;
  return selected.some((opt) => opt.value === optionValue);
}

const slugMetadataZod = z.object({ slug: z.string() });

function parseSlugMetadata(raw: string): { slug: string } | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = slugMetadataZod.safeParse(parsed);
  return result.success ? result.data : null;
}

async function refreshHomeView(client: App["client"], userId: string): Promise<void> {
  try {
    await publishHomeView(client, userId);
  } catch (err) {
    logger.warn("Failed to refresh Home view after skill action:", err);
  }
}
