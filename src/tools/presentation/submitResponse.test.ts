import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import type { StagedIntent, ResponseSnapshot } from "../types.js";
import { createSubmitResponseTool, type SubmitResponseDeps } from "./submitResponse.js";

// ---------------------------------------------------------------------------
// Block function mocks — injected via SubmitResponseDeps
// ---------------------------------------------------------------------------

type StructuredBlocksFn = NonNullable<SubmitResponseDeps["getStructuredResponseBlocks"]>;
type ValidateBlocksFn = NonNullable<SubmitResponseDeps["validateSlackBlocks"]>;
type ActionBlocksFn = NonNullable<SubmitResponseDeps["getResponseActionBlocks"]>;

const mockGetStructuredResponseBlocks = mock.fn<StructuredBlocksFn>();
const mockValidateSlackBlocks = mock.fn<ValidateBlocksFn>();
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
      markdownText: string;
      blocks?: unknown[];
    }) => Promise<{ ok: true } | { ok: false; error: string }>;
    persistSnapshot: (id: string, snapshot: ResponseSnapshot) => Promise<void>;
    allowSkip: boolean;
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
    setSkipped: mock.fn<(disengage?: boolean) => void>(),
    isSkipped: mock.fn<() => boolean>(() => false),
    isDisengaged: mock.fn<() => boolean>(() => false),
    ...overrides.responseCapture,
  };

  const recorder: ToolCallRecorder = {
    record:
      mock.fn<
        (tool: string, args: Record<string, unknown>, result: Record<string, unknown>) => void
      >(),
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
    getStructuredResponseBlocks: mockGetStructuredResponseBlocks,
    validateSlackBlocks: mockValidateSlackBlocks,
    getResponseActionBlocks: mockGetResponseActionBlocks,
  };
}

/** Call the tool's handler directly. */
async function callTool(
  deps: ReturnType<typeof makeDeps>,
  args: { message?: string; sections: { title?: string; body: string }[]; actions: unknown[] },
) {
  const toolDef = createSubmitResponseTool(deps);
  return toolDef.handler(args as never, {});
}

