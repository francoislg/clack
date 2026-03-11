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
import { userCanManageRoles } from "../../permissions.js";
import {
  buildHomeView,
  buildUserSelectModal,
  buildRemoveUserModal,
  buildSettingsModal,
} from "../homeTab.js";
import { setUserPreference } from "../../userPreferences.js";
import type { ReactionDelivery } from "../../userPreferences.js";

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

}
