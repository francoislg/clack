import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import {
  loadRoles,
  getRole,
  setOwner,
  addAdmin,
  removeAdmin,
  addDev,
  removeDev,
  isUserDisabled,
  claimOwnershipFromDisabled,
  transferOwnership,
  hasOwner,
  isAdmin,
} from "../../roles.js";
import {
  buildHomeView,
  buildUserSelectModal,
  buildRemoveUserModal,
} from "../homeTab.js";

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

  // Handle Add Admin button - opens modal
  app.action<BlockAction>("add_admin", async ({ ack, body, client }) => {
    await ack();

    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildUserSelectModal(
          "Add Admin",
          "add_admin_modal",
          "Select user to add as admin"
        ),
      });
    } catch (error) {
      logger.error("Failed to open add admin modal:", error);
    }
  });

  // Handle Add Admin modal submission
  app.view<ViewSubmitAction>("add_admin_modal", async ({ ack, view, body, client }) => {
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

    // Verify current user is admin
    const userIsAdmin = await isAdmin(currentUserId);
    if (!userIsAdmin) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: "You don't have permission to add admins",
        },
      });
      return;
    }

    const result = await addAdmin(selectedUser);

    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: result.error || "Failed to add admin",
        },
      });
      return;
    }

    await ack();
    await publishHomeView(client, currentUserId);
  });

  // Handle Remove Admin button - opens modal
  app.action<BlockAction>("remove_admin", async ({ ack, body, client }) => {
    await ack();

    try {
      const roles = await loadRoles();

      if (roles.admins.length === 0) {
        return;
      }

      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildRemoveUserModal(
          "Remove Admin",
          "remove_admin_modal",
          roles.admins
        ),
      });
    } catch (error) {
      logger.error("Failed to open remove admin modal:", error);
    }
  });

  // Handle Remove Admin modal submission
  app.view<ViewSubmitAction>("remove_admin_modal", async ({ ack, view, body, client }) => {
    const selectedUser = view.state.values.user_select_block.selected_user.selected_option?.value;
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

    // Verify current user is admin
    const userIsAdmin = await isAdmin(currentUserId);
    if (!userIsAdmin) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: "You don't have permission to remove admins",
        },
      });
      return;
    }

    const result = await removeAdmin(selectedUser);

    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: result.error || "Failed to remove admin",
        },
      });
      return;
    }

    await ack();
    await publishHomeView(client, currentUserId);
  });

  // Handle Add Dev button - opens modal
  app.action<BlockAction>("add_dev", async ({ ack, body, client }) => {
    await ack();

    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildUserSelectModal(
          "Add Dev",
          "add_dev_modal",
          "Select user to add as dev"
        ),
      });
    } catch (error) {
      logger.error("Failed to open add dev modal:", error);
    }
  });

  // Handle Add Dev modal submission
  app.view<ViewSubmitAction>("add_dev_modal", async ({ ack, view, body, client }) => {
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

    // Verify current user is admin
    const userIsAdmin = await isAdmin(currentUserId);
    if (!userIsAdmin) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: "You don't have permission to add devs",
        },
      });
      return;
    }

    const result = await addDev(selectedUser);

    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: result.error || "Failed to add dev",
        },
      });
      return;
    }

    await ack();
    await publishHomeView(client, currentUserId);
  });

  // Handle Remove Dev button - opens modal
  app.action<BlockAction>("remove_dev", async ({ ack, body, client }) => {
    await ack();

    try {
      const roles = await loadRoles();

      if (roles.devs.length === 0) {
        return;
      }

      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildRemoveUserModal(
          "Remove Dev",
          "remove_dev_modal",
          roles.devs
        ),
      });
    } catch (error) {
      logger.error("Failed to open remove dev modal:", error);
    }
  });

  // Handle Remove Dev modal submission
  app.view<ViewSubmitAction>("remove_dev_modal", async ({ ack, view, body, client }) => {
    const selectedUser = view.state.values.user_select_block.selected_user.selected_option?.value;
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

    // Verify current user is admin
    const userIsAdmin = await isAdmin(currentUserId);
    if (!userIsAdmin) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: "You don't have permission to remove devs",
        },
      });
      return;
    }

    const result = await removeDev(selectedUser);

    if (!result.success) {
      await ack({
        response_action: "errors",
        errors: {
          user_select_block: result.error || "Failed to remove dev",
        },
      });
      return;
    }

    await ack();
    await publishHomeView(client, currentUserId);
  });
}
