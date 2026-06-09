import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import type { AttentionLevel, DeliveryMode } from "../../sessions.js";
import type { StagedIntent, ResponseSnapshot } from "../types.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";
import {
  buildSubmitResponseSchema,
  createSubmitResponseTool,
  type SubmitResponseDeps,
} from "./submitResponse.js";
import { validateSingleMessage } from "./submitResponse/messageValidation.js";

// ---------------------------------------------------------------------------
// Block function mocks — injected via SubmitResponseDeps
// ---------------------------------------------------------------------------

type StructuredBlocksFn = NonNullable<SubmitResponseDeps["getStructuredResponseBlocks"]>;
type ValidateBlocksFn = NonNullable<SubmitResponseDeps["validateBlocks"]>;
type ValidateTableFn = NonNullable<SubmitResponseDeps["validateTable"]>;
type ValidateButtonLabelsFn = NonNullable<SubmitResponseDeps["validateActionButtonLabels"]>;
type ActionBlocksFn = NonNullable<SubmitResponseDeps["getResponseActionBlocks"]>;

const mockGetStructuredResponseBlocks = vi.fn<StructuredBlocksFn>();
const mockValidateBlocks = vi.fn<ValidateBlocksFn>();
const mockValidateTable = vi.fn<ValidateTableFn>();
const mockValidateActionButtonLabels = vi.fn<ValidateButtonLabelsFn>();
const mockGetResponseActionBlocks = vi.fn<ActionBlocksFn>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResponseCapture(overrides: Partial<ResponseCapture> = {}): ResponseCapture {
  return {
    set: vi.fn<ResponseCapture["set"]>(),
    get: vi.fn<ResponseCapture["get"]>(() => null),
    getRenderedBlocks: vi.fn<ResponseCapture["getRenderedBlocks"]>(() => null),
    setSkipped: vi.fn<ResponseCapture["setSkipped"]>(),
    setAttentionLevel: vi.fn<ResponseCapture["setAttentionLevel"]>(),
    setDeliveryMode: vi.fn<ResponseCapture["setDeliveryMode"]>(),
    setPostedTopLevel: vi.fn<ResponseCapture["setPostedTopLevel"]>(),
    isSkipped: vi.fn<ResponseCapture["isSkipped"]>(() => false),
    getAttentionLevel: vi.fn<ResponseCapture["getAttentionLevel"]>(() => null),
    getDeliveryMode: vi.fn<ResponseCapture["getDeliveryMode"]>(() => null),
    isPostedTopLevel: vi.fn<ResponseCapture["isPostedTopLevel"]>(() => false),
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<{
    intentStore: IntentStore;
    responseCapture: Partial<ResponseCapture>;
    recorder: ToolCallRecorder;
    sessionId: string;
    deliver: (opts: {
      blocks: object[];
      reactions?: string[];
      postTopLevel?: boolean;
      threadTs?: string;
      suppressUnfurls?: boolean;
    }) => Promise<{ ok: true; ts?: string } | { ok: false; error: string }>;
    deliverToChannel: (args: {
      channel: string;
      threadTs?: string;
      payload: unknown;
      attentionLevel?: AttentionLevel;
      followUpContext?: string;
      deliveryMode?: DeliveryMode;
    }) => Promise<{ ok: true; ts?: string } | { ok: false; error: string }>;
    recordResponseTs: (ts: string) => Promise<void>;
    persistSnapshot: (id: string, snapshot: ResponseSnapshot) => Promise<void>;
    appendStagedIntents: (
      sessionId: string,
      intents: Record<string, StagedIntent>,
    ) => Promise<void>;
    allowSkip: boolean;
    submitResponseMode: "always" | "optional" | "optional-post-to" | "skipped";
    allowAttentionLevel: boolean;
    allowPostTopLevel: boolean;
    allowMultiMessage: boolean;
    maxAdditionalMessages: number;
    sessionThreadTs: string;
    sessionChannelId: string;
    topLevelDeliveryChannel: string;
    requiredTools: string[];
    hasPendingInput: () => boolean;
    consumePendingPushedTexts: () => string[];
  }> = {},
) {
  const intentStore: IntentStore = {
    stage: vi.fn<(intent: StagedIntent) => string>(() => "ref-1"),
    resolve: vi.fn<(ref: string) => StagedIntent | undefined>(() => undefined),
    getAll: vi.fn<() => Map<string, StagedIntent>>(() => new Map()),
    ...overrides.intentStore,
  };

  const responseCapture = mockResponseCapture(overrides.responseCapture);

  const recorder: ToolCallRecorder = {
    record: vi.fn<(tool: string, args: object, result: object) => void>(),
    getHistory: vi.fn<() => []>(() => []),
    ...overrides.recorder,
  };

  return {
    intentStore,
    responseCapture,
    recorder,
    sessionId: overrides.sessionId ?? "sess-123",
    deliver: overrides.deliver,
    deliverToChannel: overrides.deliverToChannel,
    recordResponseTs: overrides.recordResponseTs,
    persistSnapshot: overrides.persistSnapshot,
    appendStagedIntents: overrides.appendStagedIntents ?? (async () => {}),
    allowSkip: overrides.allowSkip,
    submitResponseMode: overrides.submitResponseMode,
    allowAttentionLevel: overrides.allowAttentionLevel,
    allowPostTopLevel: overrides.allowPostTopLevel,
    allowMultiMessage: overrides.allowMultiMessage,
    maxAdditionalMessages: overrides.maxAdditionalMessages,
    sessionThreadTs: overrides.sessionThreadTs,
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
  additional_messages?: { blocks?: unknown[]; actions?: ToolAction[] }[];
  thread_replies?: { blocks?: unknown[]; actions?: ToolAction[] }[];
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
interface CallToolFollowerArgs {
  blocks?: unknown[];
  table?: unknown;
  actions?: ToolAction[];
  reactions?: string[];
}

interface CallToolRawArgs {
  message?: string;
  blocks?: unknown[];
  sections?: { title?: string; body: string }[];
  actions?: ToolAction[];
  reactions?: string[];
  skip_response?: boolean;
  attention_level?: AttentionLevel;
  default_delivery_mode?: DeliveryMode;
  post_top_level?: boolean;
  suppress_unfurls?: boolean;
  additional_messages?: CallToolFollowerArgs[];
  thread_replies?: CallToolFollowerArgs[];
  deliver_to?: {
    channel?: string;
    thread_ts?: string;
    attention_level?: AttentionLevel;
    follow_up_context?: string;
    default_delivery_mode?: DeliveryMode;
    response: {
      blocks?: unknown[];
      table?: unknown;
      actions?: ToolAction[];
      reactions?: string[];
      suppress_unfurls?: boolean;
      thread_replies?: CallToolFollowerArgs[];
    };
  }[];
}

async function callToolRawTopLevel(deps: ReturnType<typeof makeDeps>, args: CallToolRawArgs) {
  const toolDef = createSubmitResponseTool(deps);
  return toolDef.handler(Object.assign(Object.create(null), args), {});
}

function resetBlockMocks() {
  mockGetStructuredResponseBlocks.mockClear();
  mockValidateBlocks.mockClear();
  mockValidateTable.mockClear();
  mockValidateActionButtonLabels.mockClear();
  mockGetResponseActionBlocks.mockClear();

  // Defaults: valid blocks, no errors
  mockGetStructuredResponseBlocks.mockImplementation(() => [
    { type: "section", text: { type: "mrkdwn", text: "test" } },
  ]);
  mockValidateBlocks.mockImplementation(() => []);
  mockValidateTable.mockImplementation(() => []);
  mockValidateActionButtonLabels.mockImplementation(() => []);
  mockGetResponseActionBlocks.mockImplementation(() => []);
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

  describe("optional-post-to mode (channelless deliver_to)", () => {
    const block = { type: "section", text: { type: "mrkdwn", text: "hi" } };
    const entry = (channel: string, thread_ts?: string) => ({
      channel,
      ...(thread_ts && { thread_ts }),
      response: { blocks: [block] },
    });

    /** A deliverToChannel mock that records every call and returns a per-call ts. */
    function trackingDeliver() {
      const calls: { channel: string; threadTs?: string; payload: unknown }[] = [];
      const deliverToChannel = async (args: {
        channel: string;
        threadTs?: string;
        payload: unknown;
      }) => {
        calls.push(args);
        return { ok: true as const, ts: `ts-${calls.length}` };
      };
      return { deliverToChannel, calls };
    }

    function trackingCapture(): {
      capture: ResponseCapture;
      readonly setCalls: number;
      readonly skipCalls: number;
    } {
      const state = { setCalls: 0, skipCalls: 0 };
      const capture = mockResponseCapture({
        set: () => {
          state.setCalls++;
        },
        setSkipped: () => {
          state.skipCalls++;
        },
      });
      return {
        capture,
        get setCalls() {
          return state.setCalls;
        },
        get skipCalls() {
          return state.skipCalls;
        },
      };
    }

    it("delivers a single deliver_to entry and records responseTs from the first post", async () => {
      const { deliverToChannel, calls } = trackingDeliver();
      const recorded: string[] = [];
      const tracker = trackingCapture();
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel,
        recordResponseTs: async (ts) => {
          recorded.push(ts);
        },
        responseCapture: tracker.capture,
      });

      const parsed = parseToolResult(
        await callToolRawTopLevel(deps, { deliver_to: [entry("C456")] }),
      );
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, undefined);
      assert.equal(parsed.delivered, true);
      assert.equal(parsed.messagesDelivered, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].channel, "C456");
      assert.equal(calls[0].threadTs, undefined, "no thread_ts → top-level post");
      assert.deepEqual(recorded, ["ts-1"], "responseTs is the first entry's ts");
      assert.equal(tracker.setCalls, 1);
      assert.equal(tracker.skipCalls, 0);
    });

    it("forwards attention_level and follow_up_context to the delivery adapter", async () => {
      const seen: {
        attentionLevel?: AttentionLevel;
        followUpContext?: string;
        threadTs?: string;
      }[] = [];
      const deliverToChannel = async (args: {
        channel: string;
        threadTs?: string;
        payload: unknown;
        attentionLevel?: AttentionLevel;
        followUpContext?: string;
      }) => {
        seen.push({
          attentionLevel: args.attentionLevel,
          followUpContext: args.followUpContext,
          threadTs: args.threadTs,
        });
        return { ok: true as const, ts: `ts-${seen.length}` };
      };
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel,
        recordResponseTs: async () => {},
      });

      const parsed = parseToolResult(
        await callToolRawTopLevel(deps, {
          deliver_to: [
            {
              channel: "C1",
              thread_ts: "1700000000.000100",
              attention_level: "high",
              follow_up_context: "ctx",
              response: { blocks: [block] },
            },
          ],
        }),
      );
      assert.equal(parsed.delivered, true);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].attentionLevel, "high");
      assert.equal(seen[0].followUpContext, "ctx");
      assert.equal(seen[0].threadTs, "1700000000.000100");
    });

    it("forwards default_delivery_mode to the delivery adapter", async () => {
      const seen: { deliveryMode?: DeliveryMode }[] = [];
      const deliverToChannel = async (args: {
        channel: string;
        threadTs?: string;
        payload: unknown;
        attentionLevel?: AttentionLevel;
        followUpContext?: string;
        deliveryMode?: DeliveryMode;
      }) => {
        seen.push({ deliveryMode: args.deliveryMode });
        return { ok: true as const, ts: `ts-${seen.length}` };
      };
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel,
        recordResponseTs: async () => {},
      });

      parseToolResult(
        await callToolRawTopLevel(deps, {
          deliver_to: [
            {
              channel: "C1",
              thread_ts: "1700000000.000100",
              attention_level: "high",
              default_delivery_mode: "invisible",
              response: { blocks: [block] },
            },
          ],
        }),
      );
      assert.equal(seen.length, 1);
      assert.equal(seen[0].deliveryMode, "invisible");
    });

    it("omits engagement fields when the entry has no attention_level", async () => {
      const seen: { attentionLevel?: AttentionLevel; followUpContext?: string }[] = [];
      const deliverToChannel = async (args: {
        channel: string;
        threadTs?: string;
        payload: unknown;
        attentionLevel?: AttentionLevel;
        followUpContext?: string;
      }) => {
        seen.push({ attentionLevel: args.attentionLevel, followUpContext: args.followUpContext });
        return { ok: true as const, ts: `ts-${seen.length}` };
      };
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel,
        recordResponseTs: async () => {},
      });

      parseToolResult(await callToolRawTopLevel(deps, { deliver_to: [entry("C1")] }));
      assert.equal(seen.length, 1);
      assert.equal(seen[0].attentionLevel, undefined);
      assert.equal(seen[0].followUpContext, undefined);
    });

    it("delivers multiple entries (different and same channels) in order", async () => {
      const { deliverToChannel, calls } = trackingDeliver();
      const recorded: string[] = [];
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel,
        recordResponseTs: async (ts) => {
          recorded.push(ts);
        },
      });

      const parsed = parseToolResult(
        await callToolRawTopLevel(deps, {
          deliver_to: [entry("C1"), entry("C2"), entry("C1")],
        }),
      );
      assert.equal(parsed.success, true);
      assert.equal(parsed.messagesDelivered, 3);
      assert.deepEqual(
        calls.map((c) => c.channel),
        ["C1", "C2", "C1"],
      );
      assert.deepEqual(recorded, ["ts-1"], "responseTs is the FIRST entry's ts only");
    });

    it("delivers an entry that carries thread_ts as a threaded reply", async () => {
      const { deliverToChannel, calls } = trackingDeliver();
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel,
        recordResponseTs: async () => {},
      });

      const parsed = parseToolResult(
        await callToolRawTopLevel(deps, { deliver_to: [entry("C1", "1700000000.000100")] }),
      );
      assert.equal(parsed.success, true);
      assert.equal(calls[0].threadTs, "1700000000.000100");
    });

    it("delivers entries with no auto flag anywhere (deliver_to is not an action)", async () => {
      const { deliverToChannel } = trackingDeliver();
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel,
        recordResponseTs: async () => {},
      });
      // The entry shape has no `auto` field at all — delivery happens immediately.
      const parsed = parseToolResult(
        await callToolRawTopLevel(deps, { deliver_to: [entry("C1")] }),
      );
      assert.equal(parsed.success, true);
      assert.equal(parsed.delivered, true);
    });

    it("delivers when deliver_to AND skip_response are both present (deliver_to wins)", async () => {
      const { deliverToChannel, calls } = trackingDeliver();
      const tracker = trackingCapture();
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel,
        recordResponseTs: async () => {},
        responseCapture: tracker.capture,
      });

      const parsed = parseToolResult(
        await callToolRawTopLevel(deps, { skip_response: true, deliver_to: [entry("C1")] }),
      );
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, undefined, "must NOT be treated as a skip");
      assert.equal(calls.length, 1, "the entry is still delivered");
      assert.equal(tracker.skipCalls, 0, "setSkipped must not be called");
    });

    it("records a skip on bare skip_response: true (no deliver_to)", async () => {
      const tracker = trackingCapture();
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        responseCapture: tracker.capture,
      });
      const parsed = parseToolResult(await callToolRawTopLevel(deps, { skip_response: true }));
      assert.equal(parsed.skipped, true);
      assert.equal(tracker.skipCalls, 1);
    });

    it("returns a hard error when NEITHER deliver_to nor skip_response is provided", async () => {
      const tracker = trackingCapture();
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        responseCapture: tracker.capture,
      });
      const result = await callToolRawTopLevel(deps, {});
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, undefined);
      assert.ok(parsed.error.includes("deliver_to"));
      assert.equal(tracker.skipCalls, 0, "an empty call is NOT a silent skip");
    });

    it("returns a hard error on an empty deliver_to array with no skip", async () => {
      const tracker = trackingCapture();
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        responseCapture: tracker.capture,
      });
      const parsed = parseToolResult(await callToolRawTopLevel(deps, { deliver_to: [] }));
      assert.equal(parsed.success, undefined);
      assert.ok(parsed.error.includes("deliver_to"));
      assert.equal(tracker.skipCalls, 0);
    });

    it("rejects (and does not deliver) a post_to action inside a deliver_to entry's actions", async () => {
      // Confirms validateDeliverToEntries is actually wired into the handler: a post_to nested
      // in an entry's response.actions blocks the whole delivery.
      const { deliverToChannel, calls } = trackingDeliver();
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel,
        recordResponseTs: async () => {},
      });
      const postTo = { type: "post_to", channel: "C2", blocks: [block] };
      const parsed = parseToolResult(
        await callToolRawTopLevel(deps, {
          deliver_to: [{ channel: "C1", response: { blocks: [block], actions: [postTo] } }],
        }),
      );
      assert.equal(parsed.success, undefined);
      assert.ok(String(parsed.error).includes("post_to is not allowed"));
      assert.equal(calls.length, 0, "nothing is delivered when validation fails");
    });

    it("records the run as an error when a Slack post fails", async () => {
      const deps = makeDeps({
        submitResponseMode: "optional-post-to",
        deliverToChannel: async () => ({ ok: false as const, error: "channel_not_found" }),
        recordResponseTs: async () => {},
      });
      const parsed = parseToolResult(
        await callToolRawTopLevel(deps, { deliver_to: [entry("C1")] }),
      );
      assert.equal(parsed.success, undefined);
      assert.equal(parsed.error, "delivery_failed");
      assert.ok(String(parsed.details).includes("channel_not_found"));
    });
  });

  describe("optional-post-to schema shape", () => {
    const block = { type: "section", text: { type: "mrkdwn", text: "hi" } };
    const shape = buildSubmitResponseSchema({ submitResponseMode: "optional-post-to" });

    it("exposes exactly skip_response and deliver_to — no primary fields or top-level actions", () => {
      assert.deepEqual(Object.keys(shape).sort(), ["deliver_to", "skip_response"]);
      for (const forbidden of [
        "blocks",
        "actions",
        "table",
        "reactions",
        "message",
        "post_top_level",
        "attention_level",
        "additional_messages",
        "thread_replies",
      ]) {
        assert.ok(!(forbidden in shape), `optional-post-to schema must not offer ${forbidden}`);
      }
    });

    it("rejects a deliver_to entry that omits the required channel", () => {
      const schema = z.object(shape);
      const result = schema.safeParse({ deliver_to: [{ response: { blocks: [block] } }] });
      assert.equal(result.success, false);
    });

    it("rejects a deliver_to entry with empty response.blocks", () => {
      const schema = z.object(shape);
      const result = schema.safeParse({
        deliver_to: [{ channel: "C1", response: { blocks: [] } }],
      });
      assert.equal(result.success, false);
    });

    it("accepts a well-formed deliver_to entry", () => {
      const schema = z.object(shape);
      const result = schema.safeParse({
        deliver_to: [{ channel: "C1", thread_ts: "1.2", response: { blocks: [block] } }],
      });
      assert.equal(result.success, true);
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
      // Under the §7 collect-all aggregator: a single length error surfaces directly
      // in `parsed.error`. Multi-error batches use `error: "invalid_batch"` + `details[]`.
      assert.match(parsed.error, /response_too_long/);
      assert.match(parsed.error, /10000/);
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
      assert.match(parsed.error, /response_too_long/);
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
      assert.match(resultData.error, /response_too_long/);
    });
  });

  describe("block validation errors", () => {
    it("returns error when validateSlackBlocks reports violations", async () => {
      mockValidateBlocks.mockImplementation(() => [
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
      // §7 aggregator: a single block error surfaces directly in `parsed.error` as a
      // path-prefixed string. The block validator's field name is preserved.
      assert.match(parsed.error, /section\[0\]\.text/);
      assert.match(parsed.error, /text too long/);
    });

    it("does not deliver or capture when blocks are invalid", async () => {
      mockValidateBlocks.mockImplementation(() => [
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
      mockGetResponseActionBlocks.mockImplementation(() => [{ type: "actions", elements: [] }]);

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
      mockGetResponseActionBlocks.mockImplementation(() => []);

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
      // §8 prefixes the failing message's path so multi-message batches can identify
      // which message failed. Primary failures carry the `primary:` prefix.
      assert.match(parsed.details, /channel_not_found/);
      assert.match(parsed.details, /^primary:/);
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
      assert.match(resultData.details, /^primary:.*timeout/);
    });

    it("still captures response when no deliver function is provided", async () => {
      const setCalls: unknown[][] = [];
      const deps = makeDeps({
        responseCapture: {
          set: ((...args: unknown[]) => {
            setCalls.push(args);
          }) as ResponseCapture["set"],
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

  describe("staged intent write-through", () => {
    it("persists referenced intents to the session BEFORE calling deliver", async () => {
      // Resolves a "change" intent that the button action will reference.
      const intent: StagedIntent = {
        type: "change",
        branch: "feat/x",
        description: "do x",
        repo: "r",
      };
      const order: string[] = [];

      const deps = makeDeps({
        intentStore: {
          stage: () => "ref-X",
          resolve: (ref: string) => (ref === "ref-X" ? intent : undefined),
          getAll: () => new Map([["ref-X", intent]]),
        },
        appendStagedIntents: async (sessionId, intents) => {
          order.push(`persist:${sessionId}:${Object.keys(intents).join(",")}`);
        },
        deliver: async () => {
          order.push("deliver");
          return { ok: true as const };
        },
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Apply?" } }],
        actions: [{ type: "change", ref: "ref-X" }],
      });

      assert.deepEqual(order, ["persist:sess-123:ref-X", "deliver"]);
    });

    it("skips the persist call when no ref-bearing actions are present", async () => {
      let persistCalls = 0;
      const deps = makeDeps({
        appendStagedIntents: async () => {
          persistCalls++;
        },
        deliver: async () => ({ ok: true as const }),
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hi" } }],
        actions: [{ type: "followup", label: "More", prompt: "more" }],
      });

      assert.equal(persistCalls, 0);
    });

    it("persists nested intents from post_to.actions too", async () => {
      const intent: StagedIntent = {
        type: "config_update",
        operation: "write",
        file: "user/identity.md",
        content: "x",
      };
      const persisted: Record<string, StagedIntent>[] = [];

      const deps = makeDeps({
        intentStore: {
          stage: () => "ref-Y",
          resolve: (ref: string) => (ref === "ref-Y" ? intent : undefined),
          getAll: () => new Map([["ref-Y", intent]]),
        },
        appendStagedIntents: async (_sessionId, intents) => {
          persisted.push(intents);
        },
        deliver: async () => ({ ok: true as const }),
      });

      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Cross-post" } }],
        actions: [
          {
            type: "post_to",
            channel: "C001",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "Mirror" } }],
            actions: [{ type: "config_update", ref: "ref-Y" }],
          },
        ],
      });

      assert.equal(persisted.length, 1);
      assert.ok(persisted[0]["ref-Y"]);
      assert.equal(persisted[0]["ref-Y"].type, "config_update");
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
        (
          deps.responseCapture.setSkipped as unknown as ReturnType<
            typeof vi.fn<(...args: any[]) => any>
          >
        ).mock.calls.length,
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
      const deliver = vi.fn(async () => ({ ok: true as const }));
      const deps = makeDeps({ deliver, allowSkip: true });
      await callToolRaw(deps, {
        skip_response: true,
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      assert.equal(deliver.mock.calls.length, 0);
    });

    it("accepts skip with attention_level: off and returns disengaged flag", async () => {
      const deps = makeDeps({ allowSkip: true });
      const result = await callToolRaw(deps, {
        skip_response: true,
        attention_level: "off",
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, true);
      assert.equal(parsed.attentionLevel, "off");
      assert.equal(parsed.disengaged, true);
    });

    it("accepts attention_level: off without skip_response (normal response + disengage)", async () => {
      const setAttentionLevelFn = vi.fn<(level: AttentionLevel) => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setAttentionLevel: setAttentionLevelFn,
        },
      });
      const result = await callToolRaw(deps, {
        attention_level: "off",
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
      assert.equal(setAttentionLevelFn.mock.calls.length, 1);
      assert.equal(setAttentionLevelFn.mock.calls[0][0], "off");
    });

    it("persists a non-off attention_level on a normal response (raise the level)", async () => {
      const setAttentionLevelFn = vi.fn<(level: AttentionLevel) => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setAttentionLevel: setAttentionLevelFn,
        },
      });
      const result = await callToolRaw(deps, {
        attention_level: "high",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "On it." } }],
        actions: [],
      });

      assert.notEqual(result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.attentionLevel, "high");
      assert.equal(parsed.disengaged, undefined);
      assert.equal(setAttentionLevelFn.mock.calls.length, 1);
      assert.equal(setAttentionLevelFn.mock.calls[0][0], "high");
    });

    it("persists default_delivery_mode on a normal response (switch the thread mode)", async () => {
      const setDeliveryModeFn = vi.fn<(mode: DeliveryMode) => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setDeliveryMode: setDeliveryModeFn,
        },
      });
      const result = await callToolRaw(deps, {
        default_delivery_mode: "invisible",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hey." } }],
        actions: [],
      });

      assert.notEqual(result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.deliveryMode, "invisible");
      assert.equal(setDeliveryModeFn.mock.calls.length, 1);
      assert.equal(setDeliveryModeFn.mock.calls[0][0], "invisible");
    });

    it("calls both setSkipped and setAttentionLevel on skip + attention_level: off", async () => {
      const setSkippedFn = vi.fn<() => void>();
      const setAttentionLevelFn = vi.fn<(level: AttentionLevel) => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setSkipped: setSkippedFn,
          setAttentionLevel: setAttentionLevelFn,
        },
      });
      await callToolRaw(deps, {
        skip_response: true,
        attention_level: "off",
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      assert.equal(setSkippedFn.mock.calls.length, 1);
      assert.equal(setAttentionLevelFn.mock.calls.length, 1);
    });

    it("calls only setSkipped on skip without attention_level", async () => {
      const setSkippedFn = vi.fn<() => void>();
      const setAttentionLevelFn = vi.fn<(level: AttentionLevel) => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setSkipped: setSkippedFn,
          setAttentionLevel: setAttentionLevelFn,
        },
      });
      await callToolRaw(deps, {
        skip_response: true,
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      assert.equal(setSkippedFn.mock.calls.length, 1);
      assert.equal(setAttentionLevelFn.mock.calls.length, 0);
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

    it("delivery_failed on normal+disengage path does not persist the attention level", async () => {
      const setAttentionLevelFn = vi.fn<(level: AttentionLevel) => void>();
      const failingDeliver = vi.fn(async () => ({
        ok: false as const,
        error: "network down",
      }));
      const deps = makeDeps({
        allowSkip: true,
        deliver: failingDeliver,
        responseCapture: {
          ...makeDeps().responseCapture,
          setAttentionLevel: setAttentionLevelFn,
        },
      });
      const result = await callToolRaw(deps, {
        attention_level: "off",
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
      assert.equal(setAttentionLevelFn.mock.calls.length, 0);
    });

    it("normal+attention_level: off succeeds when capture is already off", async () => {
      const setAttentionLevelFn = vi.fn<(level: AttentionLevel) => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setAttentionLevel: setAttentionLevelFn,
          getAttentionLevel: () => "off",
        },
      });
      const result = await callToolRaw(deps, {
        attention_level: "off",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Got it" } }],
        actions: [],
      });

      assert.notEqual(result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.disengaged, true);
    });

    it("allowAttentionLevel without allowSkip exposes attention_level on normal response", async () => {
      const setAttentionLevelFn = vi.fn<(level: AttentionLevel) => void>();
      const deps = makeDeps({
        allowAttentionLevel: true,
        responseCapture: {
          ...makeDeps().responseCapture,
          setAttentionLevel: setAttentionLevelFn,
        },
      });
      const result = await callToolRaw(deps, {
        attention_level: "off",
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
      assert.equal(setAttentionLevelFn.mock.calls.length, 1);
    });

    it("allowSkip without allowAttentionLevel omits attention_level from the schema (scheduled-with-skipConditions case)", () => {
      const deps = makeDeps({ allowSkip: true, allowAttentionLevel: false });
      const toolDef = createSubmitResponseTool(deps);
      const shapeKeys = Object.keys(toolDef.inputSchema);

      assert.ok(shapeKeys.includes("skip_response"), "skip_response should be exposed");
      assert.equal(
        shapeKeys.includes("attention_level"),
        false,
        "attention_level must NOT be exposed when allowAttentionLevel is false",
      );
    });

    it("allowSkip with allowAttentionLevel keeps both skip_response and attention_level in the schema", () => {
      const deps = makeDeps({ allowSkip: true, allowAttentionLevel: true });
      const toolDef = createSubmitResponseTool(deps);
      const shapeKeys = Object.keys(toolDef.inputSchema);

      assert.ok(shapeKeys.includes("skip_response"));
      assert.ok(shapeKeys.includes("attention_level"));
    });

    it("skip-only schema accepts a skip response without an attention_level field", async () => {
      const deps = makeDeps({ allowSkip: true, allowAttentionLevel: false });
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

    it("allowAttentionLevel without allowSkip still blocks disengage on delivery failure", async () => {
      const setAttentionLevelFn = vi.fn<(level: AttentionLevel) => void>();
      const failingDeliver = vi.fn(async () => ({
        ok: false as const,
        error: "network down",
      }));
      const deps = makeDeps({
        allowAttentionLevel: true,
        deliver: failingDeliver,
        responseCapture: {
          ...makeDeps().responseCapture,
          setAttentionLevel: setAttentionLevelFn,
        },
      });
      const result = await callToolRaw(deps, {
        attention_level: "off",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "done" } }],
        actions: [],
      });

      assert.equal(result.isError, true);
      assert.equal(setAttentionLevelFn.mock.calls.length, 0);
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

  describe("suppress_unfurls", () => {
    it("passes suppressUnfurls: true to deliver when the field is set", async () => {
      const deliverCalls: { suppressUnfurls?: boolean }[] = [];
      const deliver = async (opts: {
        blocks: object[];
        suppressUnfurls?: boolean;
      }): Promise<{ ok: true; ts?: string } | { ok: false; error: string }> => {
        deliverCalls.push({ suppressUnfurls: opts.suppressUnfurls });
        return { ok: true, ts: "1.0" };
      };
      const deps = makeDeps({ deliver });
      await callToolRawTopLevel(deps, {
        suppress_unfurls: true,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Quiet please" } }],
        actions: [],
      });

      assert.equal(deliverCalls.length, 1);
      assert.equal(deliverCalls[0].suppressUnfurls, true);
    });

    it("omits suppressUnfurls on deliver when the field is not set", async () => {
      const deliverCalls: { suppressUnfurls?: boolean }[] = [];
      const deliver = async (opts: {
        blocks: object[];
        suppressUnfurls?: boolean;
      }): Promise<{ ok: true; ts?: string } | { ok: false; error: string }> => {
        deliverCalls.push({ suppressUnfurls: opts.suppressUnfurls });
        return { ok: true, ts: "1.0" };
      };
      const deps = makeDeps({ deliver });
      await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Normal" } }],
        actions: [],
      });

      assert.equal(deliverCalls.length, 1);
      assert.equal(deliverCalls[0].suppressUnfurls, undefined);
    });

    it("omits suppressUnfurls on deliver when the field is explicitly false", async () => {
      const deliverCalls: { suppressUnfurls?: boolean }[] = [];
      const deliver = async (opts: {
        blocks: object[];
        suppressUnfurls?: boolean;
      }): Promise<{ ok: true; ts?: string } | { ok: false; error: string }> => {
        deliverCalls.push({ suppressUnfurls: opts.suppressUnfurls });
        return { ok: true, ts: "1.0" };
      };
      const deps = makeDeps({ deliver });
      await callToolRawTopLevel(deps, {
        suppress_unfurls: false,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Normal" } }],
        actions: [],
      });

      assert.equal(deliverCalls.length, 1);
      assert.equal(deliverCalls[0].suppressUnfurls, undefined);
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
          record: vi.fn<ToolCallRecorder["record"]>(),
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
        vi.fn<
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
      assert.equal(deliverFn.mock.calls.length, 0);
    });

    it("partially missing — lists only missing names", async () => {
      const deps = makeDeps({
        requiredTools: ["mcp__trivia__submit_answers", "mcp__trivia__save_question"],
        recorder: {
          record: vi.fn<ToolCallRecorder["record"]>(),
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
          record: vi.fn<ToolCallRecorder["record"]>(),
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
      mockGetResponseActionBlocks.mockImplementation((actions) =>
        actions.length > 0 ? [{ type: "actions", elements: [] }] : [],
      );
      let callCount = 0;
      mockValidateActionButtonLabels.mockImplementation(() => {
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
      assert.equal(mockValidateTable.mock.calls.length, 1);
      const [tableArg, pathArg] = mockValidateTable.mock.calls[0];
      assert.equal((tableArg as { type: string }).type, "table");
      assert.equal(pathArg, "table");
    });

    it("rejects an invalid top-level table with field-prefixed errors", async () => {
      mockValidateTable.mockImplementation(() => [
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
      // §7 aggregator: single error surfaces directly in `parsed.error`.
      assert.match(parsed.error, /^table\.rows:/);
    });

    it("validates table inside a post_to action with a path-prefixed namespace", async () => {
      // The post_to.table validation runs after blocks validation; emit an
      // error specifically when the caller passes the post_to path prefix.
      mockValidateTable.mockImplementation((_block, prefix) => {
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
      assert.match(parsed.error, /^actions\[0\]\.table\.rows:/);
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
      assert.equal(mockValidateTable.mock.calls.length, 0);
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
      const deliver = vi.fn(async () => ({ ok: true as const }));
      const deps = makeDeps({ deliver, allowSkip: true, submitResponseMode: "skipped" });
      const toolDef = createSubmitResponseTool(deps);
      await toolDef.handler({ skip_response: true }, {});

      assert.equal(deliver.mock.calls.length, 0);
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
          record: vi.fn(),
          getHistory: vi.fn(() => []),
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
          record: vi.fn(),
          getHistory: vi.fn(() => [
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

  // ---------------------------------------------------------------------------
  // §3.5 — multi-message schema gating (additional_messages / thread_replies)
  // ---------------------------------------------------------------------------

  describe("multi-message schema gating", () => {
    function inputSchemaOf(deps: ReturnType<typeof makeDeps>) {
      return z.object(createSubmitResponseTool(deps).inputSchema);
    }

    it("hides additional_messages and thread_replies when allowMultiMessage is unset (DM/mention/etc.)", () => {
      const dmDeps = makeDeps(); // allowMultiMessage NOT set
      const dmShape = Object.keys(createSubmitResponseTool(dmDeps).inputSchema);
      assert.equal(dmShape.includes("additional_messages"), false);
      assert.equal(dmShape.includes("thread_replies"), false);
    });

    it("exposes additional_messages and thread_replies when allowMultiMessage: true (scheduled)", () => {
      const cronDeps = makeDeps({ allowMultiMessage: true });
      const cronShape = Object.keys(createSubmitResponseTool(cronDeps).inputSchema);
      assert.equal(cronShape.includes("additional_messages"), true);
      assert.equal(cronShape.includes("thread_replies"), true);
    });

    it("accepts up to configured cap on additional_messages and rejects above", () => {
      const deps = makeDeps({ allowMultiMessage: true, maxAdditionalMessages: 3 });
      const schema = inputSchemaOf(deps);
      const msg = {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow" } }],
      };
      const withinCap = schema.safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        additional_messages: [msg, msg, msg],
      });
      assert.equal(withinCap.success, true);

      const overCap = schema.safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        additional_messages: [msg, msg, msg, msg],
      });
      assert.equal(overCap.success, false);
    });

    it("caps thread_replies at 20 regardless of config", () => {
      const deps = makeDeps({ allowMultiMessage: true, maxAdditionalMessages: 3 });
      const schema = inputSchemaOf(deps);
      const msg = {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "reply" } }],
      };
      const at20 = schema.safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        thread_replies: Array.from({ length: 20 }, () => msg),
      });
      assert.equal(at20.success, true);

      const over20 = schema.safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        thread_replies: Array.from({ length: 21 }, () => msg),
      });
      assert.equal(over20.success, false);
    });

    it("rejects primary-only fields inside a follow-up message payload", () => {
      const deps = makeDeps({ allowMultiMessage: true });
      const schema = inputSchemaOf(deps);
      const followWithMessage = schema.safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        additional_messages: [
          {
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow" } }],
            message: "this is primary-only",
          },
        ],
      });
      assert.equal(followWithMessage.success, false);

      const followWithDisengage = schema.safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        additional_messages: [
          {
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow" } }],
            disengage: true,
          },
        ],
      });
      assert.equal(followWithDisengage.success, false);

      const followWithPostTopLevel = schema.safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        thread_replies: [
          {
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "reply" } }],
            post_top_level: true,
          },
        ],
      });
      assert.equal(followWithPostTopLevel.success, false);
    });

    it("post_to accepts additional_messages and thread_replies in any context", () => {
      const deps = makeDeps();
      const schema = inputSchemaOf(deps);
      const result = schema.safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "cross-post" } }],
            additional_messages: [
              { blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow" } }] },
            ],
            thread_replies: [
              { blocks: [{ type: "section", text: { type: "mrkdwn", text: "reply" } }] },
            ],
          },
        ],
      });
      assert.equal(result.success, true);
    });

    // -------- §8 — sequential delivery (primary + followers) --------

    it("delivers primary + additional_messages as separate top-level channel messages", async () => {
      const deliveries: Array<{
        threadTs?: string;
        postTopLevel?: boolean;
      }> = [];
      const deps = makeDeps({
        allowMultiMessage: true,
        sessionThreadTs: "9999.1111", // present, but additional_messages should ignore it
        deliver: async ({
          threadTs,
          postTopLevel,
        }: {
          threadTs?: string;
          postTopLevel?: boolean;
        }) => {
          deliveries.push({
            ...(threadTs && { threadTs }),
            ...(postTopLevel && { postTopLevel: true }),
          });
          return { ok: true as const, ts: `${1000 + deliveries.length}.0` };
        },
      });
      const result = await callToolRawTopLevel(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        additional_messages: [
          { blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow 1" } }] },
          { blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow 2" } }] },
        ],
      });
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.messagesDelivered, 3);
      // Primary delivered without postTopLevel (default thread/streamer path).
      assert.equal(deliveries[0].postTopLevel, undefined);
      assert.equal(deliveries[0].threadTs, undefined);
      // Followers: each as a separate TOP-LEVEL channel message (no threadTs).
      assert.equal(deliveries[1].postTopLevel, true);
      assert.equal(deliveries[1].threadTs, undefined);
      assert.equal(deliveries[2].postTopLevel, true);
      assert.equal(deliveries[2].threadTs, undefined);
    });

    it("delivers primary top-level + thread_replies under primary.ts", async () => {
      const deliveries: Array<{ threadTs?: string; postTopLevel?: boolean }> = [];
      const deps = makeDeps({
        allowMultiMessage: true,
        allowPostTopLevel: true,
        deliver: async ({
          threadTs,
          postTopLevel,
        }: {
          threadTs?: string;
          postTopLevel?: boolean;
        }) => {
          deliveries.push({
            ...(threadTs && { threadTs }),
            ...(postTopLevel && { postTopLevel: true }),
          });
          // Primary lands top-level and returns its ts; replies thread under it.
          if (deliveries.length === 1) return { ok: true as const, ts: "5555.2222" };
          return { ok: true as const };
        },
      });
      const result = await callToolRawTopLevel(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        post_top_level: true,
        thread_replies: [
          { blocks: [{ type: "section", text: { type: "mrkdwn", text: "reply 1" } }] },
          { blocks: [{ type: "section", text: { type: "mrkdwn", text: "reply 2" } }] },
        ],
      });
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.messagesDelivered, 3);
      assert.equal(deliveries[0].postTopLevel, true);
      assert.equal(deliveries[0].threadTs, undefined);
      assert.equal(deliveries[1].threadTs, "5555.2222");
      assert.equal(deliveries[2].threadTs, "5555.2222");
    });

    it("threads thread_replies under primary.ts even without post_top_level (scheduled reveal)", async () => {
      // Regression: in a scheduled cron the session's threadTs is a synthetic Date.now()
      // sentinel. Replies must anchor under the just-posted primary, not that fake ts —
      // otherwise Slack posts them as standalone top-level messages.
      const deliveries: Array<{ threadTs?: string; postTopLevel?: boolean }> = [];
      const deps = makeDeps({
        allowMultiMessage: true,
        sessionThreadTs: "9999.1111", // synthetic cron sentinel — must NOT be used as thread_ts
        deliver: async ({
          threadTs,
          postTopLevel,
        }: {
          threadTs?: string;
          postTopLevel?: boolean;
        }) => {
          deliveries.push({
            ...(threadTs && { threadTs }),
            ...(postTopLevel && { postTopLevel: true }),
          });
          if (deliveries.length === 1) return { ok: true as const, ts: "5555.2222" };
          return { ok: true as const };
        },
      });
      const result = await callToolRawTopLevel(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        thread_replies: [
          { blocks: [{ type: "section", text: { type: "mrkdwn", text: "narrative" } }] },
        ],
      });
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.messagesDelivered, 2);
      assert.equal(deliveries[1].threadTs, "5555.2222");
      assert.notEqual(deliveries[1].threadTs, "9999.1111");
    });

    it("mid-batch delivery failure stops and reports the failing index", async () => {
      let callCount = 0;
      const deps = makeDeps({
        allowMultiMessage: true,
        deliver: async ({ postTopLevel }: { postTopLevel?: boolean }) => {
          callCount++;
          // Call 1 = primary (no postTopLevel) → success
          // Call 2 = additional_messages[0] (postTopLevel=true) → success
          // Call 3 = additional_messages[1] (postTopLevel=true) → fail
          if (callCount === 1 && !postTopLevel) return { ok: true as const, ts: "1.0" };
          if (callCount === 2 && postTopLevel) return { ok: true as const, ts: "2.0" };
          if (callCount === 3 && postTopLevel) {
            return { ok: false as const, error: "channel_archived" };
          }
          return { ok: false as const, error: "unexpected delivery call shape" };
        },
      });
      const result = await callToolRawTopLevel(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        additional_messages: [
          { blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow 1" } }] },
          { blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow 2" } }] },
          { blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow 3" } }] },
        ],
      });
      const parsed = parseToolResult(result);
      assert.equal(parsed.error, "delivery_failed");
      assert.match(parsed.details, /additional_messages\[1\]/);
      assert.match(parsed.details, /channel_archived/);
      assert.equal(parsed.messagesDelivered, 2); // primary + follow 1
    });

    // -------- §7 — collect-all aggregator: multi-error batch returns invalid_batch --------

    it("multi-error batch returns invalid_batch with details[]", async () => {
      // Trigger two distinct errors at once: an unknown ref AND a missing intent coverage.
      const intentStore: IntentStore = {
        stage: vi.fn<(intent: StagedIntent) => string>(() => "staged-1"),
        resolve: vi.fn<(ref: string) => StagedIntent | undefined>(() => undefined),
        getAll: vi.fn<() => Map<string, StagedIntent>>(
          () =>
            new Map([
              ["uncovered-ref", { type: "change", branch: "feat/x", description: "", repo: "r" }],
            ]),
        ),
      };
      const deps = makeDeps({ intentStore });
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [{ type: "change", ref: "unknown-ref" }],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.equal(parsed.error, "invalid_batch");
      assert.ok(Array.isArray(parsed.details));
      assert.ok(parsed.details.length >= 2);
      assert.ok(parsed.details.some((d: string) => /unknown ref/.test(d)));
      assert.ok(parsed.details.some((d: string) => /didn't include/.test(d)));
    });

    // -------- §6 — per-message validateSingleMessage helper --------

    it("validateSingleMessage: each message gets its own 10000-char length budget", () => {
      const longSection = {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: "x".repeat(2500) },
      };
      // Single message ~2500 chars — under budget.
      const errors = validateSingleMessage({
        blocks: [longSection],
        pathPrefix: "additional_messages[0]",
        validateBlocks: () => [],
        validateTable: () => [],
      });
      assert.deepEqual(errors, []);
    });

    it("validateSingleMessage: rejects when single message exceeds budget", () => {
      const longSection = {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: "x".repeat(10001) },
      };
      const errors = validateSingleMessage({
        blocks: [longSection],
        pathPrefix: "thread_replies[2]",
        validateBlocks: () => [],
        validateTable: () => [],
      });
      assert.equal(errors.length, 1);
      assert.match(errors[0], /thread_replies\[2\]/);
      assert.match(errors[0], /response_too_long/);
    });

    it("validateSingleMessage: block errors are path-prefixed", () => {
      const errors = validateSingleMessage({
        blocks: [
          {
            type: "header" as const,
            text: { type: "plain_text" as const, text: "h" },
          },
        ],
        pathPrefix: "additional_messages[0]",
        validateBlocks: () => [
          {
            field: "blocks[0].text.text",
            message: "too long",
            currentLength: 200,
            limit: 150,
          },
        ],
        validateTable: () => [],
      });
      assert.equal(errors.length, 1);
      assert.match(errors[0], /^additional_messages\[0\]\.blocks\[0\]\.text\.text:/);
    });

    // -------- §5 — batch walker integration via the handler --------

    it("ref inside thread_replies[0].actions is detected by validateRefActions", async () => {
      const deps = makeDeps();
      const result = await callToolRawTopLevel(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        post_top_level: true,
        thread_replies: [
          {
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "reply" } }],
            actions: [{ type: "change", ref: "missing-ref" }],
          },
        ],
      });
      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.ok(
        parsed.error.includes("thread_replies[0].actions[0]"),
        `expected path-prefixed error, got: ${parsed.error}`,
      );
      assert.ok(parsed.error.includes("missing-ref"));
    });

    it("post_to inside additional_messages[0].actions is allowed at top batch level", async () => {
      const deps = makeDeps();
      const result = await callToolRawTopLevel(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        additional_messages: [
          {
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow" } }],
            actions: [
              {
                type: "post_to",
                blocks: [{ type: "section", text: { type: "mrkdwn", text: "cross-post" } }],
              },
            ],
          },
        ],
      });
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true);
    });

    it("nested post_to inside post_to's additional_messages follower is rejected", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "cross-post" } }],
            thread_ts: "1234.5678", // required for additional_messages
            additional_messages: [
              {
                blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow" } }],
                actions: [
                  {
                    type: "post_to",
                    blocks: [{ type: "section", text: { type: "mrkdwn", text: "evil-nested" } }],
                  },
                ],
              },
            ],
          },
        ],
      });
      assert.equal("isError" in result && result.isError, true);
      const parsed = parseToolResult(result);
      assert.ok(
        parsed.error.includes("Nested post_to is not supported"),
        `expected nested post_to rejection, got: ${parsed.error}`,
      );
      assert.ok(parsed.error.includes("additional_messages[0].actions[0]"));
    });

    it("intent coverage satisfied by a ref inside additional_messages follower", async () => {
      const intentStore: IntentStore = {
        stage: vi.fn<(intent: StagedIntent) => string>(() => "ref-x"),
        resolve: vi.fn<(ref: string) => StagedIntent | undefined>((ref) =>
          ref === "ref-x"
            ? { type: "change", branch: "feat/x", description: "", repo: "r" }
            : undefined,
        ),
        getAll: vi.fn<() => Map<string, StagedIntent>>(
          () =>
            new Map([["ref-x", { type: "change", branch: "feat/x", description: "", repo: "r" }]]),
        ),
      };
      const deps = makeDeps({ intentStore });
      const result = await callToolRawTopLevel(deps, {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [],
        additional_messages: [
          {
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "follow" } }],
            actions: [{ type: "change", ref: "ref-x" }],
          },
        ],
      });
      const parsed = parseToolResult(result);
      assert.equal(parsed.success, true, `expected success, got: ${JSON.stringify(parsed)}`);
    });

    it("post_to thread_replies capped at 20", () => {
      const deps = makeDeps();
      const schema = inputSchemaOf(deps);
      const msg = { blocks: [{ type: "section", text: { type: "mrkdwn", text: "reply" } }] };
      const over20 = schema.safeParse({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "primary" } }],
        actions: [
          {
            type: "post_to",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "cross-post" } }],
            thread_replies: Array.from({ length: 21 }, () => msg),
          },
        ],
      });
      assert.equal(over20.success, false);
    });
  });
});
