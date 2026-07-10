import { describe, it, expect, vi } from "vitest";
import {
  notifyOwnerOfCronQuarantine,
  type CronQuarantineNotifierDeps,
} from "./cronQuarantineNotifier.js";

function makeDeps(overrides: Partial<CronQuarantineNotifierDeps> = {}): {
  deps: CronQuarantineNotifierDeps;
  sent: string[];
} {
  const sent: string[] = [];
  const deps: CronQuarantineNotifierDeps = {
    getOwnerUserId: async () => "U_OWNER",
    sendOwnerDm: async (_owner, text) => {
      sent.push(text);
      return true;
    },
    ...overrides,
  };
  return { deps, sent };
}

describe("notifyOwnerOfCronQuarantine", () => {
  it("DMs the owner one message listing each quarantined job", async () => {
    const { deps, sent } = makeDeps();
    await notifyOwnerOfCronQuarantine(
      {
        quarantined: [
          { id: "job-a", field: "timezone", error: "Required" },
          { id: "#1", field: "cronExpression", error: "Expected string" },
        ],
      },
      deps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("job-a");
    expect(sent[0]).toContain("timezone");
    expect(sent[0]).toContain("cronExpression");
  });

  it("DMs the owner about a persistence freeze, naming the snapshot", async () => {
    const { deps, sent } = makeDeps();
    await notifyOwnerOfCronQuarantine(
      { quarantined: [], frozen: { snapshotPath: "/data/state/cron-jobs.corrupt-x.json" } },
      deps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("cron-jobs.corrupt-x.json");
  });

  it("handles a freeze with no snapshot", async () => {
    const { deps, sent } = makeDeps();
    await notifyOwnerOfCronQuarantine({ quarantined: [], frozen: { snapshotPath: null } }, deps);
    expect(sent).toHaveLength(1);
  });

  it("no-ops when there is no owner", async () => {
    const { deps, sent } = makeDeps({ getOwnerUserId: async () => null });
    await notifyOwnerOfCronQuarantine({ quarantined: [{ id: "a", field: "f", error: "e" }] }, deps);
    expect(sent).toHaveLength(0);
  });

  it("swallows a failing sendOwnerDm without throwing", async () => {
    const deps: CronQuarantineNotifierDeps = {
      getOwnerUserId: async () => "U_OWNER",
      sendOwnerDm: vi.fn(async () => {
        throw new Error("slack down");
      }),
    };
    await expect(
      notifyOwnerOfCronQuarantine({ quarantined: [{ id: "a", field: "f", error: "e" }] }, deps),
    ).resolves.toBeUndefined();
  });

  it("does not DM when a quarantine report is empty", async () => {
    const { deps, sent } = makeDeps();
    await notifyOwnerOfCronQuarantine({ quarantined: [] }, deps);
    expect(sent).toHaveLength(0);
  });
});
