import type { App } from "@slack/bolt";

export async function fetchThreadContext(
  client: App["client"],
  channelId: string,
  threadTs: string
): Promise<string[]> {
  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 20,
    });

    if (!result.messages) {
      return [];
    }

    return result.messages
      .filter((msg) => msg.text)
      .map((msg) => msg.text as string);
  } catch (error) {
    console.error("Failed to fetch thread context:", error);
    return [];
  }
}

export async function fetchMessage(
  client: App["client"],
  channelId: string,
  messageTs: string
): Promise<string> {
  try {
    const result = await client.conversations.history({
      channel: channelId,
      latest: messageTs,
      inclusive: true,
      limit: 1,
    });

    if (result.messages && result.messages.length > 0) {
      return result.messages[0].text || "";
    }
    return "";
  } catch (error) {
    console.error("Failed to fetch message:", error);
    return "";
  }
}
