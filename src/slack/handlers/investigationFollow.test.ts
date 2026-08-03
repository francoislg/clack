import { describe, it, vi, beforeEach, expect } from "vitest";
import type { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";

vi.mock("../../config.js", () => ({
  getConfig: vi.fn(() => ({ investigations: { enabled: true } })),
}));
vi.mock("../../investigations/engine.js", () => ({
  handleFollowedThreadEvent: vi.fn(() => Promise.resolve()),
}));

import { registerInvestigationFollowHandler } from "./investigationFollow.js";
import { handleFollowedThreadEvent } from "../../investigations/engine.js";
import { getConfig } from "../../config.js";

type MessageHandler = (args: { event: unknown; client: unknown }) => Promise<void>;

/** Fake Bolt app that captures every `message` listener — proves registration is additive. */
function makeApp(captured: MessageHandler[]): App {
  return {
    event: (type: string, handler: MessageHandler) => {
      if (type === "message") captured.push(handler);
    },
  } as App;
}

const client = new WebClient();

function registerAndCapture(): MessageHandler {
  const captured: MessageHandler[] = [];
  registerInvestigationFollowHandler(makeApp(captured));
  return captured[0];
}

function setEnabled(enabled: boolean): void {
  vi.mocked(getConfig).mockReturnValue({ investigations: { enabled } } as ReturnType<
    typeof getConfig
  >);
}

describe("investigation follow tee", () => {
  beforeEach(() => {
    vi.mocked(handleFollowedThreadEvent).mockClear();
    setEnabled(true);
  });

  it("coexists non-destructively: a pre-existing message listener still fires alongside the tee", async () => {
    const captured: MessageHandler[] = [];
    const autoRespondSpy = vi.fn(() => Promise.resolve());
    const app = makeApp(captured);
    // Simulate an existing consumer (auto-respond) registering first.
    app.event("message", autoRespondSpy);
    registerInvestigationFollowHandler(app);

    expect(captured).toHaveLength(2);

    const event = { channel: "CSIDE", thread_ts: "1.1", user: "U2", text: "hi" };
    for (const handler of captured) await handler({ event, client });

    expect(autoRespondSpy).toHaveBeenCalledTimes(1);
    expect(handleFollowedThreadEvent).toHaveBeenCalledTimes(1);
  });

  it("forwards a threaded event to the follow pipeline with mapped fields", async () => {
    const handler = registerAndCapture();
    await handler({
      event: { channel: "CSIDE", thread_ts: "1.1", user: "U2", text: "hi" },
      client,
    });
    expect(handleFollowedThreadEvent).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ channel: "CSIDE", threadTs: "1.1", userId: "U2", text: "hi" }),
    );
  });

  it("ignores non-threaded messages", async () => {
    const handler = registerAndCapture();
    await handler({ event: { channel: "CSIDE", ts: "1.1", user: "U2" }, client });
    expect(handleFollowedThreadEvent).not.toHaveBeenCalled();
  });

  it("is inert when the feature is disabled", async () => {
    setEnabled(false);
    const handler = registerAndCapture();
    await handler({
      event: { channel: "CSIDE", thread_ts: "1.1", user: "U2", text: "hi" },
      client,
    });
    expect(handleFollowedThreadEvent).not.toHaveBeenCalled();
  });
});
