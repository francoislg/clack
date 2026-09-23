import { describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CollectedTurn } from "./resultOutcome.js";
import { completeText, type OneShotQuery } from "./utilities.js";

vi.mock("./resultOutcome.js", () => ({ collectTurn: vi.fn() }));

import { collectTurn } from "./resultOutcome.js";

async function* noMessages(): AsyncGenerator<SDKMessage> {}

describe("completeText", () => {
  it("runs one tool-less turn and returns the collected outcome", async () => {
    const messages = noMessages();
    const query = vi.fn<OneShotQuery>().mockReturnValue(messages);
    const collected: CollectedTurn = { ok: true, text: "done" };
    vi.mocked(collectTurn).mockResolvedValue(collected);

    const turn = await completeText({ prompt: "p", model: "haiku", systemPrompt: "s" }, query);

    expect(query).toHaveBeenCalledWith({
      prompt: "p",
      options: expect.objectContaining({
        model: "haiku",
        systemPrompt: "s",
        tools: [],
        maxTurns: 1,
      }),
    });
    expect(collectTurn).toHaveBeenCalledWith(messages);
    expect(turn).toBe(collected);
  });

  it("omits systemPrompt when none is given", async () => {
    const query = vi.fn<OneShotQuery>().mockReturnValue(noMessages());
    vi.mocked(collectTurn).mockResolvedValue({ ok: true, text: "" });

    await completeText({ prompt: "p", model: "haiku" }, query);

    expect(query.mock.calls[0]?.[0].options).not.toHaveProperty("systemPrompt");
  });
});
