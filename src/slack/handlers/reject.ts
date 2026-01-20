import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { deleteSessionInfo } from "../state.js";

export function registerRejectHandler(app: App): void {
  app.action<BlockAction>("clack_reject", async ({ ack, body, respond }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;

    // Delete the ephemeral message
    await respond({ delete_original: true });

    deleteSessionInfo(sessionId);
    logger.debug(`Rejected answer for session ${sessionId}`);
  });
}
