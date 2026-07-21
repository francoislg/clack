import type { App } from "@slack/bolt";
import { logger } from "../../logger.js";
import { t } from "../../i18n/t.js";
import { handleClassicDmEvent, defaultClassicDmDeps, type DmTurnHooks } from "./classicDm.js";

/**
 * DM handler for `dmType: "agent"` — the Agent messaging experience (`agent_view`, Bolt 5).
 *
 * Under agent_view Slack delivers user turns as plain `message.im` events (with `thread_ts`
 * optional) and signals DM-open via `app_home_opened` (tab `"messages"`) instead of
 * `assistant_thread_started`. There is no Bolt `Assistant` middleware here — its
 * `isAssistantMessage` gate drops `thread_ts`-less agent messages.
 *
 * User turns share classicDm's message normalization + routing, and supply per-turn hooks that
 * drive the side-panel status + thread title via the retained `assistant.threads.*` API
 * (`assistant:write`). The thread root is `thread_ts || message ts` — confirmed live to be
 * accepted by `setStatus`/`setTitle` even on a turn-1 DM that carries no `thread_ts`. There is
 * no greeting (agent_view fires `app_home_opened` on every tab visit) and no channel-context
 * tracking (agent_view surfaces no `assistant_thread_context_changed`).
 */
export interface AgentDeps {
  handleDmMessageEvent: (event: unknown, client: App["client"]) => Promise<void>;
}

/**
 * Best-effort side-panel affordances for an agent DM turn: a "thinking" status while every turn
 * runs, cleared when it settles. The thread title is set once — on the opening turn — from Claude's
 * `thread_title` label when present, else the truncated opening message, so it names the
 * conversation rather than churning to the latest reply. Each call is wrapped: a Slack API failure
 * is logged and swallowed so the answer is never affected. Fired only after classicDm's filters
 * pass (real user DM, has content, not a stop).
 */
export const agentTurnHooks: DmTurnHooks = {
  onTurnStart: async ({ client, channel, threadRoot }) => {
    try {
      await client.assistant.threads.setStatus({
        channel_id: channel,
        thread_ts: threadRoot,
        status: t("assistant.thinking_status"),
      });
    } catch (err) {
      logger.debug(`Agent setStatus failed: ${err}`);
    }
  },
  onTurnEnd: async ({ client, channel, threadRoot, messageText, isThreadStart, threadTitle }) => {
    try {
      await client.assistant.threads.setStatus({
        channel_id: channel,
        thread_ts: threadRoot,
        status: "",
      });
    } catch (err) {
      logger.debug(`Agent status clear failed: ${err}`);
    }
    if (!isThreadStart) return;
    try {
      const fallback = messageText.length > 50 ? messageText.substring(0, 49) + "…" : messageText;
      await client.assistant.threads.setTitle({
        channel_id: channel,
        thread_ts: threadRoot,
        title: threadTitle ?? fallback,
      });
    } catch (err) {
      logger.debug(`Agent setTitle failed: ${err}`);
    }
  },
};

export const defaultAgentDeps: AgentDeps = {
  handleDmMessageEvent: (event, client) =>
    handleClassicDmEvent(event, client, defaultClassicDmDeps, agentTurnHooks),
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
