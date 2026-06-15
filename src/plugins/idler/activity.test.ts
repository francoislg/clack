import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { appendActivity, clearActivity, loadActivity, type ActivitySdk } from "./activity.js";

function fakeSdk(): ActivitySdk {
  let store: string | null = null;
  return {
    readFile: async () => store,
    writeFile: async (_path: string, content: string) => {
      store = content;
    },
  };
}

describe("activity log", () => {
  it("starts empty", async () => {
    const sdk = fakeSdk();
    assert.deepEqual(await loadActivity(sdk), { entries: [] });
  });

  it("appends entries in order", async () => {
    const sdk = fakeSdk();
    await appendActivity(sdk, { at: "2026-06-15T01:00:00Z", kind: "pr_opened", detail: "PR #1" });
    await appendActivity(sdk, {
      at: "2026-06-15T02:00:00Z",
      kind: "review",
      detail: "reviewed #1",
    });
    const log = await loadActivity(sdk);
    assert.equal(log.entries.length, 2);
    assert.equal(log.entries[0].kind, "pr_opened");
    assert.equal(log.entries[1].kind, "review");
  });

  it("clears the log", async () => {
    const sdk = fakeSdk();
    await appendActivity(sdk, { at: "2026-06-15T01:00:00Z", kind: "failure", detail: "boom" });
    await clearActivity(sdk);
    assert.deepEqual(await loadActivity(sdk), { entries: [] });
  });

  it("reads malformed log as empty, never throws", async () => {
    const sdk: ActivitySdk = { readFile: async () => "{bad", writeFile: async () => {} };
    assert.deepEqual(await loadActivity(sdk), { entries: [] });
  });
});
