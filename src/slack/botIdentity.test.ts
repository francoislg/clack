import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTesting, getBotIdentity, getBotUserId } from "./botIdentity.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";

describe("getBotIdentity", () => {
  let client: MockSlackClient;

  beforeEach(() => {
    _resetForTesting();
    client = createSlackClientMock();
  });

  it("reports the bot's user id, bot id and team id from auth.test", async () => {
    client.auth.test.mockResolvedValue({
      ok: true,
      user_id: "U_BOT",
      bot_id: "B_BOT",
      team_id: "T_HOME",
    });

    expect(await getBotIdentity(client)).toEqual({
      botUserId: "U_BOT",
      botId: "B_BOT",
      teamId: "T_HOME",
    });
  });

  it("reports an undefined team id when auth.test returns none", async () => {
    client.auth.test.mockResolvedValue({ ok: true, user_id: "U_BOT", bot_id: "B_BOT" });

    expect((await getBotIdentity(client)).teamId).toBeUndefined();
  });

  it("reports an undefined team id when auth.test returns an empty one", async () => {
    client.auth.test.mockResolvedValue({ ok: true, user_id: "U_BOT", team_id: "" });

    expect((await getBotIdentity(client)).teamId).toBeUndefined();
  });

  it("serves the team id from the same cached auth.test call", async () => {
    client.auth.test.mockResolvedValue({ ok: true, user_id: "U_BOT", team_id: "T_HOME" });

    const first = await getBotIdentity(client);
    const second = await getBotIdentity(client);
    const userId = await getBotUserId(client);

    expect(second).toBe(first);
    expect(userId).toBe("U_BOT");
    expect(client.auth.test).toHaveBeenCalledTimes(1);
  });
});
