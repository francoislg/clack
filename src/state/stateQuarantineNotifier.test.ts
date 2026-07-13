import { describe, it, expect, vi } from "vitest";
import {
  notifyOwnerOfStateQuarantine,
  type StateQuarantineNotifierDeps,
} from "./stateQuarantineNotifier.js";

function makeDeps(overrides: Partial<StateQuarantineNotifierDeps> = {}): {
  deps: StateQuarantineNotifierDeps;
  sent: string[];
} {
  const sent: string[] = [];
  const deps: StateQuarantineNotifierDeps = {
    getOwnerUserId: async () => "U_OWNER",
    sendOwnerDm: async (_owner, text) => {
      sent.push(text);
      return true;
    },
    ...overrides,
  };
  return { deps, sent };
}

describe("notifyOwnerOfStateQuarantine", () => {
  it("DMs the owner one message naming the store and each entry", async () => {
    const { deps, sent } = makeDeps();
    await notifyOwnerOfStateQuarantine(
      {
        source: "auto-respond rules",
        quarantined: [
          { key: "rule-a", field: "channels", error: "Required" },
          { key: "U9", field: "enabled", error: "Expected boolean" },
        ],
      },
      deps,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("auto-respond rules");
    expect(sent[0]).toContain("rule-a");
    expect(sent[0]).toContain("channels");
    expect(sent[0]).toContain("U9");
  });

  it("DMs the owner about a freeze, naming the store and the snapshot", async () => {
    const { deps, sent } = makeDeps();
    await notifyOwnerOfStateQuarantine(
      {
        source: "memory",
        quarantined: [],
        frozen: { snapshotPath: "/data/state/memory.corrupt.json" },
      },
      deps,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("memory");
    expect(sent[0]).toContain("memory.corrupt.json");
  });

  it("handles a freeze with no snapshot", async () => {
    const { deps, sent } = makeDeps();
    await notifyOwnerOfStateQuarantine(
      { source: "roles", quarantined: [], frozen: { snapshotPath: null } },
      deps,
    );
    expect(sent).toHaveLength(1);
  });

  it("no-ops when there is no owner", async () => {
    const { deps, sent } = makeDeps({ getOwnerUserId: async () => null });
    await notifyOwnerOfStateQuarantine(
      { source: "memory", quarantined: [{ key: "a", field: "f", error: "e" }] },
      deps,
    );
    expect(sent).toHaveLength(0);
  });

  it("swallows a failing sendOwnerDm without throwing", async () => {
    const deps: StateQuarantineNotifierDeps = {
      getOwnerUserId: async () => "U_OWNER",
      sendOwnerDm: vi.fn(async () => {
        throw new Error("slack down");
      }),
    };
    await expect(
      notifyOwnerOfStateQuarantine(
        { source: "memory", quarantined: [{ key: "a", field: "f", error: "e" }] },
        deps,
      ),
    ).resolves.toBeUndefined();
  });

  it("does not DM when a quarantine report is empty", async () => {
    const { deps, sent } = makeDeps();
    await notifyOwnerOfStateQuarantine({ source: "memory", quarantined: [] }, deps);
    expect(sent).toHaveLength(0);
  });
});
