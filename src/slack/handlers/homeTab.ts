import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import {
  loadRoles,
  setOwner,
  addAdmin,
  removeAdmin,
  addDev,
  removeDev,
  isUserDisabled,
  claimOwnershipFromDisabled,
  transferOwnership,
  hasOwner,
} from "../../roles.js";
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
  type ConfigFilePickerEntry,
  type ConfigFileState,
} from "../homeTab.js";
import {
  addRule,
  updateRule,
  toggleRule,
  deleteRule,
  getRule,
} from "../../autoRespond.js";
import {
  listInstructionFiles,
  readInstructionFile,
  writeInstructionFile,
  deleteInstructionFile,
  getEffectiveContentLength,
} from "../../configurationFiles.js";
import { setUserPreference } from "../../userPreferences.js";
import type { ReactionDelivery } from "../../userPreferences.js";
import { toggleJob, deleteJob, getJob, updateJob } from "../../cronJobs.js";
import { runJobNow } from "../../cronScheduler.js";
import { CronExpressionParser } from "cron-parser";

/** Parse comma-separated keywords input into a trimmed array, or undefined if empty. */
function parseKeywords(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined;
  const keywords = raw.split(",").map((k) => k.trim()).filter(Boolean);
  return keywords.length > 0 ? keywords : undefined;
}

async function publishHomeView(
  client: App["client"],
  userId: string
): Promise<void> {
  // Check if owner is disabled (for claim UI)
  const roles = await loadRoles();
  let ownerDisabled = false;

  if (roles.owner) {
    ownerDisabled = await isUserDisabled(client, roles.owner);
  }

  const view = await buildHomeView({ userId, ownerDisabled });

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
) {
  app.action<BlockAction>(buttonId, async ({ ack, body, client }) => {
    await ack();
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildUserSelectModal(title, modalId, `Select user to ${title.toLowerCase()}`),
      });
    } catch (error) {
      logger.error(`Failed to open ${title} modal:`, error);
    }
  });

  app.view<ViewSubmitAction>(modalId, async ({ ack, view, body, client }) => {
    const selectedUser = view.state.values.user_select_block.selected_user.selected_user;
    const currentUserId = body.user.id;

    if (!selectedUser) {
      await ack({ response_action: "errors", errors: { user_select_block: "Please select a user" } });
      return;
    }
    if (!(await userCanManageRoles(currentUserId))) {
      await ack({ response_action: "errors", errors: { user_select_block: `You don't have permission to ${title.toLowerCase()}s` } });
      return;
    }

    const result = await roleFn(selectedUser);
    if (!result.success) {
      await ack({ response_action: "errors", errors: { user_select_block: result.error || `Failed to ${title.toLowerCase()}` } });
      return;
    }

    await ack();
    await publishHomeView(client, currentUserId);
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
) {
  app.action<BlockAction>(buttonId, async ({ ack, body, client }) => {
    await ack();
    try {
      const roles = await loadRoles();
      if (roles[listKey].length === 0) return;
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildRemoveUserModal(title, modalId, roles[listKey]),
      });
    } catch (error) {
      logger.error(`Failed to open ${title} modal:`, error);
    }
  });

  app.view<ViewSubmitAction>(modalId, async ({ ack, view, body, client }) => {
    const selectedUser = view.state.values.user_select_block.selected_user.selected_option?.value;
    const currentUserId = body.user.id;

    if (!selectedUser) {
      await ack({ response_action: "errors", errors: { user_select_block: "Please select a user" } });
      return;
    }
    if (!(await userCanManageRoles(currentUserId))) {
      await ack({ response_action: "errors", errors: { user_select_block: `You don't have permission to ${title.toLowerCase()}s` } });
      return;
    }

    const result = await roleFn(selectedUser);
    if (!result.success) {
      await ack({ response_action: "errors", errors: { user_select_block: result.error || `Failed to ${title.toLowerCase()}` } });
      return;
    }

    await ack();
    await publishHomeView(client, currentUserId);
  });
}

