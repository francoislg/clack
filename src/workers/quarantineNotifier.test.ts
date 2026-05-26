import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { notifyOwnerOfQuarantine, type QuarantineNotifierDeps } from "./quarantineNotifier.js";
import type { QuarantineEvent } from "./reusablePool.js";

function makeEvent(over: Partial<QuarantineEvent> = {}): QuarantineEvent {
  return {
    workerId: "worker-1",
    repo: "my-repo",
    branch: "feat/x",
    worktreePath: "/tmp/wt/my-repo/worker-1",
    dirtyFiles: ["src/foo.ts"],
    trigger: "release",
    ...over,
  };
}

interface PostedDm {
  ownerUserId: string;
  text: string;
  options?: { suppressUnfurls?: boolean };
}

interface MakeDepsOptions {
  owner?: string | null;
  posted?: PostedDm[];
  dmResult?: boolean;
}

function makeDeps(opts: MakeDepsOptions = {}): QuarantineNotifierDeps {
  const owner = opts.owner === undefined ? "U_OWNER" : opts.owner;
  const posted = opts.posted ?? [];
  const dmResult = opts.dmResult === undefined ? true : opts.dmResult;
  return {
    getOwnerUserId: async () => owner,
    sendOwnerDm: async (ownerUserId, text, options) => {
      posted.push({ ownerUserId, text, options });
      return dmResult;
    },
  };
}

describe("notifyOwnerOfQuarantine", () => {
  it("posts a DM to the owner with the dirty file list", async () => {
    const posted: PostedDm[] = [];
    const deps = makeDeps({ posted });

    await notifyOwnerOfQuarantine(makeEvent({ dirtyFiles: ["a.ts", "b.ts"] }), deps);

    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.ownerUserId, "U_OWNER");
    assert.match(posted[0]!.text, /Worker `worker-1` quarantined/);
    assert.match(posted[0]!.text, /a\.ts/);
    assert.match(posted[0]!.text, /b\.ts/);
    assert.match(posted[0]!.text, /PR completion/);
  });

  it("is a no-op when no owner is configured", async () => {
    const posted: PostedDm[] = [];
    const deps = makeDeps({ owner: null, posted });

    await notifyOwnerOfQuarantine(makeEvent(), deps);
    assert.equal(posted.length, 0);
  });

  it("does not throw when sendOwnerDm reports failure", async () => {
    const posted: PostedDm[] = [];
    const deps = makeDeps({ posted, dmResult: false });

    await assert.doesNotReject(notifyOwnerOfQuarantine(makeEvent(), deps));
    assert.equal(posted.length, 1); // still attempted
  });

  it("truncates the file list when there are more than 10 dirty files", async () => {
    const posted: PostedDm[] = [];
    const deps = makeDeps({ posted });

    const files = Array.from({ length: 15 }, (_, i) => `file-${i}.ts`);
    await notifyOwnerOfQuarantine(makeEvent({ dirtyFiles: files }), deps);

    assert.equal(posted.length, 1);
    assert.match(posted[0]!.text, /Dirty tracked files \(15\)/);
    assert.match(posted[0]!.text, /…and 5 more/);
  });

  it("labels each trigger correctly", async () => {
    const posted: PostedDm[] = [];
    const deps = makeDeps({ posted });

    await notifyOwnerOfQuarantine(makeEvent({ trigger: "branch_switch" }), deps);
    assert.match(posted[0]!.text, /branch switch/);

    await notifyOwnerOfQuarantine(makeEvent({ trigger: "idle_release" }), deps);
    assert.match(posted[1]!.text, /idle-release sweep/);

    await notifyOwnerOfQuarantine(makeEvent({ trigger: "release" }), deps);
    assert.match(posted[2]!.text, /PR completion/);
  });

  it("formats detached HEAD branch as '(detached)'", async () => {
    const posted: PostedDm[] = [];
    const deps = makeDeps({ posted });

    await notifyOwnerOfQuarantine(makeEvent({ branch: null }), deps);
    assert.match(posted[0]!.text, /\(detached\)/);
  });

  it("does not pass suppressUnfurls when the option is omitted", async () => {
    const posted: PostedDm[] = [];
    const deps = makeDeps({ posted });

    await notifyOwnerOfQuarantine(makeEvent(), deps);
    assert.equal(posted[0]!.options?.suppressUnfurls, undefined);
  });

  it("forwards suppressUnfurls: true to sendOwnerDm", async () => {
    const posted: PostedDm[] = [];
    const deps = makeDeps({ posted });

    await notifyOwnerOfQuarantine(makeEvent(), deps, { suppressUnfurls: true });
    assert.equal(posted[0]!.options?.suppressUnfurls, true);
  });
});
