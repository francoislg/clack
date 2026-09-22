import type { App, BlockAction, ButtonAction, ViewSubmitAction } from "@slack/bolt";
import type { View } from "@slack/types";
import { logger } from "../../logger.js";
import {
  loadRoles,
  setOwner,
  setRole,
  isUserDisabled,
  claimOwnershipFromDisabled,
  transferOwnership,
  hasOwner,
  getRole,
  type RoleChangeFailure,
  type RoleChangeResult,
} from "../../roles.js";
import { clearQuarantinedWorker } from "../../workers/index.js";
import { userCanManageRoles, userCanEditConfig } from "../../permissions.js";
import { canToggleShared } from "../../tools/cronJobAccess.js";
import {
  buildHomeView,
  buildUserSelectModal,
  buildRemoveUserModal,
  buildSettingsModal,
  buildConfigFilePickerModal,
  buildConfigEditorModal,
  buildConfigCreateFileModal,
  buildAutoRespondModal,
  buildCronJobModal,
  buildRolesModalView,
  buildAutoRespondModalView,
  buildSchedulesModalView,
  buildSkillsModalView,
  buildInvestigationsModalView,
  buildMcpModalView,
  buildPluginsModalView,
  buildStatusModalView,
  ATTENTION_DEFAULT_OPTION,
  type ConfigFilePickerEntry,
  type ConfigFileState,
} from "../homeTab.js";
import { SETTABLE_ATTENTION_LEVELS, type SettableAttentionLevel } from "../../sessions.js";
import { addRule, updateRule, toggleRule, deleteRule, getRule } from "../../autoRespond.js";
import {
  listInstructionFiles,
  readInstructionFile,
  writeInstructionFile,
  deleteInstructionFile,
  getEffectiveContentLength,
} from "../../configurationFiles.js";
import { setUserPreference, mergePluginPreferenceSlice } from "../../userPreferences.js";
import type { ReactionDelivery } from "../../userPreferences.js";
import { getConfig, type JsonObject } from "../../config.js";
import { discoverUserSkills } from "../../userSkills.js";
import { t } from "../../i18n/t.js";
import type { StringKey } from "../../i18n/strings/en.js";
import { toggleJob, deleteJob, getJob, updateJob, MAX_JITTER_MINUTES } from "../../cronJobs.js";
import { getQuarantineStore } from "../../state/stateQuarantineRegistry.js";
import { runJobNow } from "../../cronScheduler.js";
import { openDmChannel } from "../channelResolver.js";
import { getUserInfo } from "../userCache.js";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import { getInvestigationsChannel, listOpenInvestigations } from "../../investigations/state.js";
import { getLoadedPluginPreferences } from "../../plugins-core/state.js";

const configFileModalMetaZod = z.object({ dir: z.string(), filename: z.string() });
const configCreateModalMetaZod = z.object({ dir: z.string() });

const attentionSelectionSchema = z.enum(SETTABLE_ATTENTION_LEVELS);

/**
 * Parse the auto-respond attention static_select value. An absent value or the default option
 * resolves to `undefined` (inherit the medium default); a settable level resolves to that level;
 * anything else is an error the caller surfaces on the block.
 */
function parseAttentionSelection(
  value: string | undefined | null,
): { ok: true; level: SettableAttentionLevel | undefined } | { ok: false } {
  if (value === undefined || value === null || value === ATTENTION_DEFAULT_OPTION) {
    return { ok: true, level: undefined };
  }
  const parsed = attentionSelectionSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, level: parsed.data };
}

/** The auto-respond rule fields submitted through the shared Add/Edit Rule modal. */
interface RuleModalInput {
  channels: string[];
  users: string[];
  keywords: string[] | undefined;
  extraContext: string | undefined;
  preAnalysisContext: string | undefined;
  attentionLevel: SettableAttentionLevel | undefined;
}

/** Read and validate the Add/Edit Rule modal, or return the block errors to show. */
function readRuleModal(
  view: ViewSubmitAction["view"],
): { ok: true; input: RuleModalInput } | { ok: false; errors: Record<string, string> } {
  const values = view.state.values;
  const channels = values.channels_block.channels.selected_conversations;
  if (!channels || channels.length === 0) {
    return { ok: false, errors: { channels_block: t("home.auto_respond.error_no_channels") } };
  }
  const attention = parseAttentionSelection(
    values.attention_block?.attention_level?.selected_option?.value,
  );
  if (!attention.ok) {
    return {
      ok: false,
      errors: { attention_block: t("home.auto_respond.error_unknown_attention") },
    };
  }
  return {
    ok: true,
    input: {
      channels,
      users: values.users_block.users.selected_users ?? [],
      keywords: parseKeywords(values.keywords_block?.keywords?.value),
      extraContext: values.extra_context_block?.extra_context?.value ?? undefined,
      preAnalysisContext: values.pre_analysis_block?.pre_analysis_context?.value ?? undefined,
      attentionLevel: attention.level,
    },
  };
}

// Some BlockAction variants carry the surrounding view; read its id without unsafe casts.
function viewIdFromBody(body: object): string | undefined {
  if (!("view" in body)) return undefined;
  const view = body.view;
  if (typeof view !== "object" || view === null || !("id" in view)) return undefined;
  const id = view.id;
  return typeof id === "string" ? id : undefined;
}

// Open a modal, or stack it via views.push when the interaction came from within an
// already-open modal (Slack rejects views.open there). Child editors reached from the
// Configuration list modals go through this so they stack instead of erroring.
export async function openOrPushModal(
  client: App["client"],
  body: object,
  triggerId: string,
  view: View,
): Promise<void> {
  if (viewIdFromBody(body)) {
    await client.views.push({ trigger_id: triggerId, view });
  } else {
    await client.views.open({ trigger_id: triggerId, view });
  }
}

// ============================================================================
// Dependency Injection
// ============================================================================

