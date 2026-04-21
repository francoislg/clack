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
import { registerStopReactionHandler } from "./handlers/stopReaction.js";

export interface AppDeps {
  App: new (config: ConstructorParameters<typeof App>[0]) => App;
  getConfig: typeof getConfig;
  logger: typeof logger;
  registerNewQueryHandler: typeof registerNewQueryHandler;
  registerRetryHandler: typeof registerRetryHandler;
  registerResendHandler: typeof registerResendHandler;
  registerHomeTabHandler: typeof registerHomeTabHandler;
  registerAssistant: typeof registerAssistant;
  registerMentionHandler: typeof registerMentionHandler;
  registerChoiceHandler: typeof registerChoiceHandler;
  registerFollowupHandler: typeof registerFollowupHandler;
  registerChangeActionHandler: typeof registerChangeActionHandler;
  registerConfigUpdateActionHandler: typeof registerConfigUpdateActionHandler;
  registerChangeThreadActionHandlers: typeof registerChangeThreadActionHandlers;
  registerDmActionHandlers: typeof registerDmActionHandlers;
  registerMessageChangedHandler: typeof registerMessageChangedHandler;
  registerAutoRespondHandler: typeof registerAutoRespondHandler;
  registerStopReactionHandler: typeof registerStopReactionHandler;
}

export const defaultAppDeps: AppDeps = {
  App,
  getConfig,
  logger,
  registerNewQueryHandler,
  registerRetryHandler,
  registerResendHandler,
  registerHomeTabHandler,
  registerAssistant,
  registerMentionHandler,
  registerChoiceHandler,
  registerFollowupHandler,
  registerChangeActionHandler,
  registerConfigUpdateActionHandler,
  registerChangeThreadActionHandlers,
  registerDmActionHandlers,
  registerMessageChangedHandler,
  registerAutoRespondHandler,
  registerStopReactionHandler,
};

let app: App | null = null;

export function createSlackApp(deps: AppDeps = defaultAppDeps): App {
  const config = deps.getConfig();

  app = new deps.App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  // Home tab handler (always enabled for role management)
  deps.registerHomeTabHandler(app);

  // Reaction mode handlers (always enabled)
  deps.registerNewQueryHandler(app);
  deps.registerStopReactionHandler(app);
  deps.registerRetryHandler(app);
  deps.registerResendHandler(app);

  // Clack tool action handlers
  deps.registerChoiceHandler(app);
  deps.registerFollowupHandler(app);
  deps.registerChangeActionHandler(app);
  deps.registerConfigUpdateActionHandler(app);
  deps.registerChangeThreadActionHandlers(app);

  // DM reaction handlers (always enabled — DM delivery is a per-user preference)
  deps.registerDmActionHandlers(app);

  // Always register all handlers — enablement is checked at invocation time
  // so that soft restarts can toggle features without reconnecting the socket.
  deps.registerAssistant(app);
  deps.registerMentionHandler(app);
  deps.registerMessageChangedHandler(app);
  deps.registerAutoRespondHandler(app);

  return app;
}

export async function startSlackApp(deps: AppDeps = defaultAppDeps): Promise<void> {
  if (!app) {
    throw new Error("Slack app not created. Call createSlackApp() first.");
  }

  await app.start();
  deps.logger.info("Slack app is running!");
}

export async function stopSlackApp(deps: AppDeps = defaultAppDeps): Promise<void> {
  if (app) {
    await app.stop();
    deps.logger.debug("Slack app stopped");
  }
}

/**
 * Get the Slack app client for sending messages
 */
export function getSlackClient(): App["client"] | null {
  return app?.client ?? null;
}
