import { vi } from "vitest";
import { WebClient } from "@slack/web-api";

/**
 * The canonical Slack client fake: a real `WebClient` with every namespace and method deeply
 * mocked by vitest. Nothing here describes Slack's API — the shape IS `WebClient`, so it tracks
 * @slack/web-api automatically and a misspelled namespace or method is a compile error.
 *
 * A test programs the calls its claim depends on and ignores the rest:
 *
 *     const client = createSlackClientMock();
 *     client.conversations.info.mockResolvedValue({ ok: true, channel: { name: "general" } });
 *     ...
 *     expect(client.chat.postMessage).toHaveBeenCalledWith({ channel: "C1", text: "hi" });
 *
 * Arguments and return values are checked against the real method signature, so a fixture can
 * never drift from the API it stands in for.
 *
 * Unprogrammed methods resolve to `undefined`. The defaults below cover only the calls whose
 * result production code dereferences, so a test never has to program a call it isn't asserting.
 */
export function createSlackClientMock() {
  const client = vi.mockObject(new WebClient());

  client.auth.test.mockResolvedValue({ ok: true, user_id: "U_BOT", bot_id: "B_BOT" });
  client.chat.postMessage.mockResolvedValue({ ok: true, ts: "1111.2222", channel: "C_TEST" });
  client.chat.postEphemeral.mockResolvedValue({ ok: true });
  client.chat.update.mockResolvedValue({ ok: true, ts: "1111.2222", channel: "C_TEST" });
  client.chat.getPermalink.mockResolvedValue({ ok: true, permalink: "https://slack.test/p1" });
  client.conversations.info.mockResolvedValue({ ok: true, channel: { id: "C_TEST" } });
  client.conversations.open.mockResolvedValue({ ok: true, channel: { id: "D_TEST" } });
  client.conversations.replies.mockResolvedValue({ ok: true, messages: [] });
  client.conversations.history.mockResolvedValue({ ok: true, messages: [] });
  client.conversations.list.mockResolvedValue({ ok: true, channels: [] });
  client.users.info.mockResolvedValue({ ok: true, user: { id: "U_TEST", name: "tester" } });
  client.users.list.mockResolvedValue({ ok: true, members: [] });

  return client;
}

/** The deeply-mocked client type, for fixtures that pass one around. */
export type MockSlackClient = ReturnType<typeof createSlackClientMock>;
