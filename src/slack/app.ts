import { App } from "@slack/bolt";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { registerNewQueryHandler } from "./handlers/newQuery.js";
import { registerRetryHandler } from "./handlers/retry.js";
import { registerResendHandler } from "./handlers/resend.js";
import { registerHomeTabHandler } from "./handlers/homeTab.js";
import { registerAssistant } from "./handlers/assistant.js";
import { registerMentionHandler } from "./handlers/mention.js";
import { registerChoiceHandler } from "./handlers/choice.js";
import { registerFollowupHandler } from "./handlers/followup.js";
import { registerChangeActionHandler } from "./handlers/changeAction.js";
import { registerConfigUpdateActionHandler } from "./handlers/configUpdateAction.js";
import { registerChangeThreadActionHandlers } from "./handlers/changeThreadActions.js";
import { registerDmActionHandlers } from "./handlers/dmActions.js";
import { registerMessageChangedHandler } from "./handlers/messageChanged.js";
import { registerAutoRespondHandler } from "./handlers/autoRespond.js";

let app: App | null = null;

export function createSlackApp(): App {
  const config = getConfig();

  app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  // Home tab handler (always enabled for role management)
  registerHomeTabHandler(app);

  // Reaction mode handlers (always enabled)
  registerNewQueryHandler(app);
  registerRetryHandler(app);
  registerResendHandler(app);

  // Clack tool action handlers
  registerChoiceHandler(app);
  registerFollowupHandler(app);
  registerChangeActionHandler(app);
  registerConfigUpdateActionHandler(app);
  registerChangeThreadActionHandlers(app);

  // DM reaction handlers (always enabled — DM delivery is a per-user preference)
  registerDmActionHandlers(app);

  // Always register all handlers — enablement is checked at invocation time
  // so that soft restarts can toggle features without reconnecting the socket.
  registerAssistant(app);
  registerMentionHandler(app);
  registerMessageChangedHandler(app);
  registerAutoRespondHandler(app);

  return app;
}

export async function startSlackApp(): Promise<void> {
  if (!app) {
    throw new Error("Slack app not created. Call createSlackApp() first.");
  }

  await app.start();
  logger.info("Slack app is running!");
}

export async function stopSlackApp(): Promise<void> {
  if (app) {
    await app.stop();
    logger.debug("Slack app stopped");
  }
}

/**
 * Get the Slack app client for sending messages
 */
export function getSlackClient(): App["client"] | null {
  return app?.client ?? null;
}
