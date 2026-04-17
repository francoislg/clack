import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import type { StagedIntent, ResponseSnapshot } from "../types.js";
import { createSubmitResponseTool, type SubmitResponseDeps } from "./submitResponse.js";

// ---------------------------------------------------------------------------
// Block function mocks — injected via SubmitResponseDeps
// ---------------------------------------------------------------------------

type StructuredBlocksFn = NonNullable<SubmitResponseDeps["getStructuredResponseBlocks"]>;
type ValidateBlocksFn = NonNullable<SubmitResponseDeps["validateBlocks"]>;
type ValidateButtonLabelsFn = NonNullable<SubmitResponseDeps["validateActionButtonLabels"]>;
type ActionBlocksFn = NonNullable<SubmitResponseDeps["getResponseActionBlocks"]>;

const mockGetStructuredResponseBlocks = mock.fn<StructuredBlocksFn>();
const mockValidateBlocks = mock.fn<ValidateBlocksFn>();
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
    allowDisengage: boolean;
    allowPostTopLevel: boolean;
    sessionChannelId: string;
    topLevelDeliveryChannel: string;
    requiredTools: string[];
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
    isSkipped: mock.fn<() => boolean>(() => false),
    isDisengaged: mock.fn<() => boolean>(() => false),
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
    allowDisengage: overrides.allowDisengage,
    allowPostTopLevel: overrides.allowPostTopLevel,
    sessionChannelId: overrides.sessionChannelId,
    topLevelDeliveryChannel: overrides.topLevelDeliveryChannel,
    requiredTools: overrides.requiredTools,
    getStructuredResponseBlocks: mockGetStructuredResponseBlocks,
    validateBlocks: mockValidateBlocks,
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
}

interface CallToolArgs {
  message?: string;
  blocks?: unknown[];
  sections?: { title?: string; body: string }[];
  actions: ToolAction[];
  reactions?: string[];
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
  mockValidateActionButtonLabels.mock.resetCalls();
  mockGetResponseActionBlocks.mock.resetCalls();

  // Defaults: valid blocks, no errors
  mockGetStructuredResponseBlocks.mock.mockImplementation(() => [
    { type: "section", text: { type: "mrkdwn", text: "test" } },
  ]);
  mockValidateBlocks.mock.mockImplementation(() => []);
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

      const parsed = JSON.parse(result.content[0].text);
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
          isSkipped: () => false,
          isDisengaged: () => false,
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

      const parsed = JSON.parse(result.content[0].text);
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

      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
      assert.ok(parsed.error.includes("unknown ref"));
    });

    it("returns error for unknown ref in config_update action", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Config update" } }],
        actions: [{ type: "config_update", ref: "missing-ref" }],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = JSON.parse(result.content[0].text);
      assert.ok(parsed.error.includes("unknown ref"));
    });

    it("returns error for unknown ref in update action", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Update" } }],
        actions: [{ type: "update", ref: "nope" }],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.success, true);
    });

    it("does not validate refs for followup actions", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Follow up" } }],
        actions: [{ type: "followup", label: "More", prompt: "Tell me more" }],
      });

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.success, true);
    });

    it("does not validate refs for choice actions", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Pick one" } }],
        actions: [{ type: "choice", label: "Option A", value: "a" }],
      });

      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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

      const parsed = JSON.parse(result.content[0].text);
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

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.success, true);
    });

    it("passes when no intents are staged", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Simple answer" } }],
        actions: [],
      });

      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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
          isSkipped: () => false,
          isDisengaged: () => false,
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

      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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
          isSkipped: () => false,
          isDisengaged: () => false,
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

      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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
          isSkipped: () => false,
          isDisengaged: () => false,
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
          isSkipped: () => false,
          isDisengaged: () => false,
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

      const parsed = JSON.parse(result.content[0].text);
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
      const text = result.content[0].text;
      assert.ok(text.includes("I acknowledge that responding to this would serve no purpose"));
    });

    it("rejects skip with missing message", async () => {
      const deps = makeDeps({ allowSkip: true });
      const result = await callToolRaw(deps, {
        skip_response: true,
      });

      assert.equal(result.isError, true);
      const text = result.content[0].text;
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

      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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

      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.success, true);
      assert.equal(parsed.disengaged, true);
      assert.equal(setDisengagedFn.mock.callCount(), 1);
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
      const parsed = JSON.parse(result.content[0].text);
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
      const text = result.content[0].text;
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
      const parsed = JSON.parse(result.content[0].text);
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
      const parsed = JSON.parse(result.content[0].text);
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
      assert.ok(result.content[0].text.includes("mcp__trivia__submit_answers"));
      assert.ok(result.content[0].text.includes("have not been called"));
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
      const text = result.content[0].text;
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
      const parsed = JSON.parse(result.content[0].text);
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
      assert.ok(result.content[0].text.includes("mcp__trivia__submit_answers"));
    });
  });
});
