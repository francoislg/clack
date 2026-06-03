import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  runBaselineSmoke,
  defaultBaselineSmokeDeps,
  type BaselineSmokeDeps,
} from "./startupBaselineSmoke.js";
import type { clackQuery } from "./claude/query.js";
import type { Config } from "./config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockClackQuery = ReturnType<typeof vi.fn<typeof clackQuery>>;

/** Build an async iterable from an array of fake SDK messages. Matches the pattern
 *  used in src/claude/testMcp.test.ts. */
function asyncIterableOf(items: object[]): AsyncIterable<SDKMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item as SDKMessage;
      }
    },
  };
}

interface LogCall {
  level: "info" | "warn";
  message: string;
}

function makeLogger(calls: LogCall[]): BaselineSmokeDeps["logger"] {
  return {
    info: (message: string) => {
      calls.push({ level: "info", message });
    },
    warn: (message: string) => {
      calls.push({ level: "warn", message });
    },
  };
}

const stubBuildQueryContext: BaselineSmokeDeps["buildQueryContext"] = (params) => ({
  mode: "query",
  ...params,
  cronUserSchedules: params.cronUserSchedules ?? false,
});

const stubBuildClackTools: BaselineSmokeDeps["buildClackTools"] = () => ({
  mcpServers: {},
  toolNames: [],
  getResult: () => null,
  getRenderedBlocks: () => null,
  getStagedIntents: () => new Map(),
  getToolCallHistory: () => [],
  isSkipped: () => false,
  getAttentionLevel: () => null,
  isPostedTopLevel: () => false,
});

function makeDeps(
  mockQuery: MockClackQuery,
  calls: LogCall[],
  loadMcp?: BaselineSmokeDeps["loadAlwaysOnMcpServers"],
): BaselineSmokeDeps {
  return {
    ...defaultBaselineSmokeDeps,
    clackQuery: mockQuery,
    getConfiguredMcpServerNames: () => [],
    loadAlwaysOnMcpServers: loadMcp ?? (() => Promise.resolve(undefined)),
    // Stub so tests don't need the global getConfig() state or the disk cascade.
    buildSystemPrompt: (options) => `SYSTEM_PROMPT_FOR_${options?.role ?? "unknown"}`,
    // Stubs so tests don't hit the real tool registry / plugin loader.
    buildPrompt: () => "USER_PROMPT",
    buildQueryContext: stubBuildQueryContext,
    buildClackTools: stubBuildClackTools,
    discoverEagerSkillPlugins: () => [],
    discoverSkillPluginInfo: () => [],
    prepareSkillsSession: defaultBaselineSmokeDeps.prepareSkillsSession,
    logger: makeLogger(calls),
  };
}

function makeConfig(): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "s",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false, dmType: "assistant" },
    mentions: { enabled: false },
    repositories: [
      { name: "repo", url: "https://github.com/x/y.git", description: "x", branch: "main" },
    ],
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "sonnet" },
  };
}

/** Build a fake assistant-message-shaped plain object. The production extractor sums
 *  `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` from
 *  `message.message.usage`; we split the requested total across the three fields so
 *  the test exercises the sum path rather than any single field. */
