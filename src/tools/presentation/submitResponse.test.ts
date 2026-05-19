import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import type { StagedIntent, ResponseSnapshot } from "../types.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";
import { createSubmitResponseTool, type SubmitResponseDeps } from "./submitResponse.js";

// ---------------------------------------------------------------------------
// Block function mocks — injected via SubmitResponseDeps
// ---------------------------------------------------------------------------

type StructuredBlocksFn = NonNullable<SubmitResponseDeps["getStructuredResponseBlocks"]>;
type ValidateBlocksFn = NonNullable<SubmitResponseDeps["validateBlocks"]>;
type ValidateTableFn = NonNullable<SubmitResponseDeps["validateTable"]>;
type ValidateButtonLabelsFn = NonNullable<SubmitResponseDeps["validateActionButtonLabels"]>;
type ActionBlocksFn = NonNullable<SubmitResponseDeps["getResponseActionBlocks"]>;

const mockGetStructuredResponseBlocks = mock.fn<StructuredBlocksFn>();
const mockValidateBlocks = mock.fn<ValidateBlocksFn>();
const mockValidateTable = mock.fn<ValidateTableFn>();
const mockValidateActionButtonLabels = mock.fn<ValidateButtonLabelsFn>();
const mockGetResponseActionBlocks = mock.fn<ActionBlocksFn>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(
  overrides: Partial<{
    intentStore: IntentStore;
    responseCapture: ResponseCapture;
    recorder: ToolCallRecorder;
    sessionId: string;
    deliver: (opts: {
      blocks: object[];
      reactions?: string[];
    }) => Promise<{ ok: true; ts?: string } | { ok: false; error: string }>;
    persistSnapshot: (id: string, snapshot: ResponseSnapshot) => Promise<void>;
    allowSkip: boolean;
    submitResponseMode: "always" | "optional" | "skipped";
    allowDisengage: boolean;
    allowPostTopLevel: boolean;
    sessionChannelId: string;
    topLevelDeliveryChannel: string;
    requiredTools: string[];
    hasPendingInput: () => boolean;
    consumePendingPushedTexts: () => string[];
  }> = {},
) {
  const intentStore: IntentStore = {
    stage: mock.fn<(intent: StagedIntent) => string>(() => "ref-1"),
    resolve: mock.fn<(ref: string) => StagedIntent | undefined>(() => undefined),
    getAll: mock.fn<() => Map<string, StagedIntent>>(() => new Map()),
    ...overrides.intentStore,
  };

  const responseCapture: ResponseCapture = {
    set: mock.fn<(payload: unknown, blocks: unknown) => void>(),
    get: mock.fn<() => null>(() => null),
    getRenderedBlocks: mock.fn<() => null>(() => null),
    setSkipped: mock.fn<() => void>(),
    setDisengaged: mock.fn<() => void>(),
    setPostedTopLevel: mock.fn<() => void>(),
    isSkipped: mock.fn<() => boolean>(() => false),
    isDisengaged: mock.fn<() => boolean>(() => false),
    isPostedTopLevel: mock.fn<() => boolean>(() => false),
    ...overrides.responseCapture,
  };

  const recorder: ToolCallRecorder = {
    record: mock.fn<(tool: string, args: object, result: object) => void>(),
    getHistory: mock.fn<() => []>(() => []),
    ...overrides.recorder,
  };

  return {
    intentStore,
    responseCapture,
    recorder,
    sessionId: overrides.sessionId ?? "sess-123",
    deliver: overrides.deliver,
    persistSnapshot: overrides.persistSnapshot,
    allowSkip: overrides.allowSkip,
    submitResponseMode: overrides.submitResponseMode,
    allowDisengage: overrides.allowDisengage,
    allowPostTopLevel: overrides.allowPostTopLevel,
    sessionChannelId: overrides.sessionChannelId,
    topLevelDeliveryChannel: overrides.topLevelDeliveryChannel,
    requiredTools: overrides.requiredTools,
    hasPendingInput: overrides.hasPendingInput,
    consumePendingPushedTexts: overrides.consumePendingPushedTexts,
    getStructuredResponseBlocks: mockGetStructuredResponseBlocks,
    validateBlocks: mockValidateBlocks,
    validateTable: mockValidateTable,
    validateActionButtonLabels: mockValidateActionButtonLabels,
    getResponseActionBlocks: mockGetResponseActionBlocks,
  };
}

interface ToolAction {
  type: string;
  label?: string;
  prompt?: string;
  value?: string;
  ref?: string;
  auto?: boolean;
  blocks?: unknown[];
  content?: string;
  channel?: string;
  thread_ts?: string;
  // Allowed inside post_to actions only — exercised by the parity tests.
  actions?: ToolAction[];
  reactions?: string[];
  table?: unknown;
}

interface CallToolArgs {
  message?: string;
  blocks?: unknown[];
  sections?: { title?: string; body: string }[];
  actions: ToolAction[];
  reactions?: string[];
  table?: unknown;
}

/** Call the tool's handler directly. */
async function callTool(deps: ReturnType<typeof makeDeps>, args: CallToolArgs) {
  const toolDef = createSubmitResponseTool(deps);
  // Tool handler expects the zod-inferred type; the test args structurally match
  return toolDef.handler(Object.assign(Object.create(null), args), {});
}

/**
 * Superset of fields across every submit_response schema variant. Tests that exercise
 * variant-only fields (skip_response, disengage, post_top_level) use this to pass args
 * without needing to construct the exact inferred zod type.
 */
interface CallToolRawArgs {
  message?: string;
  blocks?: unknown[];
  sections?: { title?: string; body: string }[];
  actions?: ToolAction[];
  reactions?: string[];
  skip_response?: boolean;
  disengage?: boolean;
  post_top_level?: boolean;
}

async function callToolRawTopLevel(deps: ReturnType<typeof makeDeps>, args: CallToolRawArgs) {
  const toolDef = createSubmitResponseTool(deps);
  return toolDef.handler(Object.assign(Object.create(null), args), {});
}

