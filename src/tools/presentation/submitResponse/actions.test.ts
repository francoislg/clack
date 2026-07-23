import { describe, it, expect, vi } from "vitest";
import type { Action, PostToAction, ResponseSnapshot } from "../../types.js";
import { persistPostToSnapshots } from "./actions.js";

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
