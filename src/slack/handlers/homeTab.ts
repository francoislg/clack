import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
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
} from "../../roles.js";
import { clearQuarantinedWorker } from "../../workers/index.js";
import { userCanManageRoles, userCanEditConfig } from "../../permissions.js";
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
  type ConfigFilePickerEntry,
  type ConfigFileState,
} from "../homeTab.js";
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

type RoleResult = { success: boolean; error?: string };

/**
 * Register a pair of button + modal handlers for adding a role.
 */
function registerAddRoleHandlers(
  app: App,
  buttonId: string,
  modalId: string,
  title: string,
  roleFn: (userId: string) => Promise<RoleResult>,
  deps: HomeTabDeps = defaultHomeTabDeps,
) {
  app.action<BlockAction>(buttonId, async ({ ack, body, client }) => {
    await ack();
    try {
      await openOrPushModal(
        client,
        body,
        body.trigger_id,
        deps.buildUserSelectModal(title, modalId, `Select user to ${title.toLowerCase()}`),
      );
    } catch (error) {
      logger.error(`Failed to open ${title} modal:`, error);
    }
  });

  app.view<ViewSubmitAction>(modalId, async ({ ack, view, body, client }) => {
    const selectedUser = view.state.values.user_select_block.selected_user.selected_user;
    const currentUserId = body.user.id;

    if (!selectedUser) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: "Please select a user" },
      });
      return;
    }
    if (!(await deps.userCanManageRoles(currentUserId))) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: `You don't have permission to ${title.toLowerCase()}s` },
      });
      return;
    }

    const result = await roleFn(selectedUser);
    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: result.error || `Failed to ${title.toLowerCase()}` },
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
  title: string,
  listKey: "admins" | "devs",
  roleFn: (userId: string) => Promise<RoleResult>,
  deps: HomeTabDeps = defaultHomeTabDeps,
) {
  app.action<BlockAction>(buttonId, async ({ ack, body, client }) => {
    await ack();
    try {
      const roles = await deps.loadRoles();
      if (roles[listKey].length === 0) return;
      await openOrPushModal(
        client,
        body,
        body.trigger_id,
        deps.buildRemoveUserModal(title, modalId, roles[listKey]),
      );
    } catch (error) {
      logger.error(`Failed to open ${title} modal:`, error);
    }
  });

  app.view<ViewSubmitAction>(modalId, async ({ ack, view, body, client }) => {
    const selectedUser = view.state.values.user_select_block.selected_user.selected_option?.value;
    const currentUserId = body.user.id;

    if (!selectedUser) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: "Please select a user" },
      });
      return;
    }
    if (!(await deps.userCanManageRoles(currentUserId))) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: `You don't have permission to ${title.toLowerCase()}s` },
      });
      return;
    }

    const result = await roleFn(selectedUser);
    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: { user_select_block: result.error || `Failed to ${title.toLowerCase()}` },
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
          "Transfer Ownership",
          "transfer_ownership_modal",
          "Select new owner",
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
          user_select_block: "Please select a user",
        },
      });
      return;
    }

    const result = await deps.transferOwnership(client, currentUserId, selectedUser);

    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: result.error || "Failed to transfer ownership",
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
    "Add Admin",
    (userId) => deps.setRole(userId, "admin"),
    deps,
  );
  registerRemoveRoleHandlers(
    app,
    "remove_admin",
    "remove_admin_modal",
    "Remove Admin",
    "admins",
    (userId) => deps.setRole(userId, "member"),
    deps,
  );
  registerAddRoleHandlers(
    app,
    "add_dev",
    "add_dev_modal",
    "Add Dev",
    (userId) => deps.setRole(userId, "dev"),
    deps,
  );
  registerRemoveRoleHandlers(
    app,
    "remove_dev",
    "remove_dev_modal",
    "Remove Dev",
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
        const selected = (
          view.state.values as {
            [key: string]: { [key: string]: { selected_options?: Array<{ value: string }> } };
          }
        )[`plugin_pref:${plugin}:${field.key}`]?.[field.key]?.selected_options;
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
  app.action<BlockAction>(/^view_config_dir:/, async ({ ack, body, client, action }) => {
    await ack();

    try {
      const dir = (action as { value?: string }).value;
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
            f.status === "customized" ? "Customized" : f.status === "custom-only" ? "Custom" : "",
          effectiveLength: deps.getEffectiveContentLength(`${dir}/${f.file}`),
        }));
      } else if (isPreAnalysis) {
        isRepoDir = false;
        files = listing.preAnalysis.map((f) => ({
          filename: f.file,
          sourceLabel:
            f.status === "customized" ? "Customized" : f.status === "custom-only" ? "Custom" : "",
          effectiveLength: deps.getEffectiveContentLength(`${dir}/${f.file}`),
        }));
      } else {
        isRepoDir = true;
        const repoEntry = listing.repos.find((r) => r.repo === dir);
        files = (repoEntry?.files ?? []).map((f) => {
          const sourceLabel =
            f.status === "customized" || f.status === "custom-only" ? "Customized" : "";
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
  });

  // Handle [Edit] button on a file — push editor modal
  app.action<BlockAction>("edit_config_file", async ({ ack, body, client, action }) => {
    await ack();

    try {
      const filepath = (action as { value?: string }).value;
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
      const viewId = (body as unknown as { view?: { id: string } }).view?.id;
      if (!viewId) return;

      await client.views.push({
        trigger_id: body.trigger_id,
        view: deps.buildConfigEditorModal(dir, filename, content, fileState),
      });
    } catch (error) {
      logger.error("Failed to open config editor:", error);
    }
  });

  // Handle editor modal submission — save file
  app.view<ViewSubmitAction>("config_editor_modal", async ({ ack, view, body, client }) => {
    const userId = body.user.id;

    if (!(await deps.userCanEditConfig(userId))) {
      await ack({
        response_action: "errors",
        errors: { content_block: "You don't have permission to edit configuration" },
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
      await ack({ response_action: "errors", errors: { content_block: "Failed to save file" } });
    }
  });

  // Handle [+ Create New File] button — push create modal
  app.action<BlockAction>("create_config_file", async ({ ack, body, client, action }) => {
    await ack();

    try {
      const dir = (action as { value?: string }).value;
      if (!dir) return;

      await client.views.push({
        trigger_id: body.trigger_id,
        view: deps.buildConfigCreateFileModal(dir),
      });
    } catch (error) {
      logger.error("Failed to open create config file modal:", error);
    }
  });

  // Handle create file modal submission
  app.view<ViewSubmitAction>("config_create_modal", async ({ ack, view, body, client }) => {
    const userId = body.user.id;

    if (!(await deps.userCanEditConfig(userId))) {
      await ack({
        response_action: "errors",
        errors: { filename_block: "You don't have permission to create files" },
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
        errors: { filename_block: `File "${filename}" already exists in ${dir}/` },
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
      await ack({ response_action: "errors", errors: { filename_block: "Failed to create file" } });
    }
  });

  // Handle delete/reset button in editor modal
  app.action<BlockAction>("delete_config_file", async ({ ack, body, client, action }) => {
    await ack();

    const userId = body.user.id;

    try {
      if (!(await deps.userCanEditConfig(userId))) {
        return;
      }

      const filepath = (action as { value?: string }).value;
      if (!filepath) return;

      const parts = filepath.split("/");
      if (parts.length !== 2) return;
      const [dir, filename] = parts;

      // Check if a default exists before deleting
      const { default_content } = deps.readInstructionFile(filepath);

      deps.deleteInstructionFile(filepath);
      logger.info(`User ${userId} deleted config file ${filepath}`);

      const viewId = (body as unknown as { view?: { id: string } }).view?.id;
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
            title: { type: "plain_text", text: "Deleted" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: `\`${filename}\` has been deleted.` },
              },
            ],
          },
        });
      }

      await publishHomeView(client, userId, deps);
    } catch (error) {
      logger.error("Failed to delete config file:", error);
    }
  });

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
  app.action<BlockAction>(/^ai_edit_rule:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await deps.userCanManageRoles(body.user.id))) return;
      const ruleId = (action as { action_id: string }).action_id.split(":")[1];
      const rule = await deps.getRule(ruleId);
      if (!rule) return;
      await openOrPushModal(client, body, body.trigger_id, deps.buildAutoRespondModal(rule));
    } catch (error) {
      logger.error("Failed to open edit auto-respond rule modal:", error);
    }
  });

  // Toggle Rule button (inside edit modal)
  app.action<BlockAction>(/^ai_toggle_rule:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await deps.userCanManageRoles(body.user.id))) return;
      const ruleId = (action as { action_id: string }).action_id.split(":")[1];
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
  });

  // Stop following button on an ephemeral conversation row (admin only) — deletes the
  // channel's conversation window. The row lives inside the Auto-Respond modal, so refresh
  // that modal in place, then re-render the Home Tab underneath.
  app.action<BlockAction>(/^ai_stop_following:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await deps.userCanManageRoles(body.user.id))) return;
      const ruleId = (action as { action_id: string }).action_id.split(":")[1];
      await deps.deleteRule(ruleId);
      const viewId = viewIdFromBody(body);
      if (viewId) {
        await client.views.update({ view_id: viewId, view: await buildAutoRespondModalView() });
      }
      await publishHomeView(client, body.user.id, deps);
    } catch (error) {
      logger.error("Failed to stop following channel conversation:", error);
    }
  });

  // Delete Rule button (inside edit modal — has confirm dialog)
  app.action<BlockAction>(/^ai_delete_rule:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await deps.userCanManageRoles(body.user.id))) return;
      const ruleId = (action as { action_id: string }).action_id.split(":")[1];
      await deps.deleteRule(ruleId);
      // Close the modal by replacing it with a brief confirmation
      const viewId = (body as unknown as { view?: { id: string } }).view?.id;
      if (viewId) {
        await client.views.update({
          view_id: viewId,
          view: {
            type: "modal",
            title: { type: "plain_text", text: "Deleted" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "Rule deleted." },
              },
            ],
          },
        });
      }
      await publishHomeView(client, body.user.id, deps);
    } catch (error) {
      logger.error("Failed to delete auto-respond rule:", error);
    }
  });

  // Add Rule modal submission (admin only)
  app.view<ViewSubmitAction>("ai_add_rule_modal", async ({ ack, view, body, client }) => {
    if (!(await deps.userCanManageRoles(body.user.id))) {
      await ack({
        response_action: "errors",
        errors: { channels_block: "You don't have permission to manage auto-respond rules" },
      });
      return;
    }
    const channels = view.state.values.channels_block.channels.selected_conversations;
    if (!channels || channels.length === 0) {
      await ack({
        response_action: "errors",
        errors: { channels_block: "Select at least one channel" },
      });
      return;
    }
    const users = view.state.values.users_block.users.selected_users;
    const keywordsRaw = view.state.values.keywords_block?.keywords?.value;
    const keywords = parseKeywords(keywordsRaw);
    const extraContext = view.state.values.extra_context_block?.extra_context?.value;
    const preAnalysisContext = view.state.values.pre_analysis_block?.pre_analysis_context?.value;
    await deps.addRule(
      channels,
      users && users.length > 0 ? users : undefined,
      keywords,
      extraContext ?? undefined,
      preAnalysisContext ?? undefined,
    );
    await ack();
    await publishHomeView(client, body.user.id, deps);
  });

  // Edit Rule modal submission (admin only)
  app.view<ViewSubmitAction>("ai_edit_rule_modal", async ({ ack, view, body, client }) => {
    if (!(await deps.userCanManageRoles(body.user.id))) {
      await ack({
        response_action: "errors",
        errors: { channels_block: "You don't have permission to manage auto-respond rules" },
      });
      return;
    }
    const ruleId = view.private_metadata;
    const channels = view.state.values.channels_block.channels.selected_conversations;
    if (!channels || channels.length === 0) {
      await ack({
        response_action: "errors",
        errors: { channels_block: "Select at least one channel" },
      });
      return;
    }
    const users = view.state.values.users_block.users.selected_users;
    const keywordsRaw = view.state.values.keywords_block?.keywords?.value;
    const keywords = parseKeywords(keywordsRaw);
    const extraContext = view.state.values.extra_context_block?.extra_context?.value;
    const preAnalysisContext = view.state.values.pre_analysis_block?.pre_analysis_context?.value;
    const updated = await deps.updateRule(ruleId, {
      channels,
      userFilters: users ?? [],
      keywords: keywords ?? [],
      extraContext: extraContext ?? "",
      preAnalysisContext: preAnalysisContext ?? "",
    });
    if (!updated) {
      await ack({
        response_action: "errors",
        errors: { channels_block: "Rule no longer exists (it may have been deleted)" },
      });
      return;
    }
    await ack();
    await publishHomeView(client, body.user.id, deps);
  });

  // Handle "Chat to Edit" button — open DM with file content and close modal
  app.action<BlockAction>("chat_edit_config_file", async ({ ack, body, client, action }) => {
    await ack();

    try {
      const filepath = (action as { value?: string }).value;
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
        initial_comment: `Here's the current content of \`${filepath}\`. Reply with your changes or instructions for how to update this file.`,
      });

      // Close the modal by replacing it with a brief confirmation
      const viewId = (body as unknown as { view?: { id: string } }).view?.id;
      if (viewId) {
        await client.views.update({
          view_id: viewId,
          view: {
            type: "modal",
            title: { type: "plain_text", text: "Chat to Edit" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `Sent \`${filepath}\` to your DMs. Check your messages.`,
                },
              },
            ],
          },
        });
      }
    } catch (error) {
      logger.error("Failed to start chat edit:", error);
    }
  });

  // Edit scheduled message button → open modal. For plugin-managed jobs, the modal opens
  // in a read-only variant (`buildCronJobModal` branches on `job.pluginManaged`) — the
  // `cron_edit_job_modal` submission handler below still rejects plugin-managed updates.
  app.action<BlockAction>(/^cron_edit_job:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      const jobId = (action as { action_id: string }).action_id.split(":")[1];
      const job = await deps.getJob(jobId);
      if (!job) return;
      const viewerTz = (await getUserInfo(client, body.user.id))?.tz;
      await openOrPushModal(client, body, body.trigger_id, deps.buildCronJobModal(job, viewerTz));
    } catch (error) {
      logger.error("Failed to open edit cron job modal:", error);
    }
  });

  // Toggle button inside cron job modal
  app.action<BlockAction>(/^cron_toggle_job:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      const jobId = (action as { action_id: string }).action_id.split(":")[1];
      const updated = await deps.toggleJob(jobId);
      if (updated) {
        const viewId = viewIdFromBody(body);
        if (viewId) {
          const viewerTz = (await getUserInfo(client, body.user.id))?.tz;
          await client.views.update({
            view_id: viewId,
            view: deps.buildCronJobModal(updated, viewerTz),
          });
        }
      }
      await publishHomeView(client, body.user.id, deps);
    } catch (error) {
      logger.error("Failed to toggle cron job:", error);
    }
  });

  // Send Now button inside cron job modal
  app.action<BlockAction>(/^cron_run_job:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      const jobId = (action as { action_id: string }).action_id.split(":")[1];
      const job = await deps.getJob(jobId);
      if (!job) return;

      // Close the modal with a confirmation message
      const viewId = (body as unknown as { view?: { id: string } }).view?.id;
      if (viewId) {
        await client.views.update({
          view_id: viewId,
          view: {
            type: "modal",
            title: { type: "plain_text", text: "Sending..." },
            close: { type: "plain_text", text: "Close" },
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `Running scheduled message in <#${job.channel}>. This may take a moment.`,
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
  app.action<BlockAction>(/^cron_delete_job:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      const jobId = (action as { action_id: string }).action_id.split(":")[1];
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
      const viewId = (body as unknown as { view?: { id: string } }).view?.id;
      if (viewId) {
        await client.views.update({
          view_id: viewId,
          view: {
            type: "modal",
            title: { type: "plain_text", text: "Deleted" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "Scheduled message deleted." },
              },
            ],
          },
        });
      }
      await publishHomeView(client, body.user.id, deps);
    } catch (error) {
      logger.error("Failed to delete cron job:", error);
    }
  });

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

    if (name.length === 0) {
      await ack({
        response_action: "errors",
        errors: { cron_name_block: "Provide a short descriptive name" },
      });
      return;
    }
    if (!channel) {
      await ack({ response_action: "errors", errors: { cron_channel_block: "Select a channel" } });
      return;
    }
    if (!cronExpression) {
      await ack({
        response_action: "errors",
        errors: { cron_expression_block: "Provide a cron expression" },
      });
      return;
    }
    if (!prompt) {
      await ack({ response_action: "errors", errors: { cron_prompt_block: "Provide a prompt" } });
      return;
    }

    try {
      CronExpressionParser.parse(cronExpression);
    } catch {
      await ack({
        response_action: "errors",
        errors: { cron_expression_block: "Invalid cron expression" },
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
            cron_jitter_block: `Enter a whole number of minutes between 0 and ${MAX_JITTER_MINUTES}`,
          },
        });
        return;
      }
      jitterMinutes = parsed;
    }

    await ack();
    try {
      await deps.updateJob(jobId, {
        name,
        channel,
        cronExpression,
        prompt,
        // Empty string clears; a non-empty string sets.
        skipConditions,
        jitterMinutes,
      });
      await publishHomeView(client, body.user.id, deps);
    } catch (error) {
      logger.error("Failed to update cron job:", error);
    }
  });

  // "Discard & restore" button on quarantined worker rows. Admin-gated:
  // discards uncommitted work via `git reset --hard HEAD` + `git clean -fd`,
  // then flips the worker back to idle.
  app.action<BlockAction>("clack_clear_quarantine", async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await deps.userCanEditConfig(body.user.id))) {
        logger.warn(`clack_clear_quarantine: user ${body.user.id} lacks edit permission`);
        return;
      }

      const value = (action as { value?: string }).value;
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
  });

  // Retry a quarantined state entry: re-validate its raw value; on success it rejoins the live set.
  // Owner/admin-gated, same gate as the worker quarantine controls. Routes to the right store.
  app.action<BlockAction>("state_quarantine_retry", async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await deps.userCanEditConfig(body.user.id))) {
        logger.warn(`state_quarantine_retry: user ${body.user.id} lacks edit permission`);
        return;
      }
      const target = parseQuarantineTarget(action as { value?: string });
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
  });

  // Remove a quarantined state entry (the ONLY removal path — explicit, owner/admin-gated).
  app.action<BlockAction>("state_quarantine_delete", async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await deps.userCanEditConfig(body.user.id))) {
        logger.warn(`state_quarantine_delete: user ${body.user.id} lacks edit permission`);
        return;
      }
      const target = parseQuarantineTarget(action as { value?: string });
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
  });
}

/** Read the `storeId::key` a quarantine action button carries in its `value`. */
function parseQuarantineTarget(action: {
  value?: string;
}): { storeId: string; key: string } | null {
  const raw = action.value;
  if (raw === undefined || !raw.includes("::")) {
    logger.warn(`state quarantine action: missing or malformed value: ${raw}`);
    return null;
  }
  const sep = raw.indexOf("::");
  return { storeId: raw.slice(0, sep), key: raw.slice(sep + 2) };
}
