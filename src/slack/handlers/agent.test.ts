import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { registerAgent, type AgentDeps } from "./agent.js";

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
