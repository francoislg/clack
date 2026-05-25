import type { KnownBlock, View } from "@slack/types";
import { t } from "../i18n/t.js";
import type { UserRole } from "../roles.js";
import { canCreateUserSkill, canEditUserSkill } from "../permissions.js";
import type { UserSkill } from "../userSkills.js";

/**
 * Home Tab "Skills" section builder + create/edit modal builders. Kept in its own file
 * so the main `homeTab.ts` doesn't grow further. Parallels the Configurations section
 * in shape: header, list of rows, per-row Edit/Disable/Restore buttons gated by role.
 *
 * Permissions:
 *   - `+ Create skill` visible to any user permitted by `canCreateUserSkill` (member+).
 *   - Edit / Disable / Restore visible per-row when `canEditUserSkill(role, owner, viewer)`.
 *
 * Action IDs:
 *   `clack_user_skill_create_open`              — open create modal
 *   `clack_user_skill_edit_open:<slug>`         — open edit modal for slug
 *   `clack_user_skill_disable:<slug>`           — direct disable (with native button confirm)
 *   `clack_user_skill_restore:<slug>`           — direct restore (no confirm)
 *   `clack_user_skill_create_submit`            — modal submission (create)
 *   `clack_user_skill_edit_submit`              — modal submission (edit, slug carried in private_metadata)
 */

export const ACTION_CREATE_OPEN = "clack_user_skill_create_open";
export const ACTION_EDIT_OPEN_PREFIX = "clack_user_skill_edit_open";
export const ACTION_DISABLE_PREFIX = "clack_user_skill_disable";
export const ACTION_RESTORE_PREFIX = "clack_user_skill_restore";
export const CALLBACK_CREATE_SUBMIT = "clack_user_skill_create_submit";
export const CALLBACK_EDIT_SUBMIT = "clack_user_skill_edit_submit";

// Modal block_ids (used to read input state on submit)
export const BLOCK_NAME = "skill_name";
export const BLOCK_DESCRIPTION = "skill_description";
export const BLOCK_BODY = "skill_body";

// Action IDs INSIDE modal input blocks
export const ACTION_NAME_INPUT = "name_input";
export const ACTION_DESCRIPTION_INPUT = "description_input";
export const ACTION_BODY_INPUT = "body_input";

export function buildUserSkillsSection(
  viewerUserId: string,
  viewerRole: UserRole,
  skills: UserSkill[],
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("userSkills.section_header"), emoji: true },
  });

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: t("userSkills.section_subheader") }],
  });

  if (canCreateUserSkill(viewerRole)) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: t("userSkills.create_button"), emoji: true },
          action_id: ACTION_CREATE_OPEN,
        },
      ],
    });
  }

  if (skills.length === 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: t("userSkills.empty_state") }],
    });
    blocks.push({ type: "divider" });
    return blocks;
  }

  const sorted = [...skills].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const skill of sorted) {
    const ownerLabel = `*${t("userSkills.owner_label")}:* <@${skill.ownerUserId}>`;
    const disabledBadge = skill.disabledAt ? ` ${t("userSkills.disabled_badge")}` : "";
    const text = `*${skill.slug}*${disabledBadge}\n${skill.description}\n${ownerLabel}`;

    const section: KnownBlock = {
      type: "section",
      text: { type: "mrkdwn", text },
    };
    blocks.push(section);

    if (canEditUserSkill(viewerRole, skill.ownerUserId, viewerUserId)) {
      const elements: object[] = [];
      elements.push({
        type: "button",
        text: { type: "plain_text", text: t("userSkills.edit_button"), emoji: true },
        action_id: `${ACTION_EDIT_OPEN_PREFIX}:${skill.slug}`,
        value: skill.slug,
      });
      if (skill.disabledAt) {
        elements.push({
          type: "button",
          text: { type: "plain_text", text: t("userSkills.restore_button"), emoji: true },
          action_id: `${ACTION_RESTORE_PREFIX}:${skill.slug}`,
          value: skill.slug,
        });
      } else {
        elements.push({
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: t("userSkills.disable_button"), emoji: true },
          action_id: `${ACTION_DISABLE_PREFIX}:${skill.slug}`,
          value: skill.slug,
          confirm: {
            title: { type: "plain_text", text: t("userSkills.disable_button") },
            text: { type: "mrkdwn", text: `Disable \`${skill.slug}\`?` },
            confirm: { type: "plain_text", text: t("userSkills.disable_button") },
            deny: { type: "plain_text", text: t("common.cancel") },
          },
        });
      }
      blocks.push({ type: "actions", elements } as KnownBlock);
    }
  }

  blocks.push({ type: "divider" });
  return blocks;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

export function buildCreateSkillModal(): View {
  return {
    type: "modal",
    callback_id: CALLBACK_CREATE_SUBMIT,
    title: { type: "plain_text", text: t("userSkills.modal_create_title") },
    submit: { type: "plain_text", text: t("userSkills.create_button") },
    close: { type: "plain_text", text: t("common.cancel") },
    blocks: [
      {
        type: "input",
        block_id: BLOCK_NAME,
        label: { type: "plain_text", text: t("userSkills.modal_name_label") },
        element: {
          type: "plain_text_input",
          action_id: ACTION_NAME_INPUT,
          placeholder: { type: "plain_text", text: t("userSkills.modal_name_placeholder") },
          max_length: 64,
        },
        hint: { type: "plain_text", text: t("userSkills.modal_name_hint") },
      },
      {
        type: "input",
        block_id: BLOCK_DESCRIPTION,
        label: { type: "plain_text", text: t("userSkills.modal_description_label") },
        element: {
          type: "plain_text_input",
          action_id: ACTION_DESCRIPTION_INPUT,
          multiline: true,
          max_length: 1024,
        },
        hint: { type: "plain_text", text: t("userSkills.modal_description_hint") },
      },
      {
        type: "input",
        block_id: BLOCK_BODY,
        label: { type: "plain_text", text: t("userSkills.modal_body_label") },
        element: {
          type: "plain_text_input",
          action_id: ACTION_BODY_INPUT,
          multiline: true,
        },
        hint: { type: "plain_text", text: t("userSkills.modal_body_hint") },
      },
    ],
  };
}

export function buildEditSkillModal(skill: UserSkill): View {
  return {
    type: "modal",
    callback_id: CALLBACK_EDIT_SUBMIT,
    title: { type: "plain_text", text: t("userSkills.modal_edit_title") },
    submit: { type: "plain_text", text: t("userSkills.edit_button") },
    close: { type: "plain_text", text: t("common.cancel") },
    private_metadata: JSON.stringify({ slug: skill.slug }),
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${t("userSkills.modal_name_label")}:* \`${skill.slug}\`` },
      },
      {
        type: "input",
        block_id: BLOCK_DESCRIPTION,
        label: { type: "plain_text", text: t("userSkills.modal_description_label") },
        element: {
          type: "plain_text_input",
          action_id: ACTION_DESCRIPTION_INPUT,
          multiline: true,
          max_length: 1024,
          initial_value: skill.description,
        },
        hint: { type: "plain_text", text: t("userSkills.modal_description_hint") },
      },
      {
        type: "input",
        block_id: BLOCK_BODY,
        label: { type: "plain_text", text: t("userSkills.modal_body_label") },
        element: {
          type: "plain_text_input",
          action_id: ACTION_BODY_INPUT,
          multiline: true,
          initial_value: skill.body,
        },
        hint: { type: "plain_text", text: t("userSkills.modal_body_hint") },
      },
    ],
  };
}