function resetBlockMocks() {
  mockGetStructuredResponseBlocks.mock.resetCalls();
  mockValidateSlackBlocks.mock.resetCalls();
  mockGetResponseActionBlocks.mock.resetCalls();

  // Defaults: valid blocks, no errors
  mockGetStructuredResponseBlocks.mock.mockImplementation(() => [
    { type: "section", text: { type: "mrkdwn", text: "test" } },
  ]);
  mockValidateSlackBlocks.mock.mockImplementation(() => []);
  mockGetResponseActionBlocks.mock.mockImplementation(() => []);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSubmitResponseTool", () => {
  beforeEach(resetBlockMocks);

  describe("successful submission", () => {
    it("returns success result with section and action counts", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        sections: [{ body: "Hello world" }],
        actions: [],
      });

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.success, true);
      assert.equal(parsed.delivered, false);
      assert.equal(parsed.sectionsCount, 1);
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
          isSkipped: () => false,
          isDisengaged: () => false,
        },
      });

      await callTool(deps, {
        sections: [{ body: "Answer text" }],
        actions: [],
      });

      assert.equal(setCalls.length, 1);
      const [payload] = setCalls[0] as [{ sections: { body: string }[] }];
      assert.equal(payload.sections[0].body, "Answer text");
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
        sections: [{ body: "ok" }],
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
        sections: [{ body: "The content" }],
        actions: [],
      });

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.success, true);
    });

    it("handles sections with titles", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        sections: [{ title: "Summary", body: "Some summary text" }],
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
        sections: [{ body: "Change proposed" }],
        actions: [{ type: "change", ref: "bad-ref" }],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = JSON.parse(result.content[0].text);
      assert.ok(parsed.error.includes("unknown ref"));
    });

    it("returns error for unknown ref in config_update action", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        sections: [{ body: "Config update" }],
        actions: [{ type: "config_update", ref: "missing-ref" }],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = JSON.parse(result.content[0].text);
      assert.ok(parsed.error.includes("unknown ref"));
    });

    it("returns error for unknown ref in update action", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        sections: [{ body: "Update" }],
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
          resolve: () => ({ type: "update" as const, sessionId: "s1", instructions: "do stuff" }),
          getAll: () => new Map(),
        },
      });

      const result = await callTool(deps, {
        sections: [{ body: "Mismatch" }],
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
        sections: [{ body: "Change it" }],
        actions: [{ type: "change", ref: "ref-1" }],
      });

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.success, true);
    });

    it("does not validate refs for followup actions", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        sections: [{ body: "Follow up" }],
        actions: [{ type: "followup", label: "More", prompt: "Tell me more" }],
      });

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.success, true);
    });

    it("does not validate refs for choice actions", async () => {
      const deps = makeDeps();
      const result = await callTool(deps, {
        sections: [{ body: "Pick one" }],
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
        sections: [{ body: "bad" }],
        actions: [{ type: "change", ref: "bad-ref" }],
      });

      assert.equal(recorded.length, 1);
      const [tool, , resultData] = recorded[0] as [string, unknown, { error: string }];
      assert.equal(tool, "submit_response");
      assert.ok(resultData.error.includes("unknown ref"));
    });
  });

  describe("response too long", () => {
    it("returns error when display text exceeds 10000 chars", async () => {
      const deps = makeDeps();
      const longBody = "x".repeat(10001);
      const result = await callTool(deps, {
        sections: [{ body: longBody }],
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
        sections: [{ body: "b".repeat(5001) }],
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
        sections: [{ body: "x".repeat(10001) }],
        actions: [],
      });

      assert.equal(recorded.length, 1);
      const [, , resultData] = recorded[0] as [string, unknown, { error: string }];
      assert.equal(resultData.error, "response_too_long");
    });
  });

  describe("block validation errors", () => {
    it("returns error when validateSlackBlocks reports violations", async () => {
      mockValidateSlackBlocks.mock.mockImplementation(() => [
        { field: "section[0].text", message: "text too long", currentLength: 4000, limit: 3000 },
      ]);

      const deps = makeDeps();
      const result = await callTool(deps, {
        sections: [{ body: "ok" }],
        actions: [],
      });

      assert.equal("isError" in result && result.isError, true);
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.error, "invalid_blocks");
      assert.ok(Array.isArray(parsed.details));
      assert.ok(parsed.details[0].includes("section[0].text"));
    });

    it("does not deliver or capture when blocks are invalid", async () => {
      mockValidateSlackBlocks.mock.mockImplementation(() => [
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
          isSkipped: () => false,
          isDisengaged: () => false,
        },
      });

      await callTool(deps, {
        sections: [{ body: "ok" }],
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
        sections: [{ body: "Delivered answer" }],
        actions: [],
      });

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.delivered, true);
      assert.equal(deliverCalls.length, 1);
    });

    it("passes markdownText to deliver", async () => {
      let receivedText = "";
      const deps = makeDeps({
        deliver: async (opts: { markdownText: string }) => {
          receivedText = opts.markdownText;
          return { ok: true as const };
        },
      });

      await callTool(deps, {
        sections: [{ body: "The answer" }],
        actions: [],
      });

      assert.equal(receivedText, "The answer");
    });

    it("includes blocks in deliver when action blocks are present", async () => {
      mockGetResponseActionBlocks.mock.mockImplementation(() => [
        { type: "actions", elements: [] },
      ]);

      let receivedBlocks: unknown;
      const deps = makeDeps({
        deliver: async (opts: { markdownText: string; blocks?: unknown[] }) => {
          receivedBlocks = opts.blocks;
          return { ok: true as const };
        },
      });

      await callTool(deps, {
        sections: [{ body: "With actions" }],
        actions: [{ type: "followup", label: "More", prompt: "more" }],
      });

      assert.ok(Array.isArray(receivedBlocks));
    });

    it("does not include blocks key when no action blocks", async () => {
      mockGetResponseActionBlocks.mock.mockImplementation(() => []);

      let receivedOpts: Record<string, unknown> = {};
      const deps = makeDeps({
        deliver: async (opts) => {
          receivedOpts = opts as Record<string, unknown>;
          return { ok: true as const };
        },
      });

      await callTool(deps, {
        sections: [{ body: "No actions" }],
        actions: [],
      });

      assert.equal("blocks" in receivedOpts, false);
    });

    it("returns error when delivery fails", async () => {
      const deps = makeDeps({
        deliver: async () => ({ ok: false as const, error: "channel_not_found" }),
      });

      const result = await callTool(deps, {
        sections: [{ body: "Will fail" }],
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
        sections: [{ body: "Fail" }],
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
          isSkipped: () => false,
          isDisengaged: () => false,
        },
      });

      await callTool(deps, {
        sections: [{ body: "No deliver" }],
        actions: [],
      });

      assert.equal(setCalls.length, 1);
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
        sections: [{ body: "No buttons" }],
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
        sections: [{ body: "Option 1" }, { body: "Option 2" }],
        actions: [
          { type: "post_to", content: "Option 1 text", label: "Send 1" },
          { type: "post_to", content: "Option 2 text", label: "Send 2" },
        ],
      });

      assert.equal(snapshots.length, 2);
      assert.equal(snapshots[0].snapshot.text, "Option 1 text");
      assert.equal(snapshots[1].snapshot.text, "Option 2 text");
      // Each snapshot should have the content as a single section
      assert.equal(snapshots[0].snapshot.sections[0].body, "Option 1 text");
      assert.equal(snapshots[1].snapshot.sections[0].body, "Option 2 text");
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
          isSkipped: () => false,
          isDisengaged: () => false,
        },
      });

      await callTool(deps, {
        sections: [{ body: "Answer" }],
        actions: [{ type: "post_to", content: "Share this" }],
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
          isSkipped: () => false,
          isDisengaged: () => false,
        },
      });

      await callTool(deps, {
        sections: [{ body: "no persist" }],
        actions: [{ type: "post_to", content: "text" }],
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

    it("rejects disengage without skip_response", async () => {
      const deps = makeDeps({ allowSkip: true });
      const result = await callToolRaw(deps, {
        disengage: true,
        message: "test",
        sections: [{ body: "Hello" }],
        actions: [],
      });

      assert.equal(result.isError, true);
      const text = result.content[0].text;
      assert.ok(text.includes("disengage requires skip_response: true"));
    });

    it("passes disengage flag to setSkipped", async () => {
      const setSkippedFn = mock.fn<(disengage?: boolean) => void>();
      const deps = makeDeps({
        allowSkip: true,
        responseCapture: {
          set: mock.fn<(payload: unknown, blocks: unknown) => void>(),
          get: mock.fn<() => null>(() => null),
          getRenderedBlocks: mock.fn<() => null>(() => null),
          setSkipped: setSkippedFn,
          isSkipped: mock.fn<() => boolean>(() => false),
          isDisengaged: mock.fn<() => boolean>(() => false),
        },
      });
      await callToolRaw(deps, {
        skip_response: true,
        disengage: true,
        message:
          "I acknowledge that responding to this would serve no purpose, so I am skipping it.",
      });

      assert.equal(setSkippedFn.mock.callCount(), 1);
      assert.equal(setSkippedFn.mock.calls[0].arguments[0], true);
    });

    it("normal flow unchanged when allowSkip is true but skip_response is absent", async () => {
      const deps = makeDeps({ allowSkip: true });
      const result = await callTool(deps, {
        sections: [{ body: "Hello" }],
        actions: [],
      });

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.success, true);
      assert.equal(parsed.skipped, undefined);
      assert.equal(parsed.sectionsCount, 1);
    });
  });
});
