import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { runChannelContinuationPreAnalysis, type PreAnalysisDeps } from "./preAnalysis.js";
import type { EphemeralAttentionLevel } from "../ephemeralRules.js";
import type { SDKMessage, SDKResultSuccess, SDKResultError } from "@anthropic-ai/claude-agent-sdk";
import type { UUID } from "node:crypto";

const TEST_UUID = "00000000-0000-0000-0000-000000000000" as UUID;
const TEST_SESSION_ID = "test-session";

function resultSuccess(result: string): SDKResultSuccess {
  return {
    type: "result",
    subtype: "success",
    result,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {} as SDKResultSuccess["usage"],
    modelUsage: {},
    permission_denials: [],
    uuid: TEST_UUID,
    session_id: TEST_SESSION_ID,
  };
}

function resultError(): SDKResultError {
  return {
    type: "result",
    subtype: "error_during_execution",
    errors: ["boom"],
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {} as SDKResultError["usage"],
    modelUsage: {},
    permission_denials: [],
    uuid: TEST_UUID,
    session_id: TEST_SESSION_ID,
  };
}

interface RecordedCall {
  prompt: string;
  systemPrompt: string;
}

let queuedMessages: SDKMessage[];
let shouldThrow: boolean;
let calls: RecordedCall[];

async function* yieldMessages(messages: SDKMessage[]): AsyncGenerator<SDKMessage> {
  for (const message of messages) {
    yield message;
  }
}

function makeDeps(): PreAnalysisDeps {
  return {
    clackQuery: (params) => {
      const systemPrompt = params.options?.systemPrompt;
      calls.push({
        prompt: params.prompt,
        systemPrompt: typeof systemPrompt === "string" ? systemPrompt : "",
      });
      if (shouldThrow) throw new Error("api down");
      return yieldMessages(queuedMessages);
    },
  };
}

function run(
  level: EphemeralAttentionLevel = "medium",
  secondsSinceLastBotMessage?: number,
): Promise<"respond" | "skip" | "stop" | null> {
  return runChannelContinuationPreAnalysis(
    "what about staging?",
    "Alice",
    "Clack",
    "Deploy digest: 3 PRs shipped today",
    level,
    undefined,
    undefined,
    "general",
    undefined,
    secondsSinceLastBotMessage,
    undefined,
    makeDeps(),
  );
}

describe("runChannelContinuationPreAnalysis", () => {
  beforeEach(() => {
    queuedMessages = [];
    shouldThrow = false;
    calls = [];
    vi.restoreAllMocks();
  });

  it("parses each verdict", async () => {
    for (const verdict of ["respond", "skip", "stop"] as const) {
      queuedMessages = [resultSuccess(verdict)];
      assert.equal(await run(), verdict);
    }
  });

  it("returns null (not a verdict) when the classifier call throws", async () => {
    shouldThrow = true;
    assert.equal(await run(), null);
  });

  it("returns null on a non-success result", async () => {
    queuedMessages = [resultError()];
    assert.equal(await run(), null);
  });

  it("returns null when no result message arrives", async () => {
    queuedMessages = [];
    assert.equal(await run(), null);
  });

  it("defaults ambiguous output to skip", async () => {
    queuedMessages = [resultSuccess("maybe?")];
    assert.equal(await run(), "skip");
  });

  it("embeds the anchor post verbatim in the system prompt", async () => {
    queuedMessages = [resultSuccess("skip")];
    await run();
    assert.ok(calls[0].systemPrompt.includes("Deploy digest: 3 PRs shipped today"));
    assert.ok(calls[0].systemPrompt.includes("unrelatedness is the default assumption"));
  });

  it("keys the policy lean on the rule's level", async () => {
    for (const [level, marker] of [
      ["high", "HIGH attention"],
      ["medium", "MEDIUM attention"],
      ["low", "LOW attention"],
    ] as const) {
      calls = [];
      queuedMessages = [resultSuccess("skip")];
      await run(level);
      assert.ok(calls[0].systemPrompt.includes(marker), `missing ${marker}`);
    }
  });

  it("includes the elapsed-time signal in the classification prompt", async () => {
    queuedMessages = [resultSuccess("skip")];
    await run("medium", 15 * 60 * 60);
    assert.ok(calls[0].prompt.includes("TIMING: this message arrived 15h after"));
  });

  it("surfaces the seed's creationContext to the judge when present", async () => {
    queuedMessages = [resultSuccess("respond")];
    await runChannelContinuationPreAnalysis(
      "what about staging?",
      "Alice",
      "Clack",
      "Deploy digest: 3 PRs shipped today",
      "medium",
      undefined,
      undefined,
      "general",
      undefined,
      undefined,
      "You posted a riddle; nudge, never reveal the answer.",
      makeDeps(),
    );
    assert.ok(calls[0].systemPrompt.includes("WHY THE BOT POSTED"));
    assert.ok(calls[0].systemPrompt.includes("nudge, never reveal the answer"));
  });

  it("omits the creationContext section when none is seeded", async () => {
    queuedMessages = [resultSuccess("skip")];
    await run();
    assert.ok(!calls[0].systemPrompt.includes("WHY THE BOT POSTED"));
  });
});
