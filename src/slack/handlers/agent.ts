import type { App } from "@slack/bolt";
import { logger } from "../../logger.js";
import { handleClassicDmEvent, defaultClassicDmDeps } from "./classicDm.js";

/**
 * DM handler for `dmType: "agent"` — the Agent messaging experience (`agent_view`, Bolt 5).
 *
 * Under agent_view Slack delivers user turns as plain `message.im` events (with `thread_ts`
 * optional) and signals DM-open via `app_home_opened` (tab `"messages"`) instead of
 * `assistant_thread_started`. There is no Bolt `Assistant` middleware here — its
 * `isAssistantMessage` gate drops `thread_ts`-less agent messages.
 *
 * User turns share classicDm's message normalization + routing verbatim (identical filtering
 * and the same `processMessage` entry, `thread_ts` optional), so the answer path is proven.
 * Greeting / suggested-prompts / live status via the retained `assistant.threads.*` API are a
 * follow-up increment (their agent_view payload shape needs live confirmation).
 */
export interface AgentDeps {
  handleDmMessageEvent: (event: unknown, client: App["client"]) => Promise<void>;
}

export const defaultAgentDeps: AgentDeps = {
  handleDmMessageEvent: (event, client) =>
    handleClassicDmEvent(event, client, defaultClassicDmDeps),
};

export function registerAgent(app: App, deps: AgentDeps = defaultAgentDeps): void {
  app.event("message", async ({ event, client }) => {
    await deps.handleDmMessageEvent(event, client);
  });

  app.event("app_home_opened", async ({ event }) => {
    if (event.tab !== "messages") return;
    logger.debug(`Agent DM opened (app_home_opened, tab=messages) in ${event.channel}`);
  });

  logger.debug("Registered agent DM handler");
}
