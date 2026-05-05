import type { App } from "@slack/bolt";

/**
 * Process-wide cache for the bot's Slack identity. The token never changes during a
 * process's lifetime, so a single `auth.test` per process is enough.
 */

interface BotIdentity {
  botUserId: string;
  botId: string | undefined;
}

let cached: BotIdentity | undefined;

export async function getBotIdentity(client: App["client"]): Promise<BotIdentity> {
  if (cached) return cached;
  const result = await client.auth.test();
  cached = {
    botUserId: result.user_id ?? "",
    botId: typeof result.bot_id === "string" ? result.bot_id : undefined,
  };
  return cached;
}

export async function getBotUserId(client: App["client"]): Promise<string> {
  return (await getBotIdentity(client)).botUserId;
}

/** Test-only: clear the cache. */
export function _resetForTesting(): void {
  cached = undefined;
}
