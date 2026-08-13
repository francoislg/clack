import { describe, it, expect, vi } from "vitest";
import type { Action, PostToAction, ResponseSnapshot } from "../../types.js";
import { persistPostToSnapshots, collectActionErrors } from "./actions.js";
import { createIntentStore } from "../../server.js";

function postTo(overrides: Partial<PostToAction>): PostToAction {
  return {
    type: "post_to",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "Body" } }],
    creation_context: "test",
    ...overrides,
  };
}

describe("persistPostToSnapshots", () => {
  it("persists a chart alongside blocks and table", async () => {
    const persistSnapshot = vi.fn<(id: string, snapshot: ResponseSnapshot) => Promise<void>>(
      async () => {},
    );
    const chart = { chart_type: "pie" as const, segments: [{ label: "A", value: 1 }] };
    const action = postTo({
      table: { type: "table", rows: [[{ type: "raw_text", text: "A" }]] },
      chart,
    });

    await persistPostToSnapshots([action], persistSnapshot);

    expect(persistSnapshot).toHaveBeenCalledTimes(1);
    const snapshot = persistSnapshot.mock.calls[0][1];
    expect(snapshot.chart).toEqual(chart);
    expect(snapshot.table).toBeDefined();
    expect(action._snapshotId).toBeDefined();
  });

  it("omits the chart from the snapshot when absent", async () => {
    const persistSnapshot = vi.fn<(id: string, snapshot: ResponseSnapshot) => Promise<void>>(
      async () => {},
    );
    await persistPostToSnapshots([postTo({})], persistSnapshot);
    const snapshot = persistSnapshot.mock.calls[0][1];
    expect("chart" in snapshot).toBe(false);
  });

  it("skips non-post_to actions", async () => {
    const persistSnapshot = vi.fn<(id: string, snapshot: ResponseSnapshot) => Promise<void>>(
      async () => {},
    );
    const followup: Action = { type: "followup", label: "Next", prompt: "..." };
    await persistPostToSnapshots([followup], persistSnapshot);
    expect(persistSnapshot).not.toHaveBeenCalled();
  });
});

describe("collectActionErrors - followed-thread blocking", () => {
  const blockedThreads = [
    { channel: "C001", threadTs: "1234567890.000001" },
    { channel: "C002", threadTs: "1234567890.000002" },
  ];

  it("rejects auto post_to targeting a blocked thread without user_requested", () => {
    const intentStore = createIntentStore();
    const { errors } = collectActionErrors(
      {
        actions: [
          postTo({
            auto: true,
            channel: "C001",
            thread_ts: "1234567890.000001",
          }),
        ],
      },
      intentStore,
      undefined,
      blockedThreads,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("FOLLOWED READ-ONLY SOURCE");
    expect(errors[0]).toContain("user_requested: true");
  });

  it("rejects staged button post_to targeting a blocked thread without user_requested", () => {
    const intentStore = createIntentStore();
    const { errors } = collectActionErrors(
      {
        actions: [
          postTo({
            channel: "C001",
            thread_ts: "1234567890.000001",
          }),
        ],
      },
      intentStore,
      undefined,
      blockedThreads,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("FOLLOWED READ-ONLY SOURCE");
  });

  it("allows post_to targeting a blocked thread with user_requested: true", () => {
    const intentStore = createIntentStore();
    const { errors } = collectActionErrors(
      {
        actions: [
          postTo({
            channel: "C001",
            thread_ts: "1234567890.000001",
            user_requested: true,
          }),
        ],
      },
      intentStore,
      undefined,
      blockedThreads,
    );
    expect(errors).toHaveLength(0);
  });

  it("allows post_to to blocked channel without thread_ts (top-level)", () => {
    const intentStore = createIntentStore();
    const { errors } = collectActionErrors(
      {
        actions: [
          postTo({
            channel: "C001",
          }),
        ],
      },
      intentStore,
      undefined,
      blockedThreads,
    );
    expect(errors).toHaveLength(0);
  });

  it("allows post_to to blocked channel with different thread_ts", () => {
    const intentStore = createIntentStore();
    const { errors } = collectActionErrors(
      {
        actions: [
          postTo({
            channel: "C001",
            thread_ts: "9999999999.999999",
          }),
        ],
      },
      intentStore,
      undefined,
      blockedThreads,
    );
    expect(errors).toHaveLength(0);
  });

  it("allows post_to when blockedFollowedThreads is undefined", () => {
    const intentStore = createIntentStore();
    const { errors } = collectActionErrors(
      {
        actions: [
          postTo({
            channel: "C001",
            thread_ts: "1234567890.000001",
          }),
        ],
      },
      intentStore,
      undefined,
      undefined,
    );
    expect(errors).toHaveLength(0);
  });
});
