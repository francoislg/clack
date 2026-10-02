import { describe, it, vi, beforeEach, type MockInstance } from "vitest";
import assert from "node:assert/strict";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { stub } from "../testStubs.js";
import { getOwnerUserId, sendOwnerDm, type OwnerNotifierDeps } from "./ownerDm.js";
import { manifestFeatures, requiredBotScopes } from "./requiredScopes.js";
import { checkTokenScopes, findMissingScopes, reportMissingScopes } from "./scopeDriftCheck.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";

vi.mock("./ownerDm.js", () => ({ getOwnerUserId: vi.fn(), sendOwnerDm: vi.fn() }));

let warn: MockInstance<typeof logger.warn>;
let error: MockInstance<typeof logger.error>;

beforeEach(() => {
  warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  error = vi.spyOn(logger, "error").mockImplementation(() => {});
});

describe("findMissingScopes", () => {
  it("returns the required scopes the token lacks, in required order", () => {
    assert.deepEqual(
      findMissingScopes(["chat:write", "channels:join", "im:write"], ["chat:write"]),
      ["channels:join", "im:write"],
    );
  });

  it("ignores scopes the token carries beyond the required set", () => {
    assert.deepEqual(findMissingScopes(["chat:write"], ["chat:write", "links:read"]), []);
  });
});

describe("reportMissingScopes", () => {
  let deps: {
    getOwnerUserId: ReturnType<typeof vi.fn<OwnerNotifierDeps["getOwnerUserId"]>>;
    sendOwnerDm: ReturnType<typeof vi.fn<OwnerNotifierDeps["sendOwnerDm"]>>;
  };

  beforeEach(() => {
    deps = {
      getOwnerUserId: vi.fn<OwnerNotifierDeps["getOwnerUserId"]>(async () => "U_OWNER"),
      sendOwnerDm: vi.fn<OwnerNotifierDeps["sendOwnerDm"]>(async () => true),
    };
  });

  it("does nothing when no scope is missing", async () => {
    await reportMissingScopes([], deps);

    assert.equal(error.mock.calls.length, 0);
    assert.equal(deps.getOwnerUserId.mock.calls.length, 0);
    assert.equal(deps.sendOwnerDm.mock.calls.length, 0);
  });

  it("logs each missing scope and DMs the owner once, naming all of them", async () => {
    await reportMissingScopes(["channels:join", "search:read.public"], deps);

    assert.equal(error.mock.calls.length, 2);
    assert.match(String(error.mock.calls[0][0]), /channels:join/);
    assert.match(String(error.mock.calls[1][0]), /search:read\.public/);
    assert.equal(deps.sendOwnerDm.mock.calls.length, 1);
    const [owner, text, options] = deps.sendOwnerDm.mock.calls[0];
    assert.equal(owner, "U_OWNER");
    assert.match(text, /missing 2 scope\(s\)/);
    assert.match(text, /`channels:join`/);
    assert.match(text, /`search:read\.public`/);
    assert.match(text, /npm run manifest/);
    assert.deepEqual(options, { suppressUnfurls: true });
  });

  it("logs the missing scope and attempts no DM when no owner is configured", async () => {
    deps.getOwnerUserId.mockResolvedValue(null);

    await reportMissingScopes(["channels:join"], deps);

    assert.equal(error.mock.calls.length, 1);
    assert.equal(deps.sendOwnerDm.mock.calls.length, 0);
  });

  it("resolves and warns when the owner DM throws", async () => {
    deps.sendOwnerDm.mockRejectedValue(new Error("channel_not_found"));

    await reportMissingScopes(["channels:join"], deps);

    assert.equal(warn.mock.calls.length, 1);
    assert.match(String(warn.mock.calls[0][0]), /owner DM failed: channel_not_found/);
  });
});

describe("checkTokenScopes", () => {
  let client: MockSlackClient;
  let config: Config;
  let required: string[];

  beforeEach(() => {
    client = createSlackClientMock();
    config = stub<Config>({ investigations: { enabled: true, emoji: "mag" } });
    required = requiredBotScopes(manifestFeatures(config));
    vi.mocked(getOwnerUserId).mockReset().mockResolvedValue("U_OWNER");
    vi.mocked(sendOwnerDm).mockReset().mockResolvedValue(true);
  });

  function grant(scopes: string[]): void {
    client.auth.test.mockResolvedValue({ ok: true, response_metadata: { scopes } });
  }

  it("makes no Slack call without a client", async () => {
    assert.deepEqual(await checkTokenScopes(config, undefined), []);

    assert.equal(vi.mocked(sendOwnerDm).mock.calls.length, 0);
  });

  it("logs nothing and sends no DM when the token carries every required scope", async () => {
    grant(required);

    assert.deepEqual(await checkTokenScopes(config, client), []);

    assert.equal(client.auth.test.mock.calls.length, 1);
    assert.equal(error.mock.calls.length, 0);
    assert.equal(warn.mock.calls.length, 0);
    assert.equal(vi.mocked(sendOwnerDm).mock.calls.length, 0);
  });

  it("reports the scope of a feature enabled without a reinstall", async () => {
    grant(required.filter((scope) => scope !== "channels:join"));

    assert.deepEqual(await checkTokenScopes(config, client), ["channels:join"]);

    assert.equal(error.mock.calls.length, 1);
    assert.equal(vi.mocked(sendOwnerDm).mock.calls.length, 1);
    assert.match(vi.mocked(sendOwnerDm).mock.calls[0][1], /`channels:join`/);
  });

  it("does not report a scope the config does not require", async () => {
    grant([...required, "links:read"]);

    assert.deepEqual(await checkTokenScopes(config, client), []);

    assert.equal(vi.mocked(sendOwnerDm).mock.calls.length, 0);
  });

  it("asks auth.test again on every run", async () => {
    grant(required.filter((scope) => scope !== "channels:join"));
    await checkTokenScopes(config, client);
    grant(required);

    assert.deepEqual(await checkTokenScopes(config, client), []);

    assert.equal(client.auth.test.mock.calls.length, 2);
  });

  it("resolves and warns when auth.test throws", async () => {
    client.auth.test.mockRejectedValue(new Error("invalid_auth"));

    assert.deepEqual(await checkTokenScopes(config, client), []);

    assert.equal(warn.mock.calls.length, 1);
    assert.match(String(warn.mock.calls[0][0]), /invalid_auth/);
    assert.equal(vi.mocked(sendOwnerDm).mock.calls.length, 0);
  });

  it("warns that it was skipped and reports nothing when the response has no scope list", async () => {
    client.auth.test.mockResolvedValue({ ok: true, user_id: "U_BOT" });

    assert.deepEqual(await checkTokenScopes(config, client), []);

    assert.equal(warn.mock.calls.length, 1);
    assert.match(String(warn.mock.calls[0][0]), /skipped/);
    assert.equal(error.mock.calls.length, 0);
    assert.equal(vi.mocked(sendOwnerDm).mock.calls.length, 0);
  });
});