export interface HomeTabDeps {
  loadRoles: typeof loadRoles;
  setOwner: typeof setOwner;
  setRole: typeof setRole;
  isUserDisabled: typeof isUserDisabled;
  claimOwnershipFromDisabled: typeof claimOwnershipFromDisabled;
  transferOwnership: typeof transferOwnership;
  hasOwner: typeof hasOwner;
  userCanManageRoles: typeof userCanManageRoles;
  userCanEditConfig: typeof userCanEditConfig;
  buildHomeView: typeof buildHomeView;
  buildUserSelectModal: typeof buildUserSelectModal;
  buildRemoveUserModal: typeof buildRemoveUserModal;
  buildSettingsModal: typeof buildSettingsModal;
  buildConfigFilePickerModal: typeof buildConfigFilePickerModal;
  buildConfigEditorModal: typeof buildConfigEditorModal;
  buildConfigCreateFileModal: typeof buildConfigCreateFileModal;
  buildAutoRespondModal: typeof buildAutoRespondModal;
  buildCronJobModal: typeof buildCronJobModal;
  addRule: typeof addRule;
  updateRule: typeof updateRule;
  toggleRule: typeof toggleRule;
  deleteRule: typeof deleteRule;
  getRule: typeof getRule;
  listInstructionFiles: typeof listInstructionFiles;
  readInstructionFile: typeof readInstructionFile;
  writeInstructionFile: typeof writeInstructionFile;
  deleteInstructionFile: typeof deleteInstructionFile;
  getEffectiveContentLength: typeof getEffectiveContentLength;
  setUserPreference: typeof setUserPreference;
  toggleJob: typeof toggleJob;
  deleteJob: typeof deleteJob;
  getJob: typeof getJob;
  updateJob: typeof updateJob;
  runJobNow: typeof runJobNow;
  getRole: typeof getRole;
  clearQuarantinedWorker: typeof clearQuarantinedWorker;
  getInvestigationsChannel: () => string | null;
  listOpenInvestigations: () => object[];
  mergePluginPreferenceSlice: typeof mergePluginPreferenceSlice;
  getLoadedPluginPreferences: typeof getLoadedPluginPreferences;
}

export const defaultHomeTabDeps: HomeTabDeps = {
  loadRoles,
  setOwner,
  setRole,
  isUserDisabled,
  claimOwnershipFromDisabled,
  transferOwnership,
  hasOwner,
  userCanManageRoles,
  userCanEditConfig,
  buildHomeView,
  buildUserSelectModal,
  buildRemoveUserModal,
  buildSettingsModal,
  buildConfigFilePickerModal,
  buildConfigEditorModal,
  buildConfigCreateFileModal,
  buildAutoRespondModal,
  buildCronJobModal,
  addRule,
  updateRule,
  toggleRule,
  deleteRule,
  getRule,
  listInstructionFiles,
  readInstructionFile,
  writeInstructionFile,
  deleteInstructionFile,
  getEffectiveContentLength,
  setUserPreference,
  toggleJob,
  deleteJob,
  getJob,
  updateJob,
  runJobNow,
  getRole,
  clearQuarantinedWorker,
  getInvestigationsChannel,
  listOpenInvestigations,
  mergePluginPreferenceSlice,
  getLoadedPluginPreferences,
};

/** Parse comma-separated keywords input into a trimmed array, or undefined if empty. */
function parseKeywords(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined;
  const keywords = raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return keywords.length > 0 ? keywords : undefined;
}

// Slack rejects an App Home view with more than 100 blocks — a single overflow blanks
// the whole tab. Cap defensively so a future section can never silently break it.
const MAX_HOME_BLOCKS = 100;

function capHomeViewBlocks(view: View): void {
  if (view.blocks.length <= MAX_HOME_BLOCKS) return;
  logger.warn(
    `Home view had ${view.blocks.length} blocks (limit ${MAX_HOME_BLOCKS}); truncating the tail.`,
  );
  view.blocks = [
    ...view.blocks.slice(0, MAX_HOME_BLOCKS - 1),
    { type: "context", elements: [{ type: "mrkdwn", text: t("home.truncated_notice") }] },
  ];
}

export async function publishHomeView(
  client: App["client"],
  userId: string,
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<void> {
  // Check if owner is disabled (for claim UI)
  const roles = await deps.loadRoles();
  let ownerDisabled = false;

  if (roles.owner) {
    ownerDisabled = await deps.isUserDisabled(client, roles.owner);
  }

  const view = await deps.buildHomeView({ userId, ownerDisabled });
  capHomeViewBlocks(view);

  await client.views.publish({
    user_id: userId,
    view,
  });
}

/**
 * i18n key bundle for a role add/remove flow. Keys (not resolved strings) are held so `t()`
 * runs inside the handler at interaction time, reading the configured language per interaction.
 */
interface RoleActionLabels {
  title: StringKey;
  selectPrompt?: StringKey;
  noPermission: StringKey;
}

const ADD_ADMIN_LABELS = {
  title: "home.roles.add_admin_modal_title",
  selectPrompt: "home.roles.add_admin_select_prompt",
  noPermission: "home.roles.add_admin_no_permission",
} as const satisfies RoleActionLabels;

const ADD_DEV_LABELS = {
  title: "home.roles.add_dev_modal_title",
  selectPrompt: "home.roles.add_dev_select_prompt",
  noPermission: "home.roles.add_dev_no_permission",
} as const satisfies RoleActionLabels;

const REMOVE_ADMIN_LABELS = {
  title: "home.roles.remove_admin_modal_title",
  noPermission: "home.roles.remove_admin_no_permission",
} as const satisfies RoleActionLabels;

const REMOVE_DEV_LABELS = {
  title: "home.roles.remove_dev_modal_title",
  noPermission: "home.roles.remove_dev_no_permission",
} as const satisfies RoleActionLabels;

type AddRoleLabels = typeof ADD_ADMIN_LABELS | typeof ADD_DEV_LABELS;
type RemoveRoleLabels = typeof REMOVE_ADMIN_LABELS | typeof REMOVE_DEV_LABELS;

/** Localized message key for each role-change failure code (direct-to-Slack path). */
const ROLE_CHANGE_FAILURE_KEYS = {
  role_not_assignable: "home.roles.error_role_not_assignable",
  owner_role_locked: "home.roles.error_owner_role_locked",
  owner_still_active: "home.roles.error_owner_still_active",
  not_admin: "home.roles.error_not_admin",
  not_owner: "home.roles.error_not_owner",
  target_disabled: "home.roles.error_target_disabled",
} as const satisfies Record<RoleChangeFailure, StringKey>;

/**
 * Register a pair of button + modal handlers for adding a role.
 */
function registerAddRoleHandlers(
  app: App,
  buttonId: string,
  modalId: string,
  labels: AddRoleLabels,
  roleFn: (userId: string) => Promise<RoleChangeResult>,
  deps: HomeTabDeps = defaultHomeTabDeps,
) {
  app.action<BlockAction<ButtonAction>>(buttonId, async ({ ack, body, client }) => {
    await ack();
    try {
      await openOrPushModal(
        client,
        body,
        body.trigger_id,
        deps.buildUserSelectModal(t(labels.title), modalId, t(labels.selectPrompt)),
      );
    } catch (error) {
      logger.error(`Failed to open ${modalId} modal:`, error);
    }
  });

  app.view<ViewSubmitAction>(modalId, async ({ ack, view, body, client }) => {
    const selectedUser = view.state.values.user_select_block.selected_user.selected_user;
    const currentUserId = body.user.id;

    if (!selectedUser) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: t("home.user_select.error_none") },
      });
      return;
    }
    if (!(await deps.userCanManageRoles(currentUserId))) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: t(labels.noPermission) },
      });
      return;
    }

    const result = await roleFn(selectedUser);
    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: t(ROLE_CHANGE_FAILURE_KEYS[result.code]) },
      });
      return;
    }

    await ack();
    await publishHomeView(client, currentUserId, deps);
  });
}