function fakeAssistantMessage(tokens: number | undefined): object {
  return {
    type: "assistant",
    message:
      tokens !== undefined
        ? {
            usage: {
              input_tokens: Math.floor(tokens / 3),
              cache_creation_input_tokens: Math.floor(tokens / 3),
              cache_read_input_tokens: tokens - 2 * Math.floor(tokens / 3),
            },
          }
        : {},
    parent_tool_use_id: null,
    uuid: "u",
    session_id: "s",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runBaselineSmoke", () => {
  let mockQuery: MockClackQuery;

  beforeEach(() => {
    mockQuery = vi.fn<typeof clackQuery>();
  });

  it("logs a single summary line with all roles when queries succeed", async () => {
    const tokensPerCall = [12000, 24000, 36000];
    let callIdx = 0;
    mockQuery.mockImplementation(() => {
      const t = tokensPerCall[callIdx++];
      return asyncIterableOf([fakeAssistantMessage(t)]);
    });

    const calls: LogCall[] = [];
    await runBaselineSmoke(makeConfig(), { timeoutMs: 5000 }, makeDeps(mockQuery, calls));

    assert.equal(mockQuery.mock.calls.length, 3);
    const infos = calls.filter((c) => c.level === "info");
    assert.equal(infos.length, 1);
    assert.match(
      infos[0].message,
      /Current tokens usage per role: user: 12000, dev: 24000, admin: 36000/,
    );
    assert.equal(calls.filter((c) => c.level === "warn").length, 0);
  });

  it("marks a role as error in the summary and warns when its stream yields nothing", async () => {
    let callIdx = 0;
    mockQuery.mockImplementation(() => {
      callIdx++;
      if (callIdx === 2) {
        return asyncIterableOf([]);
      }
      return asyncIterableOf([fakeAssistantMessage(10000 * callIdx)]);
    });

    const calls: LogCall[] = [];
    await runBaselineSmoke(makeConfig(), { timeoutMs: 5000 }, makeDeps(mockQuery, calls));

    assert.equal(mockQuery.mock.calls.length, 3);
    const infos = calls.filter((c) => c.level === "info");
    const warns = calls.filter((c) => c.level === "warn");
    assert.equal(infos.length, 1);
    assert.match(
      infos[0].message,
      /Current tokens usage per role: user: 10000, dev: error, admin: 30000/,
    );
    assert.equal(warns.length, 1);
    assert.match(warns[0].message, /baseline\.tokens\.failed role=dev/);
    assert.match(warns[0].message, /stream ended before any assistant turn/);
  });

  it("does not throw when loadAlwaysOnMcpServers rejects", async () => {
    const calls: LogCall[] = [];
    await assert.doesNotReject(() =>
      runBaselineSmoke(
        makeConfig(),
        {},
        makeDeps(mockQuery, calls, () => Promise.reject(new Error("mcp boom"))),
      ),
    );
    assert.equal(mockQuery.mock.calls.length, 0);
    const warns = calls.filter((c) => c.level === "warn");
    assert.equal(warns.length, 1);
    assert.match(warns[0].message, /baseline\.tokens\.failed stage=load-mcp error=mcp boom/);
  });

  it("passes a different systemPrompt for each role", async () => {
    const prompts: string[] = [];
    mockQuery.mockImplementation((params) => {
      const sp = params.options?.systemPrompt;
      prompts.push(typeof sp === "string" ? sp : "");
      return asyncIterableOf([fakeAssistantMessage(1000)]);
    });

    const calls: LogCall[] = [];
    await runBaselineSmoke(makeConfig(), { timeoutMs: 5000 }, makeDeps(mockQuery, calls));

    assert.equal(prompts.length, 3);
    // Three role chains → three different cascade outputs.
    assert.notEqual(prompts[0], prompts[1]);
    assert.notEqual(prompts[1], prompts[2]);
    assert.notEqual(prompts[0], prompts[2]);
  });

  it("aborts and logs when a role's stream hangs past the timeout", async () => {
    mockQuery.mockImplementation((params) => {
      const hanging: AsyncIterable<SDKMessage> = {
        // Simulates a hung SDK stream: exits only when the abort signal fires,
        // and never yields an assistant turn. Uses a manual iterator instead of
        // a generator to avoid the require-yield lint rule.
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<SDKMessage>> {
              await new Promise<void>((resolve) => {
                params.options?.abortController?.signal.addEventListener("abort", () => resolve());
              });
              return { value: undefined, done: true };
            },
          };
        },
      };
      return hanging;
    });

    const calls: LogCall[] = [];
    await runBaselineSmoke(makeConfig(), { timeoutMs: 30 }, makeDeps(mockQuery, calls));

    assert.equal(mockQuery.mock.calls.length, 3);
    const warns = calls.filter((c) => c.level === "warn");
    assert.equal(warns.length, 3);
    for (const w of warns) {
      assert.match(w.message, /baseline\.tokens\.failed/);
    }
    const infos = calls.filter((c) => c.level === "info");
    assert.equal(infos.length, 1);
    assert.match(
      infos[0].message,
      /Current tokens usage per role: user: error, dev: error, admin: error/,
    );
  });
});