function resetBlockMocks() {
  mockGetStructuredResponseBlocks.mock.resetCalls();
  mockValidateBlocks.mock.resetCalls();
  mockValidateTable.mock.resetCalls();
  mockValidateActionButtonLabels.mock.resetCalls();
  mockGetResponseActionBlocks.mock.resetCalls();

  // Defaults: valid blocks, no errors
  mockGetStructuredResponseBlocks.mock.mockImplementation(() => [
    { type: "section", text: { type: "mrkdwn", text: "test" } },
  ]);
  mockValidateBlocks.mock.mockImplementation(() => []);
  mockValidateTable.mock.mockImplementation(() => []);
  mockValidateActionButtonLabels.mock.mockImplementation(() => []);
  mockGetResponseActionBlocks.mock.mockImplementation(() => []);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSubmitResponseTool", () => {
  beforeEach(resetBlockMocks);

  describe("successful submission", () => {
    it("returns success result with blocks and action counts", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello world" } }],
        actions: [],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.delivered, false);
      assert.equal(parsed.blocksCount, 1);
      assert.equal(parsed.actionsCount, 0);
    });

    it("captures response via responseCapture.set()", async () => {
      const setCalls: unknown[][] = [];
      const deps = makeDeps({
        responseCapture: {
          set: ((...args: unknown[]) => {
            setCalls.push(args);
          }) as ResponseCapture["set"],
          get: () => null,
          getRenderedBlocks: () => null,
          setSkipped: () => {},
          setDisengaged: () => {},
          setPostedTopLevel: () => {},
          isSkipped: () => false,
          isDisengaged: () => false,
          isPostedTopLevel: () => false,
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Answer text" } }],
        actions: [],
      });

      assert.equal(setCalls.length, 1);
      const [payload] = setCalls[0] as [
        { blocks: { type: string; text?: { type: string; text: string } }[] },
      ];
      assert.equal(payload.blocks[0].type, "section");
      assert.equal(payload.blocks[0].text?.text, "Answer text");
    });

    it("records the tool call on success", async () => {
      const recorded: unknown[][] = [];
      const deps = makeDeps({
        recorder: {
          record: ((...args: unknown[]) => {
            recorded.push(args);
          }) as ToolCallRecorder["record"],
          getHistory: () => [],
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "ok" } }],
        actions: [],
      });

      assert.equal(recorded.length, 1);
      const [tool, , resultData] = recorded[0] as [string, unknown, { success: boolean }];
      assert.equal(tool, "submit_response");
      assert.equal(resultData.success, true);
    });

    it("handles message preamble in displayText", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        message: "Here you go:",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "The content" } }],
        actions: [],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("handles a header block plus a section", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Summary" } },
          {
            type: "section",
            text: { type: "mrkdwn", text: "Some summary text" },
          },
        ],
        actions: [],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });
  });

  describe("ref validation errors", () => {
    it("returns error for unknown ref in change action", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "Change proposed" },
          },
        ],
        actions: [{ type: "change", ref: "bad-ref" }],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.ok(parsed.error.includes("unknown ref"));
    });

    it("returns error for unknown ref in config_update action", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Config update" } }],
        actions: [{ type: "config_update", ref: "missing-ref" }],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.ok(parsed.error.includes("unknown ref"));
    });

    it("returns error for unknown ref in update action", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Update" } }],
        actions: [{ type: "update", ref: "nope" }],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.ok(parsed.error.includes("unknown ref"));
    });

    it("returns error when ref type mismatches action type", async () => {
      const deps = makeDeps({
        intentStore: {
          stage: () => "ref-1",
          resolve: () => ({
            type: "update" as const,
            sessionId: "s1",
            instructions: "do stuff",
          }),
          getAll: () => new Map(),
        },
      });

      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Mismatch" } }],
        actions: [{ type: "change", ref: "ref-1" }],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.ok(parsed.error.includes("update"));
      assert.ok(parsed.error.includes("change"));
    });

    it("passes validation when ref resolves to matching intent", async () => {
      const deps = makeDeps({
        intentStore: {
          stage: () => "ref-1",
          resolve: () => ({
            type: "change" as const,
            branch: "feat/x",
            description: "do stuff",
            repo: "my-repo",
          }),
          getAll: () => new Map(),
        },
      });

      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Change it" } }],
        actions: [{ type: "change", ref: "ref-1" }],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("does not validate refs for followup actions", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Follow up" } }],
        actions: [{ type: "followup", label: "More", prompt: "Tell me more" }],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("does not validate refs for choice actions", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Pick one" } }],
        actions: [{ type: "choice", label: "Option A", value: "a" }],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("records the tool call when ref validation fails", async () => {
      const recorded: unknown[][] = [];
      const deps = makeDeps({
        recorder: {
          record: ((...args: unknown[]) => {
            recorded.push(args);
          }) as ToolCallRecorder["record"],
          getHistory: () => [],
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "bad" } }],
        actions: [{ type: "change", ref: "bad-ref" }],
      });

      assert.equal(recorded.length, 1);
      const [tool, , resultData] = recorded[0] as [string, unknown, { error: string }];
      assert.equal(tool, "submit_response");
      assert.ok(resultData.error.includes("unknown ref"));
    });
  });

  describe("staged intent coverage", () => {
    it("returns error when a staged change intent is not included in actions", async () => {
      const deps = makeDeps({
        intentStore: {
          stage: () => "ref-1",
          resolve: (ref: string) =>
            ref === "ref-1"
              ? {
                  type: "change" as const,
                  branch: "feat/x",
                  description: "do stuff",
                  repo: "r",
                }
              : undefined,
          getAll: () =>
            new Map<string, StagedIntent>([
              [
                "ref-1",
                {
                  type: "change",
                  branch: "feat/x",
                  description: "do stuff",
                  repo: "r",
                },
              ],
            ]),
        },
      });

      const result = await callTool(deps, {
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "I'll set that up for you" },
          },
        ],
        actions: [],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.ok(parsed.error.includes("staged"));
      assert.ok(parsed.error.includes("ref-1"));
    });

    it("passes when all staged ref-action intents are included in actions", async () => {
      const deps = makeDeps({
        intentStore: {
          stage: () => "ref-1",
          resolve: (ref: string) =>
            ref === "ref-1"
              ? {
                  type: "change" as const,
                  branch: "feat/x",
                  description: "do stuff",
                  repo: "r",
                }
              : undefined,
          getAll: () =>
            new Map<string, StagedIntent>([
              [
                "ref-1",
                {
                  type: "change",
                  branch: "feat/x",
                  description: "do stuff",
                  repo: "r",
                },
              ],
            ]),
        },
      });

      const result = await callTool(deps, {
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "Here's the change" },
          },
        ],
        actions: [{ type: "change", ref: "ref-1" }],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("ignores non-ref intent types like review and merge", async () => {
      const deps = makeDeps({
        intentStore: {
          stage: () => "ref-1",
          resolve: () => undefined,
          getAll: () =>
            new Map<string, StagedIntent>([
              ["ref-1", { type: "review", sessionId: "s1", instructions: "review it" }],
              ["ref-2", { type: "merge", sessionId: "s2", instructions: "merge it" }],
            ]),
        },
      });

      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Done" } }],
        actions: [],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("passes when no intents are staged", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Simple answer" } }],
        actions: [],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });
  });

  describe("response too long", () => {
    it("returns error when display text exceeds 10000 chars", async () => {
      const deps = makeDeps();
      const longBody = "x".repeat(10001);
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: longBody } }],
        actions: [],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.error, "response_too_long");
      assert.ok(parsed.details.includes("10000"));
    });

    it("includes message length in the total", async () => {
      const deps = makeDeps();
      // message + section body + formatting exceeds limit
      const result = await callTool(deps, {
        message: "a".repeat(5000),
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "b".repeat(5001) } }],
        actions: [],
      });

      // message + "\n\n" + body = 5000 + 2 + 5001 = 10003 > 10000
      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.error, "response_too_long");
    });

    it("records the error in recorder", async () => {
      const recorded: unknown[][] = [];
      const deps = makeDeps({
        recorder: {
          record: ((...args: unknown[]) => {
            recorded.push(args);
          }) as ToolCallRecorder["record"],
          getHistory: () => [],
        },
      });

      await callTool(deps, {
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "x".repeat(10001) },
          },
        ],
        actions: [],
      });

      assert.equal(recorded.length, 1);
      const [, , resultData] = recorded[0] as [string, unknown, { error: string }];
      assert.equal(resultData.error, "response_too_long");
    });
  });

  describe("block validation errors", () => {
    it("returns error when validateSlackBlocks reports violations", async () => {
      mockValidateBlocks.mock.mockImplementation(() => [
        {
          field: "section[0].text",
          message: "text too long",
          currentLength: 4000,
          limit: 3000,
        },
      ]);

      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "ok" } }],
        actions: [],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.error, "invalid_blocks");
      assert.ok(Array.isArray(parsed.details));
      assert.ok(parsed.details[0].includes("section[0].text"));
    });

    it("does not deliver or capture when blocks are invalid", async () => {
      mockValidateBlocks.mock.mockImplementation(() => [
        { field: "blocks", message: "too many", currentLength: 60, limit: 50 },
      ]);

      let delivered = false;
      const setCalls: unknown[] = [];
      const deps = makeDeps({
        deliver: async () => {
          delivered = true;
          return { ok: true as const };
        },
        responseCapture: {
          set: (() => {
            setCalls.push(true);
          }) as ResponseCapture["set"],
          get: () => null,
          getRenderedBlocks: () => null,
          setSkipped: () => {},
          setDisengaged: () => {},
          setPostedTopLevel: () => {},
          isSkipped: () => false,
          isDisengaged: () => false,
          isPostedTopLevel: () => false,
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "ok" } }],
        actions: [],
      });

      assert.equal(delivered, false);
      assert.equal(setCalls.length, 0);
    });
  });

  describe("delivery", () => {
    it("calls deliver when provided and marks delivered=true", async () => {
      const deliverCalls: unknown[] = [];
      const deps = makeDeps({
        deliver: async (opts) => {
          deliverCalls.push(opts);
          return { ok: true as const };
        },
      });

      const result = await callTool(deps, {
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "Delivered answer" },
          },
        ],
        actions: [],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.delivered, true);
      assert.equal(deliverCalls.length, 1);
    });

    it("passes rendered blocks to deliver", async () => {
      let receivedBlocks: object[] = [];
      const deps = makeDeps({
        deliver: async (opts: { blocks: object[] }) => {
          receivedBlocks = opts.blocks;
          return { ok: true as const };
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "The answer" } }],
        actions: [],
      });

      assert.ok(receivedBlocks.length > 0);
    });

    it("includes blocks in deliver when action blocks are present", async () => {
      mockGetResponseActionBlocks.mock.mockImplementation(() => [
        { type: "actions", elements: [] },
      ]);

      let receivedBlocks: unknown;
      const deps = makeDeps({
        deliver: async (opts: { blocks: object[] }) => {
          receivedBlocks = opts.blocks;
          return { ok: true as const };
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "With actions" } }],
        actions: [{ type: "followup", label: "More", prompt: "more" }],
      });

      assert.ok(Array.isArray(receivedBlocks));
    });

    it("still delivers the response blocks even when no action blocks are present", async () => {
      mockGetResponseActionBlocks.mock.mockImplementation(() => []);

      let receivedBlocks: object[] | undefined;
      const deps = makeDeps({
        deliver: async (opts: { blocks: object[] }) => {
          receivedBlocks = opts.blocks;
          return { ok: true as const };
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "No actions" } }],
        actions: [],
      });

      // The `blocks` key carries the full response rendering (no longer gated on action buttons).
      assert.ok(Array.isArray(receivedBlocks));
    });

    it("returns error when delivery fails", async () => {
      const deps = makeDeps({
        deliver: async () => ({
          ok: false as const,
          error: "channel_not_found",
        }),
      });

      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Will fail" } }],
        actions: [],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.error, "delivery_failed");
      assert.equal(parsed.details, "channel_not_found");
    });

    it("records delivery failure in recorder", async () => {
      const recorded: unknown[][] = [];
      const deps = makeDeps({
        deliver: async () => ({ ok: false as const, error: "timeout" }),
        recorder: {
          record: ((...args: unknown[]) => {
            recorded.push(args);
          }) as ToolCallRecorder["record"],
          getHistory: () => [],
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Fail" } }],
        actions: [],
      });

      assert.equal(recorded.length, 1);
      const [, , resultData] = recorded[0] as [string, unknown, { error: string; details: string }];
      assert.equal(resultData.error, "delivery_failed");
      assert.equal(resultData.details, "timeout");
    });

    it("still captures response when no deliver function is provided", async () => {
      const setCalls: unknown[][] = [];
      const deps = makeDeps({
        responseCapture: {
          set: ((...args: unknown[]) => {
            setCalls.push(args);
          }) as ResponseCapture["set"],
          get: () => null,
          getRenderedBlocks: () => null,
          setSkipped: () => {},
          setDisengaged: () => {},
          setPostedTopLevel: () => {},
          isSkipped: () => false,
          isDisengaged: () => false,
          isPostedTopLevel: () => false,
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "No deliver" } }],
        actions: [],
      });

      assert.equal(setCalls.length, 1);
    });

    it("passes reactions through to deliver callback", async () => {
      let receivedReactions: string[] | undefined;
      const deps = makeDeps({
        deliver: async (opts) => {
          receivedReactions = opts.reactions;
          return { ok: true as const };
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "With reactions" } }],
        actions: [],
        reactions: ["thumbsup", "eyes"],
      });

      assert.deepEqual(receivedReactions, ["thumbsup", "eyes"]);
    });

    it("does not include reactions key in deliver when not provided", async () => {
      let hasReactionsKey = false;
      const deps = makeDeps({
        deliver: async (opts) => {
          hasReactionsKey = "reactions" in opts;
          return { ok: true as const };
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "No reactions" } }],
        actions: [],
      });

      assert.equal(hasReactionsKey, false);
    });

    it("ignores reactions when no deliver callback is configured", async () => {
      const deps = makeDeps();

      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "No deliver" } }],
        actions: [],
        reactions: ["thumbsup"],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });
  });

  describe("per-button content persistence", () => {
    it("does not create snapshots when no post_to actions exist", async () => {
      const snapshots: { id: string; snapshot: ResponseSnapshot }[] = [];
      const deps = makeDeps({
        persistSnapshot: async (id, snapshot) => {
          snapshots.push({ id, snapshot });
        },
      });

      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "No buttons" } }],
        actions: [],
      });

      assert.equal(snapshots.length, 0);
      const parsed = parseToolResult(result);
      assert.equal(parsed.snapshotId, undefined);
    });

    it("creates one content entry per post_to action", async () => {
      const snapshots: { id: string; snapshot: ResponseSnapshot }[] = [];
      const deps = makeDeps({
        persistSnapshot: async (id, snapshot) => {
          snapshots.push({ id, snapshot });
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Options" } }],
        actions: [
          {
            type: "post_to",
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "Option 1 text" },
              },
            ],
            label: "Send 1",
          },
          {
            type: "post_to",
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "Option 2 text" },
              },
            ],
            label: "Send 2",
          },
        ],
      });

      assert.equal(snapshots.length, 2);
      assert.equal(snapshots[0].snapshot.text, "Option 1 text");
      assert.equal(snapshots[1].snapshot.text, "Option 2 text");
      assert.equal(snapshots[0].snapshot.blocks.length, 1);
      assert.equal(snapshots[1].snapshot.blocks.length, 1);
      // IDs should be unique
      assert.notEqual(snapshots[0].id, snapshots[1].id);
    });

    it("sets _snapshotId on each post_to action", async () => {
      const snapshots: { id: string }[] = [];
      const setCalls: unknown[][] = [];
      const deps = makeDeps({
        persistSnapshot: async (id) => {
          snapshots.push({ id });
        },
        responseCapture: {
          set: ((...args: unknown[]) => {
            setCalls.push(args);
          }) as ResponseCapture["set"],
          get: () => null,
          getRenderedBlocks: () => null,
          setSkipped: () => {},
          setDisengaged: () => {},
          setPostedTopLevel: () => {},
          isSkipped: () => false,
          isDisengaged: () => false,
          isPostedTopLevel: () => false,
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Answer" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Share this" } }],
          },
        ],
      });

      const [payload] = setCalls[0] as [{ actions: { _snapshotId?: string }[] }];
      assert.equal(payload.actions[0]._snapshotId, snapshots[0].id);
    });

    it("does not set _snapshotId when persistSnapshot is not provided", async () => {
      const setCalls: unknown[][] = [];
      const deps = makeDeps({
        responseCapture: {
          set: ((...args: unknown[]) => {
            setCalls.push(args);
          }) as ResponseCapture["set"],
          get: () => null,
          getRenderedBlocks: () => null,
          setSkipped: () => {},
          setDisengaged: () => {},
          setPostedTopLevel: () => {},
          isSkipped: () => false,
          isDisengaged: () => false,
          isPostedTopLevel: () => false,
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "no persist" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "text" } }],
          },
        ],
      });

      const [payload] = setCalls[0] as [{ actions: { _snapshotId?: string }[] }];
      assert.equal(payload.actions[0]._snapshotId, undefined);
    });
  });

  describe("skip_response", () => {
    /** Call the tool with arbitrary args (no type enforcement for skip tests). */
    async function callToolRaw(deps: ReturnType<typeof makeDeps>, args: Record<string, unknown>) {
      const toolDef = createSubmitResponseTool(deps);
      return toolDef.handler(args as never, {});
    }

    it("accepts skip with correct acknowledgment message", async () => {
      const deps = makeDeps({ allowSkip: true });
      const result = await callToolRaw(deps, {
        skip_response: true,
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, true);
      // Verify setSkipped was actually called (this is the signal to buildSuccessResponse)
      assert.equal(
        (deps.responseCapture.setSkipped as unknown as ReturnType<typeof mock.fn>).mock.callCount(),
        1,
      );
    });

    it("rejects skip with wrong message", async () => {
      const deps = makeDeps({ allowSkip: true });
      const result = await callToolRaw(deps, {
        skip_response: true,
        message: "I want to skip",
      });

      assert.equal(result.isError, true);
      const text = toolResultText(result);
      assert.ok(text.includes("I acknowledge that responding to this would serve no purpose"));
    });

    it("rejects skip with missing message", async () => {
      const deps = makeDeps({ allowSkip: true });
      const result = await callToolRaw(deps, {
        skip_response: true,
      });

      assert.equal(result.isError, true);
      const text = toolResultText(result);
      assert.ok(text.includes("I acknowledge that responding to this would serve no purpose"));
    });

    it("does not call deliver when skip is accepted", async () => {
      const deliver = mock.fn(async () => ({ ok: true as const }));
      const deps = makeDeps({ deliver, allowSkip: true });
      await callToolRaw(deps, {
        skip_response: true,
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      assert.equal(deliver.mock.callCount(), 0);
    });

    it("accepts skip with disengage and returns disengaged flag", async () => {
      const deps = makeDeps({ allowSkip: true });
      const result = await callToolRaw(deps, {
        skip_response: true,
        disengage: true,
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, true);
      assert.equal(parsed.disengaged, true);
    });

    it("accepts disengage without skip_response (normal response + disengage)", async () => {
      const setDisengagedFn = mock.fn<() => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setDisengaged: setDisengagedFn,
        },
      });
      const result = await callToolRaw(deps, {
        disengage: true,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "You're welcome!" },
          },
        ],
        actions: [],
      });

      assert.notEqual(result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.disengaged, true);
      assert.equal(setDisengagedFn.mock.callCount(), 1);
    });

    it("calls both setSkipped and setDisengaged on skip + disengage", async () => {
      const setSkippedFn = mock.fn<() => void>();
      const setDisengagedFn = mock.fn<() => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setSkipped: setSkippedFn,
          setDisengaged: setDisengagedFn,
        },
      });
      await callToolRaw(deps, {
        skip_response: true,
        disengage: true,
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      assert.equal(setSkippedFn.mock.callCount(), 1);
      assert.equal(setDisengagedFn.mock.callCount(), 1);
    });

    it("calls only setSkipped on skip without disengage", async () => {
      const setSkippedFn = mock.fn<() => void>();
      const setDisengagedFn = mock.fn<() => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setSkipped: setSkippedFn,
          setDisengaged: setDisengagedFn,
        },
      });
      await callToolRaw(deps, {
        skip_response: true,
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      assert.equal(setSkippedFn.mock.callCount(), 1);
      assert.equal(setDisengagedFn.mock.callCount(), 0);
    });

    it("normal flow unchanged when allowSkip is true but skip_response is absent", async () => {
      const deps = makeDeps({ allowSkip: true });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, undefined);
      assert.equal(parsed.blocksCount, 1);
    });

    it("delivery_failed on normal+disengage path does not mark capture as disengaged", async () => {
      const setDisengagedFn = mock.fn<() => void>();
      const failingDeliver = mock.fn(async () => ({
        ok: false as const,
        error: "network down",
      }));
      const deps = makeDeps({
        allowSkip: true,
        deliver: failingDeliver,
        responseCapture: {
          ...makeDeps().responseCapture,
          setDisengaged: setDisengagedFn,
        },
      });
      const result = await callToolRaw(deps, {
        disengage: true,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "You're welcome!" },
          },
        ],
        actions: [],
      });

      assert.equal(result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.error, "delivery_failed");
      assert.equal(setDisengagedFn.mock.callCount(), 0);
    });

    it("normal+disengage is idempotent when capture is already disengaged", async () => {
      const setDisengagedFn = mock.fn<() => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setDisengaged: setDisengagedFn,
          isDisengaged: () => true,
        },
      });
      const result = await callToolRaw(deps, {
        disengage: true,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Got it" } }],
        actions: [],
      });

      assert.notEqual(result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.disengaged, true);
    });

    it("allowDisengage without allowSkip exposes disengage on normal response", async () => {
      const setDisengagedFn = mock.fn<() => void>();
      const deps = makeDeps({
        allowDisengage: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setDisengaged: setDisengagedFn,
        },
      });
      const result = await callToolRaw(deps, {
        disengage: true,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "Thanks, talk later." },
          },
        ],
        actions: [],
      });

      assert.notEqual(result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.disengaged, true);
      assert.equal(setDisengagedFn.mock.callCount(), 1);
    });

    it("allowSkip without allowDisengage omits disengage from the schema (scheduled-with-skipConditions case)", () => {
      const deps = makeDeps({ allowSkip: true, allowDisengage: false });
      const toolDef = createSubmitResponseTool(deps);
      const shapeKeys = Object.keys(toolDef.inputSchema);

      assert.ok(shapeKeys.includes("skip_response"), "skip_response should be exposed");
      assert.equal(
        shapeKeys.includes("disengage"),
        false,
        "disengage must NOT be exposed when allowDisengage is false",
      );
    });

    it("allowSkip with allowDisengage keeps both skip_response and disengage in the schema", () => {
      const deps = makeDeps({ allowSkip: true, allowDisengage: true });
      const toolDef = createSubmitResponseTool(deps);
      const shapeKeys = Object.keys(toolDef.inputSchema);

      assert.ok(shapeKeys.includes("skip_response"));
      assert.ok(shapeKeys.includes("disengage"));
    });

    it("skip-only schema accepts a skip response without a disengage field", async () => {
      const deps = makeDeps({ allowSkip: true, allowDisengage: false });
      const result = await callToolRaw(deps, {
        skip_response: true,
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      assert.notEqual(result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, true);
      assert.equal(parsed.disengaged, undefined);
    });

    it("allowDisengage without allowSkip still blocks disengage on delivery failure", async () => {
      const setDisengagedFn = mock.fn<() => void>();
      const failingDeliver = mock.fn(async () => ({
        ok: false as const,
        error: "network down",
      }));
      const deps = makeDeps({
        allowDisengage: true,
        deliver: failingDeliver,
        responseCapture: {
          ...makeDeps().responseCapture,
          setDisengaged: setDisengagedFn,
        },
      });
      const result = await callToolRaw(deps, {
        disengage: true,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "done" } }],
        actions: [],
      });

      assert.equal(result.isError, true);
      assert.equal(setDisengagedFn.mock.callCount(), 0);
    });
  });

  describe("post_top_level", () => {
    it("passes postTopLevel: true to deliver when allowed and set", async () => {
      const deliverCalls: { postTopLevel?: boolean }[] = [];
      const deliver = async (opts: {
        blocks: object[];
        postTopLevel?: boolean;
      }): Promise<{ ok: true; ts?: string } | { ok: false; error: string }> => {
        deliverCalls.push({ postTopLevel: opts.postTopLevel });
        return { ok: true, ts: "9999.0001" };
      };
      const deps = makeDeps({
        allowPostTopLevel: true,
        sessionChannelId: "C_SESSION",
        deliver,
      });
      const result = await callToolRawTopLevel(deps, {
        post_top_level: true,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Broadcast this" } }],
        actions: [],
      });

      assert.notEqual(result.isError, true);
      assert.equal(deliverCalls.length, 1);
      assert.equal(deliverCalls[0].postTopLevel, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.postedTopLevel, true);
    });

    it("omits postTopLevel on deliver when allowed but not set", async () => {
      const deliverCalls: { postTopLevel?: boolean }[] = [];
      const deliver = async (opts: {
        blocks: object[];
        postTopLevel?: boolean;
      }): Promise<{ ok: true; ts?: string } | { ok: false; error: string }> => {
        deliverCalls.push({ postTopLevel: opts.postTopLevel });
        return { ok: true };
      };
      const deps = makeDeps({
        allowPostTopLevel: true,
        sessionChannelId: "C_SESSION",
        deliver,
      });
      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "normal" } }],
        actions: [],
      });

      assert.equal(deliverCalls.length, 1);
      assert.equal(deliverCalls[0].postTopLevel, undefined);
    });

    it("rejects post_to targeting the session channel without thread_ts when post_top_level is true", async () => {
      const deps = makeDeps({
        allowPostTopLevel: true,
        sessionChannelId: "C_SESSION",
      });
      const result = await callToolRawTopLevel(deps, {
        post_top_level: true,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
        actions: [
          {
            type: "post_to",
            auto: true,
            channel: "C_SESSION",
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "duplicate broadcast" },
              },
            ],
          },
        ],
      });

      assert.equal(result.isError, true);
      const text = toolResultText(result);
      assert.ok(text.includes("duplicate"), `expected duplicate-rejection error, got: ${text}`);
    });

    it("allows post_to to a DIFFERENT channel when post_top_level is true", async () => {
      const deps = makeDeps({
        allowPostTopLevel: true,
        sessionChannelId: "C_SESSION",
      });
      const result = await callToolRawTopLevel(deps, {
        post_top_level: true,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
        actions: [
          {
            type: "post_to",
            auto: true,
            channel: "C_OTHER",
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "cross-channel broadcast" },
              },
            ],
          },
        ],
      });

      assert.notEqual(result.isError, true);
    });

    it("allows post_to to the same channel WITH thread_ts when post_top_level is true", async () => {
      const deps = makeDeps({
        allowPostTopLevel: true,
        sessionChannelId: "C_SESSION",
      });
      const result = await callToolRawTopLevel(deps, {
        post_top_level: true,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
        actions: [
          {
            type: "post_to",
            auto: true,
            channel: "C_SESSION",
            thread_ts: "1234.5678",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "reply to a specific thread in the same channel",
                },
              },
            ],
          },
        ],
      });

      assert.notEqual(result.isError, true);
    });
  });

  describe("required tools gate", () => {
    it("no required tools — delivery proceeds", async () => {
      const deps = makeDeps({ requiredTools: [] });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("all required tools called — delivery proceeds", async () => {
      const deps = makeDeps({
        requiredTools: ["mcp__trivia__submit_answers"],
        recorder: {
          record: mock.fn<ToolCallRecorder["record"]>(),
          getHistory: () => [
            {
              tool: "mcp__trivia__submit_answers",
              args: {},
              result: { success: true },
              timestamp: 1,
            },
          ],
        },
      });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("missing required tool — returns error and does not deliver", async () => {
      const deliverFn =
        mock.fn<
          (opts: {
            blocks: object[];
            reactions?: string[];
          }) => Promise<{ ok: true; ts?: string } | { ok: false; error: string }>
        >();
      const deps = makeDeps({
        requiredTools: ["mcp__trivia__submit_answers"],
        deliver: deliverFn,
      });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });

      assert.equal(result.isError, true);
      assert.ok(toolResultText(result).includes("mcp__trivia__submit_answers"));
      assert.ok(toolResultText(result).includes("have not been called"));
      assert.equal(deliverFn.mock.callCount(), 0);
    });

    it("partially missing — lists only missing names", async () => {
      const deps = makeDeps({
        requiredTools: ["mcp__trivia__submit_answers", "mcp__trivia__save_question"],
        recorder: {
          record: mock.fn<ToolCallRecorder["record"]>(),
          getHistory: () => [
            {
              tool: "mcp__trivia__submit_answers",
              args: {},
              result: {},
              timestamp: 1,
            },
          ],
        },
      });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });

      assert.equal(result.isError, true);
      const text = toolResultText(result);
      assert.ok(text.includes("mcp__trivia__save_question"));
      assert.ok(
        !text.includes("mcp__trivia__submit_answers,"),
        "should not list already-called tool",
      );
    });

    it("required tool called but errored still counts — delivery proceeds", async () => {
      const deps = makeDeps({
        requiredTools: ["mcp__trivia__submit_answers"],
        recorder: {
          record: mock.fn<ToolCallRecorder["record"]>(),
          getHistory: () => [
            {
              tool: "mcp__trivia__submit_answers",
              args: {},
              result: { error: "something broke" },
              timestamp: 1,
            },
          ],
        },
      });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("gate blocks even when skip_response is true", async () => {
      const deps = makeDeps({
        allowSkip: true,
        requiredTools: ["mcp__trivia__submit_answers"],
      });
      const toolDef = createSubmitResponseTool(deps);
      const result = await toolDef.handler(
        Object.assign(Object.create(null), {
          skip_response: true,
          message:
            "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
        }),
        {},
      );
      assert.equal(result.isError, true);
      assert.ok(toolResultText(result).includes("mcp__trivia__submit_answers"));
    });
  });

  describe("schema-level validation errors (boundary)", () => {
    // The SDK validates inputs against the tool's inputSchema BEFORE the
    // handler runs. The custom Zod error maps below ensure the model gets an
    // actionable message when it picks an unsupported block/action type —
    // otherwise the Zod error would just be a generic "Invalid input" and
    // the model has historically misread that as "the MCP is disconnected".
    function inputSchemaOf(deps: ReturnType<typeof makeDeps>) {
      return z.object(createSubmitResponseTool(deps).inputSchema);
    }

    it("emits an actionable error for an unknown block type", () => {
      const result = inputSchemaOf(makeDeps()).safeParse({
        blocks: [{ type: "header", text: { type: "plain_text", text: "h" } }, { type: "fancy" }],
        actions: [],
      });
      assert.equal(result.success, false);
      const message = result.success ? "" : result.error.issues[0]?.message;
      assert.match(message, /Block type "fancy" is not supported/);
      assert.match(message, /Allowed block types:/);
    });

    it("emits an actionable error for an unknown action type", () => {
      const result = inputSchemaOf(makeDeps()).safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "hi" } }],
        actions: [{ type: "definitely_not_real" }],
      });
      assert.equal(result.success, false);
      const message = result.success ? "" : result.error.issues[0]?.message;
      assert.match(message, /Action type "definitely_not_real" is not supported/);
      assert.match(message, /Allowed action types:/);
    });
  });

  // ---------------------------------------------------------------------------
  // post_to / submit_response message-content parity
  // ---------------------------------------------------------------------------

  describe("post_to message-content parity", () => {
    it("accepts post_to with reactions and nested actions", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Top" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Cross-post" } }],
            reactions: ["white_check_mark"],
            actions: [{ type: "followup", label: "Tell me more", prompt: "More?" }],
          },
        ],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("rejects unknown ref placed inside post_to.actions with a path-prefixed error", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Top" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Cross-post" } }],
            actions: [{ type: "change", ref: "missing-ref" }],
          },
        ],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.ok(parsed.error.includes("unknown ref"));
      // Path label should identify the nested location.
      assert.ok(
        parsed.error.includes("actions[0].actions[0]"),
        `expected error to include nested path, got: ${parsed.error}`,
      );
    });

    it("rejects oversize button label inside post_to.actions with a path-prefixed error", async () => {
      const deps = makeDeps();
      // Emit an error only on the SECOND validateActionButtonLabels call (the nested
      // one for post_to.actions). The first call validates top-level actions and
      // must succeed so the handler advances to the nested check.
      mockGetResponseActionBlocks.mock.mockImplementation((actions) =>
        actions.length > 0 ? [{ type: "actions", elements: [] }] : [],
      );
      let callCount = 0;
      mockValidateActionButtonLabels.mock.mockImplementation(() => {
        callCount += 1;
        if (callCount === 2) {
          return [
            {
              field: "elements[0].text.text",
              message: "label exceeds 75 chars (got 90)",
              currentLength: 90,
              limit: 75,
            },
          ];
        }
        return [];
      });

      const longLabel = "x".repeat(90);
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Top" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Cross-post" } }],
            actions: [{ type: "followup", label: longLabel, prompt: "x" }],
          },
        ],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.ok(
        Array.isArray(parsed.details) &&
          parsed.details.some((d: string) => d.startsWith("actions[0].")),
        `expected nested path prefix in details, got: ${JSON.stringify(parsed.details)}`,
      );
    });

    it("treats a staged intent placed only inside post_to.actions as covered", async () => {
      const stagedIntent = {
        type: "change" as const,
        branch: "feat/x",
        description: "do stuff",
        repo: "my-repo",
      };
      const deps = makeDeps({
        intentStore: {
          stage: () => "ref-1",
          resolve: (ref: string) => (ref === "ref-1" ? stagedIntent : undefined),
          getAll: () => new Map([["ref-1", stagedIntent]]),
        },
      });

      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Top" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Cross-post" } }],
            actions: [{ type: "change", ref: "ref-1" }],
          },
        ],
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true, `unexpected error: ${JSON.stringify(parsed)}`);
    });

    it("rejects nested post_to inside post_to.actions with an actionable message", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Top" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Outer" } }],
            actions: [
              {
                type: "post_to",
                blocks: [{ type: "section", text: { type: "mrkdwn", text: "Inner" } }],
              },
            ],
          },
        ],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.match(parsed.error, /[Nn]ested post_to is not supported/);
      assert.ok(parsed.error.includes("actions[0].actions[0]"));
    });

    it("snapshot persistence captures actions and reactions when present", async () => {
      const snapshots: { id: string; snapshot: ResponseSnapshot }[] = [];
      const deps = makeDeps({
        persistSnapshot: async (id, snapshot) => {
          snapshots.push({ id, snapshot });
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Top" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Cross-post" } }],
            reactions: ["white_check_mark", "thumbsup"],
            actions: [{ type: "followup", label: "More", prompt: "Tell me more" }],
          },
        ],
      });

      assert.equal(snapshots.length, 1);
      assert.deepEqual(snapshots[0].snapshot.reactions, ["white_check_mark", "thumbsup"]);
      assert.equal(snapshots[0].snapshot.actions?.length, 1);
      assert.equal(snapshots[0].snapshot.actions?.[0].type, "followup");
    });

    it("snapshot persistence omits actions and reactions when absent", async () => {
      const snapshots: { id: string; snapshot: ResponseSnapshot }[] = [];
      const deps = makeDeps({
        persistSnapshot: async (id, snapshot) => {
          snapshots.push({ id, snapshot });
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Top" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Cross-post" } }],
          },
        ],
      });

      assert.equal(snapshots.length, 1);
      assert.equal(
        "actions" in snapshots[0].snapshot,
        false,
        "snapshot should not contain `actions` key when absent on the action",
      );
      assert.equal(
        "reactions" in snapshots[0].snapshot,
        false,
        "snapshot should not contain `reactions` key when absent on the action",
      );
    });
  });

  describe("top-level table parameter", () => {
    it("accepts a valid top-level table alongside blocks", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Heading" } }],
        actions: [],
        table: {
          type: "table",
          rows: [
            ["Repo", "Status"],
            ["clack", "active"],
          ],
        },
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      // validateTable was invoked with the table, prefixed as "table"
      assert.equal(mockValidateTable.mock.callCount(), 1);
      const [tableArg, pathArg] = mockValidateTable.mock.calls[0].arguments;
      assert.equal((tableArg as { type: string }).type, "table");
      assert.equal(pathArg, "table");
    });

    it("rejects an invalid top-level table with field-prefixed errors", async () => {
      mockValidateTable.mock.mockImplementation(() => [
        {
          field: "table.rows",
          message: "table has 200 rows, exceeding the 100-row limit",
          currentLength: 200,
          limit: 100,
        },
      ]);

      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Heading" } }],
        actions: [],
        table: { type: "table", rows: [["a"]] },
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.error, "invalid_blocks");
      assert.ok(
        Array.isArray(parsed.details) &&
          parsed.details.some((d: string) => d.startsWith("table.rows:")),
        `expected error details to surface table.rows path, got: ${JSON.stringify(parsed.details)}`,
      );
    });

    it("validates table inside a post_to action with a path-prefixed namespace", async () => {
      // The post_to.table validation runs after blocks validation; emit an
      // error specifically when the caller passes the post_to path prefix.
      mockValidateTable.mock.mockImplementation((_block, prefix) => {
        if (prefix === "actions[0].table") {
          return [
            {
              field: "actions[0].table.rows",
              message: "table has 200 rows",
              currentLength: 200,
              limit: 100,
            },
          ];
        }
        return [];
      });

      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Top" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Cross-post" } }],
            table: { type: "table", rows: [["a"]] },
          },
        ],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.error, "invalid_blocks");
      assert.ok(
        Array.isArray(parsed.details) &&
          parsed.details.some((d: string) => d.startsWith("actions[0].table.rows:")),
        `expected post_to.table path prefix, got: ${JSON.stringify(parsed.details)}`,
      );
    });

    it("persists post_to.table into the per-button snapshot", async () => {
      const snapshots: { id: string; snapshot: ResponseSnapshot }[] = [];
      const deps = makeDeps({
        persistSnapshot: async (id, snapshot) => {
          snapshots.push({ id, snapshot });
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Top" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Cross-post" } }],
            table: { type: "table", rows: [["x"]] },
          },
        ],
      });

      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].snapshot.table?.type, "table");
    });

    it("does not call validateTable when no table is present", async () => {
      const deps = makeDeps();
      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });
      assert.equal(mockValidateTable.mock.callCount(), 0);
    });
  });

  describe("pending-input gate", () => {
    it("returns an error and inlines the queued texts when hasPendingInput is true", async () => {
      const queue = ["ok ty works", "what are you doing"];
      const deps = makeDeps({
        hasPendingInput: () => queue.length > 0,
        consumePendingPushedTexts: () => queue.splice(0, queue.length),
      });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });
      const parsed = parseToolResult(result);
      assert.ok(parsed.error, "expected an error");
      assert.deepEqual(parsed.new_user_messages, ["ok ty works", "what are you doing"]);
    });

    it("clears the queue so the next submit_response goes through", async () => {
      const queue = ["mid-turn"];
      const deps = makeDeps({
        hasPendingInput: () => queue.length > 0,
        consumePendingPushedTexts: () => queue.splice(0, queue.length),
      });
      // First call hits the gate
      const blocked = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "first" } }],
        actions: [],
      });
      assert.ok(parseToolResult(blocked).error);
      // Queue is drained — second call succeeds
      const ok = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "after addressing" } }],
        actions: [],
      });
      const parsed = parseToolResult(ok);
      assert.equal(parsed.success, true);
    });

    it("bypasses the gate after MAX_GATE_REJECTIONS to prevent deadlock", async () => {
      // Simulate the broken case: hasPendingInput stays true forever (consume callback
      // missing or buggy). After 5 rejections the gate must let the response through.
      const deps = makeDeps({
        hasPendingInput: () => true,
        consumePendingPushedTexts: () => [],
      });
      const toolDef = createSubmitResponseTool(deps);
      const args = {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "hello" } }],
        actions: [],
      };
      // 5 rejections, then bypass on the 6th call
      for (let i = 0; i < 5; i++) {
        const blocked = await toolDef.handler(Object.assign(Object.create(null), args), {});
        assert.ok(parseToolResult(blocked).error, `attempt ${i + 1} should be gated`);
      }
      const bypassed = await toolDef.handler(Object.assign(Object.create(null), args), {});
      assert.equal(parseToolResult(bypassed).success, true, "6th attempt should bypass the gate");
    });

    it("does not consume the queue when there are no pending pushes", async () => {
      let consumeCalls = 0;
      const deps = makeDeps({
        hasPendingInput: () => false,
        consumePendingPushedTexts: () => {
          consumeCalls++;
          return [];
        },
      });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });
      assert.equal(parseToolResult(result).success, true);
      assert.equal(consumeCalls, 0, "consume must not be called when nothing is pending");
    });

    it("stays functional across push-drain-push cycles", async () => {
      // Regression: after the gate drains the queue, a fresh push must surface the same
      // way (gate fires again with the new text, then clears).
      const queue: string[] = [];
      const deps = makeDeps({
        hasPendingInput: () => queue.length > 0,
        consumePendingPushedTexts: () => queue.splice(0, queue.length),
      });
      const toolDef = createSubmitResponseTool(deps);
      const args = {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "hello" } }],
        actions: [],
      };

      queue.push("A");
      const firstBlocked = await toolDef.handler(Object.assign(Object.create(null), args), {});
      const firstParsed = parseToolResult(firstBlocked);
      assert.deepEqual(firstParsed.new_user_messages, ["A"]);

      queue.push("B");
      const secondBlocked = await toolDef.handler(Object.assign(Object.create(null), args), {});
      const secondParsed = parseToolResult(secondBlocked);
      assert.deepEqual(
        secondParsed.new_user_messages,
        ["B"],
        "second drain must surface the new push, not stale A",
      );

      const ok = await toolDef.handler(Object.assign(Object.create(null), args), {});
      assert.equal(parseToolResult(ok).success, true, "queue empty → gate clears");
    });

    it("falls back to a generic error when hasPendingInput is true but consume returns empty", async () => {
      // Edge case: stale `hasPendingInput` flag with an empty queue (shouldn't normally
      // happen, but guards against a race or buggy callback). The gate still fires but
      // the error text uses the singular fallback wording — no `new_user_messages` to list.
      const deps = makeDeps({
        hasPendingInput: () => true,
        consumePendingPushedTexts: () => [],
      });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        actions: [],
      });
      const parsed = parseToolResult(result);
      assert.ok(parsed.error, "gate should still fire");
      assert.deepEqual(parsed.new_user_messages, []);
      assert.match(
        parsed.error,
        /A new user message arrived/,
        "fallback wording when consume returned no texts",
      );
    });
  });

  describe("submitResponseMode 'skipped'", () => {
    it("accepts a plain { skip_response: true } call with no message field", async () => {
      const deps = makeDeps({ allowSkip: true, submitResponseMode: "skipped" });
      const toolDef = createSubmitResponseTool(deps);
      const result = await toolDef.handler({ skip_response: true }, {});

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, true);
    });

    it("does not call deliver when in skipped mode", async () => {
      const deliver = mock.fn(async () => ({ ok: true as const }));
      const deps = makeDeps({ deliver, allowSkip: true, submitResponseMode: "skipped" });
      const toolDef = createSubmitResponseTool(deps);
      await toolDef.handler({ skip_response: true }, {});

      assert.equal(deliver.mock.callCount(), 0);
    });

    it("does NOT require the SKIP_ACKNOWLEDGMENT message string in skipped mode", async () => {
      // The acknowledgment safeguard is a check against accidental skips. In "skipped" mode
      // the schema only accepts { skip_response: true } anyway, so the safeguard is moot.
      const deps = makeDeps({ allowSkip: true, submitResponseMode: "skipped" });
      const toolDef = createSubmitResponseTool(deps);
      const result = await toolDef.handler({ skip_response: true }, {});

      assert.notEqual(result.isError, true);
    });

    it("enforces the requiredTools gate before the skip", async () => {
      const deps = makeDeps({
        allowSkip: true,
        submitResponseMode: "skipped",
        requiredTools: ["mcp__trivia__post_questions"],
        recorder: {
          record: mock.fn(),
          getHistory: mock.fn(() => []),
        },
      });
      const toolDef = createSubmitResponseTool(deps);

      const result = await toolDef.handler({ skip_response: true }, {});

      assert.equal(result.isError, true);
      const text = toolResultText(result);
      assert.match(text, /mcp__trivia__post_questions/);
    });

    it("passes the requiredTools gate when the tool was called", async () => {
      const deps = makeDeps({
        allowSkip: true,
        submitResponseMode: "skipped",
        requiredTools: ["mcp__trivia__post_questions"],
        recorder: {
          record: mock.fn(),
          getHistory: mock.fn(() => [
            { tool: "mcp__trivia__post_questions", args: {}, result: {}, timestamp: 0 },
          ]),
        },
      });
      const toolDef = createSubmitResponseTool(deps);

      const result = await toolDef.handler({ skip_response: true }, {});

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, true);
    });
  });
});