/**
 * Register a pair of button + modal handlers for removing a role.
 */
function registerRemoveRoleHandlers(
  app: App,
  buttonId: string,
  modalId: string,
  labels: RemoveRoleLabels,
  listKey: "admins" | "devs",
  roleFn: (userId: string) => Promise<RoleChangeResult>,
  deps: HomeTabDeps = defaultHomeTabDeps,
) {
  app.action<BlockAction<ButtonAction>>(buttonId, async ({ ack, body, client }) => {
    await ack();
    try {
      const roles = await deps.loadRoles();
      if (roles[listKey].length === 0) return;
      await openOrPushModal(
        client,
        body,
        body.trigger_id,
        deps.buildRemoveUserModal(t(labels.title), modalId, roles[listKey]),
      );
    } catch (error) {
      logger.error(`Failed to open ${modalId} modal:`, error);
    }
  });

  app.view<ViewSubmitAction>(modalId, async ({ ack, view, body, client }) => {
    const selectedUser = view.state.values.user_select_block.selected_user.selected_option?.value;
    const currentUserId = body.user.id;

    if (!selectedUser) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: t("home.user_select.error_none") },
      });
      return;
    }
    if (!(await deps.userCanManageRoles(currentUserId))) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: t(labels.noPermission) },
      });
      return;
    }

    const result = await roleFn(selectedUser);
    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: t(ROLE_CHANGE_FAILURE_KEYS[result.code]) },
      });
      return;
    }

    await ack();
    await publishHomeView(client, currentUserId, deps);
  });
}

