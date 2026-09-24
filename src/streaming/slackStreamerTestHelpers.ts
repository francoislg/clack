import { vi } from "vitest";
import { WebClient } from "@slack/web-api";
import { createSlackClientMock, type MockSlackClient } from "../slack/testSlackClient.js";

/** A real `ChatStreamer` (via `WebClient.chatStream`) with every method a vitest mock. */
export function makeMockChatStreamer() {
  const streamer = vi.mockObject(
    new WebClient().chatStream({ channel: "C_CHAN", thread_ts: "1234.5678" }),
  );
  streamer.append.mockResolvedValue(null);
  streamer.stop.mockResolvedValue({ ok: true });
  return streamer;
}

export type MockChatStreamer = ReturnType<typeof makeMockChatStreamer>;

export function makeClient(opts?: {
  chatStreamer?: MockChatStreamer;
  teamId?: string;
  throwOnChatStream?: boolean;
}): MockSlackClient {
  const streamer = opts?.chatStreamer ?? makeMockChatStreamer();
  const client = createSlackClientMock();

  if (opts?.throwOnChatStream) {
    client.chatStream.mockImplementation(() => {
      throw new Error("chatStream failed");
    });
  } else {
    client.chatStream.mockReturnValue(streamer);
  }
  client.auth.test.mockResolvedValue({ ok: true, team_id: opts?.teamId ?? "T_TEAM" });
  client.chat.postMessage.mockResolvedValue({ ok: true });
  client.chat.update.mockResolvedValue({ ok: true });

  return client;
}

/** Slack-shaped error: `getSlackErrorCode` reads `error.data.error`. */
export function makeSlackError(code: string): Error & { data: { error: string } } {
  return Object.assign(new Error(code), { data: { error: code } });
}
