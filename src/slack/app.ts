import { App } from "@slack/bolt";
import { getConfig } from "../config.js";
import { registerNewQueryHandler } from "./handlers/newQuery.js";
import { registerAcceptHandler } from "./handlers/accept.js";
import { registerRejectHandler } from "./handlers/reject.js";
import { registerRefineHandler } from "./handlers/refine.js";
import { registerUpdateHandler } from "./handlers/update.js";
import { registerEditHandler } from "./handlers/edit.js";

let app: App | null = null;

export function createSlackApp(): App {
  const config = getConfig();

  app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  registerNewQueryHandler(app);
  registerAcceptHandler(app);
  registerRejectHandler(app);
  registerRefineHandler(app);
  registerUpdateHandler(app);
  registerEditHandler(app);

  return app;
}

export async function startSlackApp(): Promise<void> {
  if (!app) {
    throw new Error("Slack app not created. Call createSlackApp() first.");
  }

  await app.start();
  console.log("Slack app is running!");
}

export async function stopSlackApp(): Promise<void> {
  if (app) {
    await app.stop();
    console.log("Slack app stopped");
  }
}