export function registerHomeTabHandler(app: App): void {
  // Handle Home tab opened event
  app.event("app_home_opened", async ({ event, client }) => {
    try {
      logger.debug(`Home tab opened by user ${event.user}`);
      await publishHomeView(client, event.user);
    } catch (error) {
      logger.error("Failed to publish home view:", error);
    }
  });

  // Handle Claim Ownership button
  app.action<BlockAction>("claim_ownership", async ({ ack, body, client }) => {
    await ack();

    const userId = body.user.id;

    try {
      const hasAnOwner = await hasOwner();

      if (!hasAnOwner) {
        // No owner, claim directly
        await setOwner(userId);
        logger.info(`User ${userId} claimed ownership (first owner)`);
      } else {
        // Owner exists, try to claim from disabled owner
        const result = await claimOwnershipFromDisabled(client, userId);
        if (!result.success) {
          logger.warn(`User ${userId} failed to claim ownership: ${result.error}`);
          // Could show an error message here
          return;
        }
      }

      // Refresh the home view
      await publishHomeView(client, userId);
    } catch (error) {
      logger.error("Failed to claim ownership:", error);
    }
  });

  // Handle Transfer Ownership button - opens modal
  app.action<BlockAction>("transfer_ownership", async ({ ack, body, client }) => {
    await ack();

    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildUserSelectModal(
          "Transfer Ownership",
          "transfer_ownership_modal",
          "Select new owner"
        ),
      });
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

    const result = await transferOwnership(client, currentUserId, selectedUser);

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
    await publishHomeView(client, currentUserId);
    await publishHomeView(client, selectedUser);
  });

  // Role management handlers (add/remove admin & dev)
  registerAddRoleHandlers(app, "add_admin", "add_admin_modal", "Add Admin", addAdmin);
  registerRemoveRoleHandlers(app, "remove_admin", "remove_admin_modal", "Remove Admin", "admins", removeAdmin);
  registerAddRoleHandlers(app, "add_dev", "add_dev_modal", "Add Dev", addDev);
  registerRemoveRoleHandlers(app, "remove_dev", "remove_dev_modal", "Remove Dev", "devs", removeDev);

  // Handle Settings button
  app.action<BlockAction>("open_settings", async ({ ack, body, client }) => {
    await ack();

    const userId = body.user.id;

    try {
      const view = await buildSettingsModal(userId);
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

    // Extract preference values from modal
    const deliveryValue = view.state.values.response_delivery_block?.response_delivery?.selected_option?.value;
    const notifyValue = view.state.values.notify_on_response_block?.notify_on_response?.selected_option?.value;

    const updates: string[] = [];

    if (deliveryValue === "dm" || deliveryValue === "thread") {
      await setUserPreference(userId, "reactionDelivery", deliveryValue as ReactionDelivery);
      updates.push(`reactionDelivery=${deliveryValue}`);
    }

    if (notifyValue === "true" || notifyValue === "false") {
      await setUserPreference(userId, "notifyOnResponse", notifyValue === "true");
      updates.push(`notifyOnResponse=${notifyValue}`);
    }

    if (updates.length > 0) {
      logger.info(`User ${userId} updated settings: ${updates.join(", ")}`);
    }

    await ack();

    // Refresh the Home Tab
    await publishHomeView(client, userId);
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

      const listing = listInstructionFiles();

      // Check if this is a role directory or repo directory
      const roleListing = listing.roles.find((r) => r.role === dir);
      let files: ConfigFilePickerEntry[];
      let isRepoDir: boolean;

      if (roleListing) {
        isRepoDir = false;
        files = roleListing.files.map((f) => ({
          filename: f.filename,
          sourceLabel: f.source === "customized" ? "Customized" : f.source === "custom-only" ? "Custom" : "",
          effectiveLength: getEffectiveContentLength(`${dir}/${f.filename}`),
        }));
      } else {
        isRepoDir = true;
        const repoFiles = listing.repos.filter((r) => r.filename.startsWith(`${dir}/`));
        files = repoFiles.map((f) => {
          const filename = f.filename.split("/").slice(1).join("/");
          const sourceLabel = f.hasOverride ? "Customized" : "";
          return {
            filename,
            sourceLabel,
            effectiveLength: getEffectiveContentLength(f.filename),
          };
        });
      }

      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildConfigFilePickerModal(dir, files, isRepoDir),
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

      const { default_content, custom_content } = readInstructionFile(filepath);

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
        view: buildConfigEditorModal(dir, filename, content, fileState),
      });
    } catch (error) {
      logger.error("Failed to open config editor:", error);
    }
  });

  // Handle editor modal submission — save file
  app.view<ViewSubmitAction>("config_editor_modal", async ({ ack, view, body, client }) => {
    const userId = body.user.id;

    if (!(await userCanEditConfig(userId))) {
      await ack({ response_action: "errors", errors: { content_block: "You don't have permission to edit configuration" } });
      return;
    }

    const metadata = JSON.parse(view.private_metadata);
    const { dir, filename } = metadata as { dir: string; filename: string };
    const content = view.state.values.content_block.file_content.value ?? "";

    try {
      writeInstructionFile(`${dir}/${filename}`, content);
      logger.info(`User ${userId} saved config file ${dir}/${filename}`);
      await ack();
      await publishHomeView(client, userId);
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
        view: buildConfigCreateFileModal(dir),
      });
    } catch (error) {
      logger.error("Failed to open create config file modal:", error);
    }
  });

  // Handle create file modal submission
  app.view<ViewSubmitAction>("config_create_modal", async ({ ack, view, body, client }) => {
    const userId = body.user.id;

    if (!(await userCanEditConfig(userId))) {
      await ack({ response_action: "errors", errors: { filename_block: "You don't have permission to create files" } });
      return;
    }

    const metadata = JSON.parse(view.private_metadata);
    const { dir } = metadata as { dir: string };
    let filename = view.state.values.filename_block.filename.value ?? "";
    const content = view.state.values.content_block.file_content.value ?? "";

    // Append .md if not present
    if (!filename.endsWith(".md")) {
      filename = `${filename}.md`;
    }

    // Check for duplicate
    const existing = readInstructionFile(`${dir}/${filename}`);
    if (existing.default_content !== null || existing.custom_content !== null) {
      await ack({ response_action: "errors", errors: { filename_block: `File "${filename}" already exists in ${dir}/` } });
      return;
    }

    try {
      writeInstructionFile(`${dir}/${filename}`, content);
      logger.info(`User ${userId} created config file ${dir}/${filename}`);
      await ack();
      await publishHomeView(client, userId);
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
      if (!(await userCanEditConfig(userId))) {
        return;
      }

      const filepath = (action as { value?: string }).value;
      if (!filepath) return;

      const parts = filepath.split("/");
      if (parts.length !== 2) return;
      const [dir, filename] = parts;

      // Check if a default exists before deleting
      const { default_content } = readInstructionFile(filepath);

      deleteInstructionFile(filepath);
      logger.info(`User ${userId} deleted config file ${filepath}`);

      const viewId = (body as unknown as { view?: { id: string } }).view?.id;
      if (!viewId) return;

      if (default_content !== null) {
        // Default exists — update the modal to show default content
        await client.views.update({
          view_id: viewId,
          view: buildConfigEditorModal(dir, filename, default_content, "default-only"),
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

      await publishHomeView(client, userId);
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
      if (!(await userCanManageRoles(body.user.id))) return;
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildAutoRespondModal(),
      });
    } catch (error) {
      logger.error("Failed to open add auto-respond rule modal:", error);
    }
  });

  // Edit Rule button → open pre-populated modal (admin only)
  app.action<BlockAction>(/^ai_edit_rule:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await userCanManageRoles(body.user.id))) return;
      const ruleId = (action as { action_id: string }).action_id.split(":")[1];
      const rule = await getRule(ruleId);
      if (!rule) return;
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildAutoRespondModal(rule),
      });
    } catch (error) {
      logger.error("Failed to open edit auto-respond rule modal:", error);
    }
  });

  // Toggle Rule button (inside edit modal)
  app.action<BlockAction>(/^ai_toggle_rule:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await userCanManageRoles(body.user.id))) return;
      const ruleId = (action as { action_id: string }).action_id.split(":")[1];
      const updated = await toggleRule(ruleId);
      // Refresh the modal to reflect the new state
      if (updated) {
        const viewId = (body as unknown as { view?: { id: string } }).view?.id;
        if (viewId) {
          await client.views.update({
            view_id: viewId,
            view: buildAutoRespondModal(updated),
          });
        }
      }
      await publishHomeView(client, body.user.id);
    } catch (error) {
      logger.error("Failed to toggle auto-respond rule:", error);
    }
  });

  // Delete Rule button (inside edit modal — has confirm dialog)
  app.action<BlockAction>(/^ai_delete_rule:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      if (!(await userCanManageRoles(body.user.id))) return;
      const ruleId = (action as { action_id: string }).action_id.split(":")[1];
      await deleteRule(ruleId);
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
      await publishHomeView(client, body.user.id);
    } catch (error) {
      logger.error("Failed to delete auto-respond rule:", error);
    }
  });

  // Add Rule modal submission (admin only)
  app.view<ViewSubmitAction>("ai_add_rule_modal", async ({ ack, view, body, client }) => {
    if (!(await userCanManageRoles(body.user.id))) {
      await ack({ response_action: "errors", errors: { channels_block: "You don't have permission to manage auto-respond rules" } });
      return;
    }
    const channels = view.state.values.channels_block.channels.selected_conversations;
    if (!channels || channels.length === 0) {
      await ack({ response_action: "errors", errors: { channels_block: "Select at least one channel" } });
      return;
    }
    const users = view.state.values.users_block.users.selected_users;
    const keywordsRaw = view.state.values.keywords_block?.keywords?.value;
    const keywords = parseKeywords(keywordsRaw);
    const extraContext = view.state.values.extra_context_block?.extra_context?.value;
    const preAnalysisContext = view.state.values.pre_analysis_block?.pre_analysis_context?.value;
    await addRule(channels, users && users.length > 0 ? users : undefined, keywords, extraContext ?? undefined, preAnalysisContext ?? undefined);
    await ack();
    await publishHomeView(client, body.user.id);
  });

  // Edit Rule modal submission (admin only)
  app.view<ViewSubmitAction>("ai_edit_rule_modal", async ({ ack, view, body, client }) => {
    if (!(await userCanManageRoles(body.user.id))) {
      await ack({ response_action: "errors", errors: { channels_block: "You don't have permission to manage auto-respond rules" } });
      return;
    }
    const ruleId = view.private_metadata;
    const channels = view.state.values.channels_block.channels.selected_conversations;
    if (!channels || channels.length === 0) {
      await ack({ response_action: "errors", errors: { channels_block: "Select at least one channel" } });
      return;
    }
    const users = view.state.values.users_block.users.selected_users;
    const keywordsRaw = view.state.values.keywords_block?.keywords?.value;
    const keywords = parseKeywords(keywordsRaw);
    const extraContext = view.state.values.extra_context_block?.extra_context?.value;
    const preAnalysisContext = view.state.values.pre_analysis_block?.pre_analysis_context?.value;
    await updateRule(ruleId, channels, users && users.length > 0 ? users : undefined, keywords, extraContext ?? undefined, preAnalysisContext ?? undefined);
    await ack();
    await publishHomeView(client, body.user.id);
  });

  // Handle "Chat to Edit" button — open DM with file content and close modal
  app.action<BlockAction>("chat_edit_config_file", async ({ ack, body, client, action }) => {
    await ack();

    try {
      const filepath = (action as { value?: string }).value;
      if (!filepath) return;

      const userId = body.user.id;
      const { default_content, custom_content } = readInstructionFile(filepath);
      const content = custom_content ?? default_content ?? "";

      // Open DM and upload the file, then send an intro message
      const conversation = await client.conversations.open({ users: userId });
      const dmChannelId = conversation.channel?.id;
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
                text: { type: "mrkdwn", text: `Sent \`${filepath}\` to your DMs. Check your messages.` },
              },
            ],
          },
        });
      }
    } catch (error) {
      logger.error("Failed to start chat edit:", error);
    }
  });

  // Edit scheduled message button → open modal
  app.action<BlockAction>(/^cron_edit_job:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      const jobId = (action as { action_id: string }).action_id.split(":")[1];
      const job = await getJob(jobId);
      if (!job) return;
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildCronJobModal(job),
      });
    } catch (error) {
      logger.error("Failed to open edit cron job modal:", error);
    }
  });

  // Toggle button inside cron job modal
  app.action<BlockAction>(/^cron_toggle_job:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      const jobId = (action as { action_id: string }).action_id.split(":")[1];
      const updated = await toggleJob(jobId);
      if (updated) {
        const viewId = (body as unknown as { view?: { id: string } }).view?.id;
        if (viewId) {
          await client.views.update({
            view_id: viewId,
            view: buildCronJobModal(updated),
          });
        }
      }
      await publishHomeView(client, body.user.id);
    } catch (error) {
      logger.error("Failed to toggle cron job:", error);
    }
  });

  // Send Now button inside cron job modal
  app.action<BlockAction>(/^cron_run_job:/, async ({ ack, body, client, action }) => {
    await ack();
    try {
      const jobId = (action as { action_id: string }).action_id.split(":")[1];
      const job = await getJob(jobId);
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
                text: { type: "mrkdwn", text: `Running scheduled message in <#${job.channel}>. This may take a moment.` },
              },
            ],
          },
        });
      }

      // Execute in background — don't block the modal interaction
      runJobNow(job, client).catch((error) => {
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
      await deleteJob(jobId);
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
      await publishHomeView(client, body.user.id);
    } catch (error) {
      logger.error("Failed to delete cron job:", error);
    }
  });

  // Edit cron job modal submission
  app.view<ViewSubmitAction>("cron_edit_job_modal", async ({ ack, view, body, client }) => {
    const jobId = view.private_metadata;
    const channel = view.state.values.cron_channel_block.channel.selected_conversation;
    const cronExpression = view.state.values.cron_expression_block.cron_expression.value;
    const prompt = view.state.values.cron_prompt_block.prompt.value;

    if (!channel) {
      await ack({ response_action: "errors", errors: { cron_channel_block: "Select a channel" } });
      return;
    }
    if (!cronExpression) {
      await ack({ response_action: "errors", errors: { cron_expression_block: "Provide a cron expression" } });
      return;
    }
    if (!prompt) {
      await ack({ response_action: "errors", errors: { cron_prompt_block: "Provide a prompt" } });
      return;
    }

    try {
      CronExpressionParser.parse(cronExpression);
    } catch {
      await ack({ response_action: "errors", errors: { cron_expression_block: "Invalid cron expression" } });
      return;
    }

    await ack();
    try {
      await updateJob(jobId, {
        channel,
        cronExpression,
        prompt,
      });
      await publishHomeView(client, body.user.id);
    } catch (error) {
      logger.error("Failed to update cron job:", error);
    }
  });

}