export function registerHomeTabHandler(app: App, deps: HomeTabDeps = defaultHomeTabDeps): void {
  // Handle Home tab opened event
  app.event("app_home_opened", async ({ event, client }) => {
    try {
      logger.debug(`Home tab opened by user ${event.user}`);
      await publishHomeView(client, event.user, deps);
    } catch (error) {
      logger.error("Failed to publish home view:", error);
    }
  });

  // Handle Claim Ownership button
  app.action<BlockAction>("claim_ownership", async ({ ack, body, client }) => {
    await ack();

    const userId = body.user.id;

    try {
      const hasAnOwner = await deps.hasOwner();

      if (!hasAnOwner) {
        // No owner, claim directly
        await deps.setOwner(userId);
        logger.info(`User ${userId} claimed ownership (first owner)`);
      } else {
        // Owner exists, try to claim from disabled owner
        const result = await deps.claimOwnershipFromDisabled(client, userId);
        if (!result.success) {
          logger.warn(`User ${userId} failed to claim ownership: ${result.error}`);
          // Could show an error message here
          return;
        }
      }

      // Refresh the home view
      await publishHomeView(client, userId, deps);
    } catch (error) {
      logger.error("Failed to claim ownership:", error);
    }
  });

  // Handle Transfer Ownership button - opens modal
  app.action<BlockAction>("transfer_ownership", async ({ ack, body, client }) => {
    await ack();

    try {
      await openOrPushModal(
        client,
        body,
        body.trigger_id,
        deps.buildUserSelectModal(
          t("home.roles.transfer_modal_title"),
          "transfer_ownership_modal",
          t("home.roles.transfer_select_prompt"),
        ),
      );
    } catch (error) {
      logger.error("Failed to open transfer ownership modal:", error);
    }
  });

  // Handle Transfer Ownership modal submission
  app.view<ViewSubmitAction>("transfer_ownership_modal", async ({ ack, view, body, client }) => {
    const selectedUser = view.state.values.user_select_block.selected_user.selected_user;
    const currentUserId = body.user.id;

    if (!selectedUser) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: t("home.user_select.error_none"),
        },
      });
      return;
    }

    const result = await deps.transferOwnership(client, currentUserId, selectedUser);

    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: t(ROLE_CHANGE_FAILURE_KEYS[result.code]),
        },
      });
      return;
    }

    await ack();

    // Refresh home views for both users
    await publishHomeView(client, currentUserId, deps);
    await publishHomeView(client, selectedUser, deps);
  });

  // Role management handlers (add/remove admin & dev)
  registerAddRoleHandlers(
    app,
    "add_admin",
    "add_admin_modal",
    ADD_ADMIN_LABELS,
    (userId) => deps.setRole(userId, "admin"),
    deps,
  );
  registerRemoveRoleHandlers(
    app,
    "remove_admin",
    "remove_admin_modal",
    REMOVE_ADMIN_LABELS,
    "admins",
    (userId) => deps.setRole(userId, "member"),
    deps,
  );
  registerAddRoleHandlers(
    app,
    "add_dev",
    "add_dev_modal",
    ADD_DEV_LABELS,
    (userId) => deps.setRole(userId, "dev"),
    deps,
  );
  registerRemoveRoleHandlers(
    app,
    "remove_dev",
    "remove_dev_modal",
    REMOVE_DEV_LABELS,
    "devs",
    (userId) => deps.setRole(userId, "member"),
    deps,
  );

  // Handle Settings button
  app.action<BlockAction>("open_settings", async ({ ack, body, client }) => {
    await ack();

    const userId = body.user.id;

    try {
      const view = await deps.buildSettingsModal(userId);
      await client.views.open({
        trigger_id: body.trigger_id,
        view,
      });
    } catch (error) {
      logger.error("Failed to open settings modal:", error);
    }
  });

  // Handle Settings modal submission
  app.view<ViewSubmitAction>("settings_modal", async ({ ack, view, body, client }) => {
    const userId = body.user.id;

    const deliveryValue =
      view.state.values.response_delivery_block?.response_delivery?.selected_option?.value;
    const notifyValue =
      view.state.values.notify_on_response_block?.notify_on_response?.selected_option?.value;
    const investigationTagValue =
      view.state.values.investigation_tag_block?.investigation_tag?.selected_option?.value;
    const investigationBreadcrumbValue =
      view.state.values.investigation_breadcrumb_block?.investigation_breadcrumb?.selected_option
        ?.value;

    const updates: string[] = [];

    // Persist a "true"/"false" radio value onto a boolean preference.
    const saveBooleanPref = async (
      value: string | undefined,
      key: "notifyOnResponse" | "investigationTag",
    ): Promise<void> => {
      if (value === "true" || value === "false") {
        await deps.setUserPreference(userId, key, value === "true");
        updates.push(`${key}=${value}`);
      }
    };

    if (deliveryValue === "dm" || deliveryValue === "thread") {
      await deps.setUserPreference(userId, "reactionDelivery", deliveryValue as ReactionDelivery);
      updates.push(`reactionDelivery=${deliveryValue}`);
    }

    await saveBooleanPref(notifyValue, "notifyOnResponse");
    await saveBooleanPref(investigationTagValue, "investigationTag");

    if (investigationBreadcrumbValue === "silent" || investigationBreadcrumbValue === "explicit") {
      await deps.setUserPreference(userId, "investigationBreadcrumb", investigationBreadcrumbValue);
      updates.push(`investigationBreadcrumb=${investigationBreadcrumbValue}`);
    }

    // Fan out plugin preferences
    for (const { plugin, preferences } of deps.getLoadedPluginPreferences()) {
      const partial: { [key: string]: boolean } = {};
      for (const field of preferences.fields) {
        const selected =
          view.state.values[`plugin_pref:${plugin}:${field.key}`]?.[field.key]?.selected_options;
        partial[field.key] = Array.isArray(selected) && selected.length > 0;
      }
      const parsed = preferences.schema.safeParse(partial);
      if (!parsed.success) continue;
      try {
        const jsonObj = parsed.data as JsonObject;
        await deps.mergePluginPreferenceSlice(plugin, userId, jsonObj);
      } catch (error) {
        logger.error(`Failed to persist ${plugin} preferences for ${userId}:`, error);
      }
    }

    if (updates.length > 0) {
      logger.info(`User ${userId} updated settings: ${updates.join(", ")}`);
    }

    await ack();

    await publishHomeView(client, userId, deps);
  });

  // =========================================================================
  // "See …" buttons — open the relocated sections as modals
  // =========================================================================

  app.action<BlockAction>("home_open_roles", async ({ ack, body, client }) => {
    await ack();
    try {
      if (!(await deps.userCanManageRoles(body.user.id))) return;
      const role = await deps.getRole(body.user.id);
      await client.views.open({
        trigger_id: body.trigger_id,
        view: await buildRolesModalView(role),
      });
    } catch (error) {
      logger.error("Failed to open roles modal:", error);
    }
  });

  app.action<BlockAction>("home_open_auto_respond", async ({ ack, body, client }) => {
    await ack();
    try {
      if (!(await deps.userCanManageRoles(body.user.id))) return;
      await client.views.open({
        trigger_id: body.trigger_id,
        view: await buildAutoRespondModalView(),
      });
    } catch (error) {
      logger.error("Failed to open auto-respond modal:", error);
    }
  });

  app.action<BlockAction>("home_open_schedules", async ({ ack, body, client }) => {
    await ack();
    try {
      const isAdmin = await deps.userCanManageRoles(body.user.id);
      await client.views.open({
        trigger_id: body.trigger_id,
        view: await buildSchedulesModalView(body.user.id, isAdmin),
      });
    } catch (error) {
      logger.error("Failed to open schedules modal:", error);
    }
  });

  app.action<BlockAction>("home_open_skills", async ({ ack, body, client }) => {
    await ack();
    try {
      if (getConfig().userSkills?.enabled !== true) return;
      const role = await deps.getRole(body.user.id);
      const skills = discoverUserSkills();
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildSkillsModalView(body.user.id, role, skills),
      });
    } catch (error) {
      logger.error("Failed to open skills modal:", error);
    }
  });

  app.action<BlockAction>("home_open_investigations", async ({ ack, body, client }) => {
    await ack();
    try {
      if (!(await deps.userCanManageRoles(body.user.id))) return;
      if (getConfig().investigations?.enabled !== true) return;
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildInvestigationsModalView(),
      });
    } catch (error) {
      logger.error("Failed to open investigations modal:", error);
    }
  });

  app.action<BlockAction>("home_open_plugins", async ({ ack, body, client }) => {
    await ack();
    try {
      const role = await deps.getRole(body.user.id);
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildPluginsModalView(role),
      });
    } catch (error) {
      logger.error("Failed to open plugins modal:", error);
    }
  });

  app.action<BlockAction>("home_open_mcp", async ({ ack, body, client }) => {
    await ack();
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildMcpModalView(),
      });
    } catch (error) {
      logger.error("Failed to open MCP modal:", error);
    }
  });

  app.action<BlockAction>("home_open_status", async ({ ack, body, client }) => {
    await ack();
    try {
      const role = await deps.getRole(body.user.id);
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildStatusModalView(role),
      });
    } catch (error) {
      logger.error("Failed to open status modal:", error);
    }
  });

  // =========================================================================
  // Configuration modal handlers
  // =========================================================================

  // Handle [View] button on a directory — open file picker modal
  app.action<BlockAction<ButtonAction>>(
    /^view_config_dir:/,
    async ({ ack, body, client, action }) => {
      await ack();

      try {
        const dir = action.value;
        if (!dir) return;

        const listing = deps.listInstructionFiles();

        // The picker handles three kinds of directories: real roles, the pre-analysis
        // pseudo-directory, and per-repo directories. Topic files are not surfaced here
        // — the Home Tab keeps its baseline-only representation; topic editing flows
        // through chat-based MCP tools.
        const roleEntry = listing.roles.find((r) => r.role === dir);
        const isPreAnalysis = dir === "pre-analysis";
        let files: ConfigFilePickerEntry[];
        let isRepoDir: boolean;

        if (roleEntry) {
          isRepoDir = false;
          files = roleEntry.files.map((f) => ({
            filename: f.file,
            sourceLabel:
              f.status === "customized"
                ? t("home.config.source_customized")
                : f.status === "custom-only"
                  ? t("home.config.source_custom")
                  : "",
            effectiveLength: deps.getEffectiveContentLength(`${dir}/${f.file}`),
          }));
        } else if (isPreAnalysis) {
          isRepoDir = false;
          files = listing.preAnalysis.map((f) => ({
            filename: f.file,
            sourceLabel:
              f.status === "customized"
                ? t("home.config.source_customized")
                : f.status === "custom-only"
                  ? t("home.config.source_custom")
                  : "",
            effectiveLength: deps.getEffectiveContentLength(`${dir}/${f.file}`),
          }));
        } else {
          isRepoDir = true;
          const repoEntry = listing.repos.find((r) => r.repo === dir);
          files = (repoEntry?.files ?? []).map((f) => {
            const sourceLabel =
              f.status === "customized" || f.status === "custom-only"
                ? t("home.config.source_customized")
                : "";
            return {
              filename: f.file,
              sourceLabel,
              effectiveLength: deps.getEffectiveContentLength(`${dir}/${f.file}`),
            };
          });
        }

        await client.views.open({
          trigger_id: body.trigger_id,
          view: deps.buildConfigFilePickerModal(dir, files, isRepoDir),
        });
      } catch (error) {
        logger.error("Failed to open config file picker:", error);
      }
    },
  );

  // Handle [Edit] button on a file — push editor modal
  app.action<BlockAction<ButtonAction>>(
    "edit_config_file",
    async ({ ack, body, client, action }) => {
      await ack();

      try {
        const filepath = action.value;
        if (!filepath) return;

        const parts = filepath.split("/");
        if (parts.length !== 2) return;
        const [dir, filename] = parts;

        const { default_content, custom_content } = deps.readInstructionFile(filepath);

        let fileState: ConfigFileState;
        let content: string;
        if (custom_content !== null && default_content !== null) {
          fileState = "has-override";
          content = custom_content;
        } else if (custom_content !== null) {
          fileState = "custom-only";
          content = custom_content;
        } else {
          fileState = "default-only";
          content = default_content ?? "";
        }

        // Get the view ID from the body to push onto it
        const viewId = viewIdFromBody(body);
        if (!viewId) return;

        await client.views.push({
          trigger_id: body.trigger_id,
          view: deps.buildConfigEditorModal(dir, filename, content, fileState),
        });
      } catch (error) {
        logger.error("Failed to open config editor:", error);
      }
    },
  );

  // Handle editor modal submission — save file
  app.view<ViewSubmitAction>("config_editor_modal", async ({ ack, view, body, client }) => {
    const userId = body.user.id;

    if (!(await deps.userCanEditConfig(userId))) {
      await ack({
        response_action: "errors",
        errors: { content_block: t("home.config.error_no_edit_permission") },
      });
      return;
    }

    const { dir, filename } = configFileModalMetaZod.parse(JSON.parse(view.private_metadata));
    const content = view.state.values.content_block.file_content.value ?? "";

    try {
      deps.writeInstructionFile(`${dir}/${filename}`, content);
      logger.info(`User ${userId} saved config file ${dir}/${filename}`);
      await ack();
      await publishHomeView(client, userId, deps);
    } catch (error) {
      logger.error(`Failed to save config file ${dir}/${filename}:`, error);
      await ack({
        response_action: "errors",
        errors: { content_block: t("home.config.error_save_failed") },
      });
    }
  });

  // Handle [+ Create New File] button — push create modal
  app.action<BlockAction<ButtonAction>>(
    "create_config_file",
    async ({ ack, body, client, action }) => {
      await ack();

      try {
        const dir = action.value;
        if (!dir) return;

        await client.views.push({
          trigger_id: body.trigger_id,
          view: deps.buildConfigCreateFileModal(dir),
        });
      } catch (error) {
        logger.error("Failed to open create config file modal:", error);
      }
    },
  );

  // Handle create file modal submission
  app.view<ViewSubmitAction>("config_create_modal", async ({ ack, view, body, client }) => {
    const userId = body.user.id;

    if (!(await deps.userCanEditConfig(userId))) {
      await ack({
        response_action: "errors",
        errors: { filename_block: t("home.config.error_no_create_permission") },
      });
      return;
    }

    const { dir } = configCreateModalMetaZod.parse(JSON.parse(view.private_metadata));
    let filename = view.state.values.filename_block.filename.value ?? "";
    const content = view.state.values.content_block.file_content.value ?? "";

    // Append .md if not present
    if (!filename.endsWith(".md")) {
      filename = `${filename}.md`;
    }

    // Check for duplicate
    const existing = deps.readInstructionFile(`${dir}/${filename}`);
    if (existing.default_content !== null || existing.custom_content !== null) {
      await ack({
        response_action: "errors",
        errors: { filename_block: t("home.config.error_file_exists", { filename, dir }) },
      });
      return;
    }

    try {
      deps.writeInstructionFile(`${dir}/${filename}`, content);
      logger.info(`User ${userId} created config file ${dir}/${filename}`);
      await ack();
      await publishHomeView(client, userId, deps);
    } catch (error) {
      logger.error(`Failed to create config file ${dir}/${filename}:`, error);
      await ack({
        response_action: "errors",
        errors: { filename_block: t("home.config.error_create_failed") },
      });
    }
  });

  // Handle delete/reset button in editor modal
  app.action<BlockAction<ButtonAction>>(
    "delete_config_file",
    async ({ ack, body, client, action }) => {
      await ack();

      const userId = body.user.id;

      try {
        if (!(await deps.userCanEditConfig(userId))) {
          return;
        }

        const filepath = action.value;
        if (!filepath) return;

        const parts = filepath.split("/");
        if (parts.length !== 2) return;
        const [dir, filename] = parts;

        // Check if a default exists before deleting
        const { default_content } = deps.readInstructionFile(filepath);

        deps.deleteInstructionFile(filepath);
        logger.info(`User ${userId} deleted config file ${filepath}`);

        const viewId = viewIdFromBody(body);
        if (!viewId) return;

        if (default_content !== null) {
          // Default exists — update the modal to show default content
          await client.views.update({
            view_id: viewId,
            view: deps.buildConfigEditorModal(dir, filename, default_content, "default-only"),
          });
        } else {
          // Custom-only file deleted — close stacked modal by clearing it
          await client.views.update({
            view_id: viewId,
            view: {
              type: "modal",
              title: { type: "plain_text", text: t("home.config.deleted_title") },
              close: { type: "plain_text", text: t("common.close") },
              blocks: [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: t("home.config.file_deleted_text", { filename }) },
                },
              ],
            },
          });
        }

        await publishHomeView(client, userId, deps);
      } catch (error) {
        logger.error("Failed to delete config file:", error);
      }
    },
  );

  // =========================================================================
  // Auto-respond handlers
  // =========================================================================

  // Add Rule button → open modal (admin only)
  app.action<BlockAction>("ai_add_rule", async ({ ack, body, client }) => {
    await ack();
    try {
      if (!(await deps.userCanManageRoles(body.user.id))) return;
      await openOrPushModal(client, body, body.trigger_id, deps.buildAutoRespondModal());
    } catch (error) {
      logger.error("Failed to open add auto-respond rule modal:", error);
    }
  });

  // Edit Rule button → open pre-populated modal (admin only)
  app.action<BlockAction<ButtonAction>>(/^ai_edit_rule:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await deps.userCanManageRoles(body.user.id))) return;
      const ruleId = action.action_id.split(":")[1];
      const rule = await deps.getRule(ruleId);
      if (!rule) return;
      await openOrPushModal(client, body, body.trigger_id, deps.buildAutoRespondModal(rule));
    } catch (error) {
      logger.error("Failed to open edit auto-respond rule modal:", error);
    }
  });

  // Toggle Rule button (inside edit modal)
  app.action<BlockAction<ButtonAction>>(
    /^ai_toggle_rule:/,
    async ({ ack, body, client, action }) => {
      await ack();
      try {
        if (!(await deps.userCanManageRoles(body.user.id))) return;
        const ruleId = action.action_id.split(":")[1];
        const updated = await deps.toggleRule(ruleId);
        // Refresh the modal to reflect the new state
        if (updated) {
          const viewId = viewIdFromBody(body);
          if (viewId) {
            await client.views.update({
              view_id: viewId,
              view: deps.buildAutoRespondModal(updated),
            });
          }
        }
        await publishHomeView(client, body.user.id, deps);
      } catch (error) {
        logger.error("Failed to toggle auto-respond rule:", error);
      }
    },
  );

  // Stop following button on an ephemeral conversation row (admin only) — deletes the
  // channel's conversation window. The row lives inside the Auto-Respond modal, so refresh
  // that modal in place, then re-render the Home Tab underneath.
  app.action<BlockAction<ButtonAction>>(
    /^ai_stop_following:/,
    async ({ ack, body, client, action }) => {
      await ack();
      try {
        if (!(await deps.userCanManageRoles(body.user.id))) return;
        const ruleId = action.action_id.split(":")[1];
        await deps.deleteRule(ruleId);
        const viewId = viewIdFromBody(body);
        if (viewId) {
          await client.views.update({ view_id: viewId, view: await buildAutoRespondModalView() });
        }
        await publishHomeView(client, body.user.id, deps);
      } catch (error) {
        logger.error("Failed to stop following channel conversation:", error);
      }
    },
  );

  // Delete Rule button (inside edit modal — has confirm dialog)
  app.action<BlockAction<ButtonAction>>(
    /^ai_delete_rule:/,
    async ({ ack, body, client, action }) => {
      await ack();
      try {
        if (!(await deps.userCanManageRoles(body.user.id))) return;
        const ruleId = action.action_id.split(":")[1];
        await deps.deleteRule(ruleId);
        // Close the modal by replacing it with a brief confirmation
        const viewId = viewIdFromBody(body);
        if (viewId) {
          await client.views.update({
            view_id: viewId,
            view: {
              type: "modal",
              title: { type: "plain_text", text: t("home.auto_respond.deleted_title") },
              close: { type: "plain_text", text: t("common.close") },
              blocks: [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: t("home.auto_respond.deleted_text") },
                },
              ],
            },
          });
        }
        await publishHomeView(client, body.user.id, deps);
      } catch (error) {
        logger.error("Failed to delete auto-respond rule:", error);
      }
    },
  );

  // Add Rule modal submission (admin only)
  app.view<ViewSubmitAction>("ai_add_rule_modal", async ({ ack, view, body, client }) => {
    if (!(await deps.userCanManageRoles(body.user.id))) {
      await ack({
        response_action: "errors",
        errors: { channels_block: t("home.auto_respond.error_no_permission") },
      });
      return;
    }
    const read = readRuleModal(view);
    if (!read.ok) {
      await ack({ response_action: "errors", errors: read.errors });
      return;
    }
    const { channels, users, keywords, extraContext, preAnalysisContext, attentionLevel } =
      read.input;
    try {
      await deps.addRule(
        channels,
        users.length > 0 ? users : undefined,
        keywords,
        extraContext,
        preAnalysisContext,
        attentionLevel,
      );
    } catch (error) {
      logger.error("Failed to add auto-respond rule:", error);
      await ack({
        response_action: "errors",
        errors: { channels_block: t("home.auto_respond.error_save_failed") },
      });
      return;
    }
    await ack();
    await publishHomeView(client, body.user.id, deps);
  });

  // Edit Rule modal submission (admin only)
  app.view<ViewSubmitAction>("ai_edit_rule_modal", async ({ ack, view, body, client }) => {
    if (!(await deps.userCanManageRoles(body.user.id))) {
      await ack({
        response_action: "errors",
        errors: { channels_block: t("home.auto_respond.error_no_permission") },
      });
      return;
    }
    const ruleId = view.private_metadata;
    const read = readRuleModal(view);
    if (!read.ok) {
      await ack({ response_action: "errors", errors: read.errors });
      return;
    }
    const { channels, users, keywords, extraContext, preAnalysisContext, attentionLevel } =
      read.input;
    let updated: Awaited<ReturnType<HomeTabDeps["updateRule"]>>;
    try {
      updated = await deps.updateRule(ruleId, {
        channels,
        userFilters: users,
        keywords: keywords ?? [],
        extraContext: extraContext ?? "",
        preAnalysisContext: preAnalysisContext ?? "",
        attentionLevel: attentionLevel ?? "",
      });
    } catch (error) {
      logger.error(`Failed to update auto-respond rule ${ruleId}:`, error);
      await ack({
        response_action: "errors",
        errors: { channels_block: t("home.auto_respond.error_save_failed") },
      });
      return;
    }
    if (!updated) {
      await ack({
        response_action: "errors",
        errors: { channels_block: t("home.auto_respond.error_rule_gone") },
      });
      return;
    }
    await ack();
    await publishHomeView(client, body.user.id, deps);
  });

  // Handle "Chat to Edit" button — open DM with file content and close modal
  app.action<BlockAction<ButtonAction>>(
    "chat_edit_config_file",
    async ({ ack, body, client, action }) => {
      await ack();

      try {
        const filepath = action.value;
        if (!filepath) return;

        const userId = body.user.id;
        const { default_content, custom_content } = deps.readInstructionFile(filepath);
        const content = custom_content ?? default_content ?? "";

        // Open DM and upload the file, then send an intro message
        const dmChannelId = await openDmChannel(client, userId);
        if (!dmChannelId) return;

        const filename = filepath.split("/").pop() ?? filepath;
        await client.files.uploadV2({
          channel_id: dmChannelId,
          content,
          filename,
          title: filepath,
          initial_comment: t("home.config.chat_edit_intro", { filepath }),
        });

        // Close the modal by replacing it with a brief confirmation
        const viewId = viewIdFromBody(body);
        if (viewId) {
          await client.views.update({
            view_id: viewId,
            view: {
              type: "modal",
              title: { type: "plain_text", text: t("home.config.chat_to_edit") },
              close: { type: "plain_text", text: t("common.close") },
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: t("home.config.chat_edit_sent", { filepath }),
                  },
                },
              ],
            },
          });
        }
      } catch (error) {
        logger.error("Failed to start chat edit:", error);
      }
    },
  );

  // Edit scheduled message button → open modal. For plugin-managed jobs, the modal opens
  // in a read-only variant (`buildCronJobModal` branches on `job.pluginManaged`) — the
  // `cron_edit_job_modal` submission handler below still rejects plugin-managed updates.
  app.action<BlockAction<ButtonAction>>(
    /^cron_edit_job:/,
    async ({ ack, body, client, action }) => {
      await ack();
      try {
        const jobId = action.action_id.split(":")[1];
        const job = await deps.getJob(jobId);
        if (!job) return;
        const viewerTz = (await getUserInfo(client, body.user.id))?.tz;
        const role = await deps.getRole(body.user.id);
        const canShare = canToggleShared(job, { userId: body.user.id, role });
        await openOrPushModal(
          client,
          body,
          body.trigger_id,
          deps.buildCronJobModal(job, viewerTz, canShare),
        );
      } catch (error) {
        logger.error("Failed to open edit cron job modal:", error);
      }
    },
  );

  // Toggle button inside cron job modal
  app.action<BlockAction<ButtonAction>>(
    /^cron_toggle_job:/,
    async ({ ack, body, client, action }) => {
      await ack();
      try {
        const jobId = action.action_id.split(":")[1];
        const updated = await deps.toggleJob(jobId);
        if (updated) {
          const viewId = viewIdFromBody(body);
          if (viewId) {
            const viewerTz = (await getUserInfo(client, body.user.id))?.tz;
            const role = await deps.getRole(body.user.id);
            const canShare = canToggleShared(updated, { userId: body.user.id, role });
            await client.views.update({
              view_id: viewId,
              view: deps.buildCronJobModal(updated, viewerTz, canShare),
            });
          }
        }
        await publishHomeView(client, body.user.id, deps);
      } catch (error) {
        logger.error("Failed to toggle cron job:", error);
      }
    },
  );

  // Send Now button inside cron job modal
  app.action<BlockAction<ButtonAction>>(/^cron_run_job:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      const jobId = action.action_id.split(":")[1];
      const job = await deps.getJob(jobId);
      if (!job) return;

      // Close the modal with a confirmation message
      const viewId = viewIdFromBody(body);
      if (viewId) {
        await client.views.update({
          view_id: viewId,
          view: {
            type: "modal",
            title: { type: "plain_text", text: t("home.scheduled.sending_title") },
            close: { type: "plain_text", text: t("common.close") },
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: t("home.scheduled.sending_text", { channel: job.channel ?? "" }),
                },
              },
            ],
          },
        });
      }

      // Execute in background — don't block the modal interaction
      deps.runJobNow(job, client).catch((error) => {
        logger.error(`Failed to run cron job ${jobId} on demand:`, error);
      });
    } catch (error) {
      logger.error("Failed to run cron job on demand:", error);
    }
  });

  // Delete button inside cron job modal (with confirm)
  app.action<BlockAction<ButtonAction>>(
    /^cron_delete_job:/,
    async ({ ack, body, client, action }) => {
      await ack();
      try {
        const jobId = action.action_id.split(":")[1];
        // Defense in depth: the Home Tab strips the Delete button for plugin-managed jobs,
        // but reject any direct invocation too. Plugin-managed jobs are removed by editing
        // the plugin's config block, not the Home Tab.
        const existing = await deps.getJob(jobId);
        if (existing?.pluginManaged) {
          logger.warn(
            `Refused to delete plugin-managed cron job ${jobId} (plugin: ${existing.plugin ?? "unknown"})`,
          );
          return;
        }
        await deps.deleteJob(jobId);
        const viewId = viewIdFromBody(body);
        if (viewId) {
          await client.views.update({
            view_id: viewId,
            view: {
              type: "modal",
              title: { type: "plain_text", text: t("home.scheduled.deleted_title") },
              close: { type: "plain_text", text: t("common.close") },
              blocks: [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: t("home.scheduled.deleted_text") },
                },
              ],
            },
          });
        }
        await publishHomeView(client, body.user.id, deps);
      } catch (error) {
        logger.error("Failed to delete cron job:", error);
      }
    },
  );

  // Edit cron job modal submission
  app.view<ViewSubmitAction>("cron_edit_job_modal", async ({ ack, view, body, client }) => {
    const jobId = view.private_metadata;
    const nameRaw = view.state.values.cron_name_block?.cron_name.value ?? "";
    const name = nameRaw.trim();
    const channel = view.state.values.cron_channel_block.channel.selected_conversation;
    const cronExpression = view.state.values.cron_expression_block.cron_expression.value;
    const prompt = view.state.values.cron_prompt_block.prompt.value;
    const skipConditions =
      view.state.values.cron_skip_conditions_block?.skip_conditions.value ?? "";
    const jitterRaw = view.state.values.cron_jitter_block?.cron_jitter.value?.trim() ?? "";
    const sharedChecked =
      (view.state.values.cron_shared_block?.cron_shared?.selected_options?.length ?? 0) > 0;

    if (name.length === 0) {
      await ack({
        response_action: "errors",
        errors: { cron_name_block: t("home.scheduled.error_name_required") },
      });
      return;
    }
    if (!channel) {
      await ack({
        response_action: "errors",
        errors: { cron_channel_block: t("home.scheduled.error_channel_required") },
      });
      return;
    }
    if (!cronExpression) {
      await ack({
        response_action: "errors",
        errors: { cron_expression_block: t("home.scheduled.error_cron_required") },
      });
      return;
    }
    if (!prompt) {
      await ack({
        response_action: "errors",
        errors: { cron_prompt_block: t("home.scheduled.error_prompt_required") },
      });
      return;
    }

    try {
      CronExpressionParser.parse(cronExpression);
    } catch {
      await ack({
        response_action: "errors",
        errors: { cron_expression_block: t("home.scheduled.error_cron_invalid") },
      });
      return;
    }

    // Empty clears jitter (null); otherwise an integer in [0, MAX_JITTER_MINUTES].
    let jitterMinutes: number | null = null;
    if (jitterRaw.length > 0) {
      const parsed = Number(jitterRaw);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_JITTER_MINUTES) {
        await ack({
          response_action: "errors",
          errors: {
            cron_jitter_block: t("home.scheduled.error_jitter_range", { max: MAX_JITTER_MINUTES }),
          },
        });
        return;
      }
      jitterMinutes = parsed;
    }

    await ack();
    try {
      const job = await deps.getJob(jobId);
      if (!job) return;

      const role = await deps.getRole(body.user.id);
      const viewer = { userId: body.user.id, role };
      const canShare = canToggleShared(job, viewer);

      const updates: {
        name: string;
        channel: string;
        cronExpression: string;
        prompt: string;
        skipConditions: string;
        jitterMinutes: number | null;
        editableByAnyone?: boolean;
      } = {
        name,
        channel,
        cronExpression,
        prompt,
        skipConditions,
        jitterMinutes,
      };

      if (canShare && sharedChecked !== (job.editableByAnyone ?? false)) {
        updates.editableByAnyone = sharedChecked;
      }

      await deps.updateJob(jobId, updates);
      await publishHomeView(client, body.user.id, deps);
    } catch (error) {
      logger.error("Failed to update cron job:", error);
    }
  });

  // Add cron job modal submission
  // "Discard & restore" button on quarantined worker rows. Admin-gated:
  // discards uncommitted work via `git reset --hard HEAD` + `git clean -fd`,
  // then flips the worker back to idle.
  app.action<BlockAction<ButtonAction>>(
    "clack_clear_quarantine",
    async ({ ack, body, client, action }) => {
      await ack();
      try {
        if (!(await deps.userCanEditConfig(body.user.id))) {
          logger.warn(`clack_clear_quarantine: user ${body.user.id} lacks edit permission`);
          return;
        }

        const value = action.value;
        if (!value || !value.includes("/")) {
          logger.warn(`clack_clear_quarantine: missing or malformed value: ${value}`);
          return;
        }
        const slash = value.indexOf("/");
        const repo = value.slice(0, slash);
        const workerId = value.slice(slash + 1);

        const result = await deps.clearQuarantinedWorker(workerId, repo);
        if (!result.ok) {
          logger.warn(`clack_clear_quarantine: ${repo}/${workerId} failed — ${result.reason}`);
        } else {
          logger.info(`clack_clear_quarantine: ${repo}/${workerId} restored by ${body.user.id}`);
        }

        await publishHomeView(client, body.user.id, deps);
      } catch (error) {
        logger.error("Failed to clear quarantine:", error);
      }
    },
  );

  // Retry a quarantined state entry: re-validate its raw value; on success it rejoins the live set.
  // Owner/admin-gated, same gate as the worker quarantine controls. Routes to the right store.
  app.action<BlockAction<ButtonAction>>(
    "state_quarantine_retry",
    async ({ ack, body, client, action }) => {
      await ack();
      try {
        if (!(await deps.userCanEditConfig(body.user.id))) {
          logger.warn(`state_quarantine_retry: user ${body.user.id} lacks edit permission`);
          return;
        }
        const target = parseQuarantineTarget(action.value);
        if (!target) return;
        const store = getQuarantineStore(target.storeId);
        if (!store) {
          logger.warn(`state_quarantine_retry: unknown store ${target.storeId}`);
          return;
        }

        const result = await store.retry(target.key);
        if (!result.ok) {
          logger.warn(
            `state_quarantine_retry: ${target.storeId}/${target.key} still invalid — ${result.error}`,
          );
        } else {
          logger.info(
            `state_quarantine_retry: ${target.storeId}/${target.key} restored by ${body.user.id}`,
          );
        }
        await publishHomeView(client, body.user.id, deps);
      } catch (error) {
        logger.error("Failed to retry quarantined state entry:", error);
      }
    },
  );

  // Remove a quarantined state entry (the ONLY removal path — explicit, owner/admin-gated).
  app.action<BlockAction<ButtonAction>>(
    "state_quarantine_delete",
    async ({ ack, body, client, action }) => {
      await ack();
      try {
        if (!(await deps.userCanEditConfig(body.user.id))) {
          logger.warn(`state_quarantine_delete: user ${body.user.id} lacks edit permission`);
          return;
        }
        const target = parseQuarantineTarget(action.value);
        if (!target) return;
        const store = getQuarantineStore(target.storeId);
        if (!store) {
          logger.warn(`state_quarantine_delete: unknown store ${target.storeId}`);
          return;
        }

        const removed = await store.remove(target.key);
        logger.info(
          `state_quarantine_delete: ${target.storeId}/${target.key} removed=${removed} by ${body.user.id}`,
        );
        await publishHomeView(client, body.user.id, deps);
      } catch (error) {
        logger.error("Failed to remove quarantined state entry:", error);
      }
    },
  );
}

/** Read the `storeId::key` a quarantine action button carries in its `value`. */
function parseQuarantineTarget(raw: string | undefined): { storeId: string; key: string } | null {
  if (raw === undefined || !raw.includes("::")) {
    logger.warn(`state quarantine action: missing or malformed value: ${raw}`);
    return null;
  }
  const sep = raw.indexOf("::");
  return { storeId: raw.slice(0, sep), key: raw.slice(sep + 2) };
}
