/**
 * Investigations Home Tab section action handlers.
 * Registers listeners for channel selection and investigation close actions.
 */

import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { isAdmin } from "../../roles.js";
import {
  getInvestigationsChannel,
  setInvestigationsChannel,
  closeInvestigation,
  listOpenInvestigations,
} from "../../investigations/state.js";
import { publishHomeView } from "./homeTab.js";

export interface InvestigationsHomeActionsDeps {
  getInvestigationsChannel: typeof getInvestigationsChannel;
  setInvestigationsChannel: typeof setInvestigationsChannel;
  closeInvestigation: typeof closeInvestigation;
  listOpenInvestigations: typeof listOpenInvestigations;
  isAdmin: typeof isAdmin;
  publishHomeView: (client: App["client"], userId: string) => Promise<void>;
}

export const defaultInvestigationsHomeActionsDeps: InvestigationsHomeActionsDeps = {
  getInvestigationsChannel,
  setInvestigationsChannel,
  closeInvestigation,
  listOpenInvestigations,
  isAdmin,
  publishHomeView,
};

export function registerInvestigationsHomeActions(
  app: App,
  deps: InvestigationsHomeActionsDeps = defaultInvestigationsHomeActionsDeps,
): void {
  // Handle investigations channel selection
  app.action<BlockAction>("investigations_select_channel", async ({ ack, body, client }) => {
    await ack();
    try {
      const userId = body.user.id;
      // The section only renders for admins, but the action_id could be invoked directly —
      // re-check authorization here so a crafted call can't reassign the investigations channel.
      if (!(await deps.isAdmin(userId))) {
        logger.warn(`investigations: ${userId} attempted channel select without admin rights`);
        return;
      }
      const action = body.actions[0];
      const selectedConversation =
        "selected_conversation" in action && typeof action.selected_conversation === "string"
          ? action.selected_conversation
          : null;

      await deps.setInvestigationsChannel(selectedConversation);
      await deps.publishHomeView(client, userId);
    } catch (error) {
      logger.error("Error in investigations_select_channel handler:", error);
    }
  });

  // Handle closing an investigation
  app.action<BlockAction>("investigations_close", async ({ ack, body, client }) => {
    await ack();
    try {
      const userId = body.user.id;
      if (!(await deps.isAdmin(userId))) {
        logger.warn(
          `investigations: ${userId} attempted to close an investigation without admin rights`,
        );
        return;
      }
      const action = body.actions[0];
      const sessionId = "value" in action && typeof action.value === "string" ? action.value : "";

      if (sessionId) {
        await deps.closeInvestigation(sessionId);
      }

      await deps.publishHomeView(client, userId);
    } catch (error) {
      logger.error("Error in investigations_close handler:", error);
    }
  });
}
