import { describe, it, expect } from "vitest";
import type { SDKResultSuccess, SDKAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type { UUID } from "node:crypto";
import { addUsage, readResultUsage, ZERO_USAGE } from "./usage.js";

const TEST_UUID = "00000000-0000-0000-0000-000000000000" as UUID;

interface UsageFields {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function resultMsg(opts: { usage?: UsageFields; total_cost_usd?: number } = {}): SDKResultSuccess {
  return {
    type: "result",
    subtype: "success",
    result: "",
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: opts.total_cost_usd ?? 0,
    usage: { ...opts.usage } as SDKResultSuccess["usage"],
    modelUsage: {},
    permission_denials: [],
    uuid: TEST_UUID,
    session_id: "test",
  };
}

function assistantMsg(content: unknown[]): SDKAssistantMessage {
  return {
    type: "assistant",
    message: { content } as SDKAssistantMessage["message"],
    parent_tool_use_id: null,
    uuid: TEST_UUID,
    session_id: "test",
  };
}

describe("readResultUsage", () => {
  it("maps usage + total_cost_usd from a result message", () => {
    const usage = readResultUsage(
      resultMsg({
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 30,
        },
        total_cost_usd: 1.23,
      }),
    );
    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 500,
      cacheCreationTokens: 30,
      costUsd: 1.23,
    });
  });

  it("returns undefined for a non-result message", () => {
    expect(readResultUsage(assistantMsg([]))).toBeUndefined();
  });

  it("returns undefined when the result carries no usage at all", () => {
    expect(readResultUsage(resultMsg())).toBeUndefined();
  });

  it("treats missing usage components as zero", () => {
    const usage = readResultUsage(resultMsg({ usage: { input_tokens: 5 } }));
    expect(usage).toEqual({
      inputTokens: 5,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    });
  });

  it("captures cost even when token counts are absent", () => {
    const usage = readResultUsage(resultMsg({ total_cost_usd: 0.4 }));
    expect(usage?.costUsd).toBe(0.4);
    expect(usage?.inputTokens).toBe(0);
  });
});

describe("addUsage", () => {
  it("sums two usage records component-wise", () => {
    expect(
      addUsage(
        {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheCreationTokens: 4,
          costUsd: 0.5,
        },
        {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 40,
          costUsd: 1.5,
        },
      ),
    ).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheCreationTokens: 44,
      costUsd: 2,
    });
  });

  it("treats an undefined operand as zero (left)", () => {
    expect(addUsage(undefined, { ...ZERO_USAGE, inputTokens: 7 })).toEqual({
      ...ZERO_USAGE,
      inputTokens: 7,
    });
  });

  it("treats an undefined operand as zero (right)", () => {
    expect(addUsage({ ...ZERO_USAGE, outputTokens: 9 }, undefined)).toEqual({
      ...ZERO_USAGE,
      outputTokens: 9,
    });
  });

  it("two undefined operands sum to zero", () => {
    expect(addUsage(undefined, undefined)).toEqual(ZERO_USAGE);
  });
});
