import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { registerAgent, agentTurnHooks, type AgentDeps } from "./agent.js";

// Minimal Bolt app stub that captures the event handlers registered by registerAgent, so the
// test can drive them directly without a live Socket-Mode connection.
type EventHandler = (args: { event: unknown; client: App["client"] }) => Promise<void> | void;

function makeApp(): { app: App; handlers: Map<string, EventHandler> } {
  const handlers = new Map<string, EventHandler>();
  const app = {
    event: (name: string, handler: EventHandler) => {
      handlers.set(name, handler);
    },
  } as App;
  return { app, handlers };
}

const fakeClient = {} as App["client"];

describe("registerAgent", () => {
  let deps: AgentDeps;
  let handleDmMessageEvent: ReturnType<typeof vi.fn<AgentDeps["handleDmMessageEvent"]>>;

  beforeEach(() => {
    handleDmMessageEvent = vi.fn<AgentDeps["handleDmMessageEvent"]>(async () => {});
    deps = { handleDmMessageEvent };
  });

  it("routes message events through the shared DM message handler", async () => {
    const { app, handlers } = makeApp();
    registerAgent(app, deps);

    const messageHandler = handlers.get("message");
    assert.ok(messageHandler, "expected a message listener");

    const event = { channel_type: "im", channel: "D1", user: "U1", ts: "1.0", text: "hi" };
    await messageHandler({ event, client: fakeClient });

    expect(handleDmMessageEvent).toHaveBeenCalledTimes(1);
    expect(handleDmMessageEvent).toHaveBeenCalledWith(event, fakeClient);
  });

  it("registers an app_home_opened listener that only acts on the messages tab", async () => {
    const { app, handlers } = makeApp();
    registerAgent(app, deps);

    const homeHandler = handlers.get("app_home_opened");
    assert.ok(homeHandler, "expected an app_home_opened listener");

    // The messages-tab branch must not throw; the non-messages branch must be a clean no-op.
    // (Greeting/prompts are a follow-up, so neither branch touches the DM message handler.)
    await homeHandler({ event: { tab: "messages", channel: "D1" }, client: fakeClient });
    await homeHandler({ event: { tab: "home", channel: "D1" }, client: fakeClient });

    expect(handleDmMessageEvent).not.toHaveBeenCalled();
  });
});

describe("agentTurnHooks", () => {
  // `Object.create(null)` is typed `any` in lib.d.ts, so the assembled fake is assignable to
  // App["client"] without a cast; the hooks only reach `client.assistant.threads.*`.
  function makeThreadsClient(impl?: () => Promise<object>): {
    client: App["client"];
    setStatus: ReturnType<typeof vi.fn>;
    setTitle: ReturnType<typeof vi.fn>;
  } {
    const setStatus = vi.fn(impl ?? (async () => ({})));
    const setTitle = vi.fn(impl ?? (async () => ({})));
    const client = Object.create(null);
    client.assistant = { threads: { setStatus, setTitle } };
    return { client, setStatus, setTitle };
  }

  it("sets the thinking status on turn start", async () => {
    const { client, setStatus } = makeThreadsClient();
    await agentTurnHooks.onTurnStart!({ client, channel: "D1", threadRoot: "1.0" });

    expect(setStatus).toHaveBeenCalledTimes(1);
    const arg = setStatus.mock.calls[0][0];
    assert.equal(arg.channel_id, "D1");
    assert.equal(arg.thread_ts, "1.0");
    assert.ok(typeof arg.status === "string" && arg.status.length > 0);
  });

  it("on thread start, clears status and falls back to the truncated message text", async () => {
    const { client, setStatus, setTitle } = makeThreadsClient();
    const longText = "x".repeat(80);
    await agentTurnHooks.onTurnEnd!({
      client,
      channel: "D1",
      threadRoot: "1.0",
      messageText: longText,
      isThreadStart: true,
    });

    expect(setStatus).toHaveBeenCalledWith({ channel_id: "D1", thread_ts: "1.0", status: "" });
    const titleArg = setTitle.mock.calls[0][0];
    assert.equal(titleArg.channel_id, "D1");
    assert.equal(titleArg.thread_ts, "1.0");
    assert.ok(titleArg.title.length <= 50);
    assert.ok(titleArg.title.endsWith("…"));
  });

  it("prefers Claude's thread_title over the message text on thread start", async () => {
    const { client, setTitle } = makeThreadsClient();
    await agentTurnHooks.onTurnEnd!({
      client,
      channel: "D1",
      threadRoot: "1.0",
      messageText: "hey can you help me figure out the thing",
      isThreadStart: true,
      threadTitle: "Bolt 5 upgrade questions",
    });
    assert.equal(setTitle.mock.calls[0][0].title, "Bolt 5 upgrade questions");
  });

  it("does not set a title on follow-up turns (still clears status)", async () => {
    const { client, setStatus, setTitle } = makeThreadsClient();
    await agentTurnHooks.onTurnEnd!({
      client,
      channel: "D1",
      threadRoot: "1.0",
      messageText: "follow-up",
      isThreadStart: false,
      threadTitle: "Some Label",
    });
    expect(setStatus).toHaveBeenCalledWith({ channel_id: "D1", thread_ts: "1.0", status: "" });
    expect(setTitle).not.toHaveBeenCalled();
  });

  it("swallows Slack API failures so the turn is never affected", async () => {
    const { client } = makeThreadsClient(async () => {
      throw new Error("slack down");
    });
    await agentTurnHooks.onTurnStart!({ client, channel: "D1", threadRoot: "1.0" });
    await agentTurnHooks.onTurnEnd!({
      client,
      channel: "D1",
      threadRoot: "1.0",
      messageText: "hi",
      isThreadStart: true,
    });
    // No throw = pass.
  });
});
