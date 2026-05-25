import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { App, BlockAction } from "@slack/bolt";
import { registerSkillActionHandler, type SkillActionDeps } from "./skillAction.js";
import type { StagedIntent } from "../../tools/types.js";
import type { UserRole } from "../../roles.js";
import type { UserSkill } from "../../userSkills.js";
import type { SessionInfo } from "../activeSessions.js";

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

interface CapturedHandler {
  handler: (args: {
    ack: () => Promise<void>;
    body: BlockAction;
    client: App["client"];
    respond: (args: { delete_original: true }) => Promise<void>;
  }) => Promise<void>;
}

function makeMockApp(): { app: App; captured: CapturedHandler } {
  const captured: CapturedHandler = {
    handler: async () => {
      throw new Error("not registered");
    },
  };
  const app = {
    action: (_pattern: RegExp, handler: CapturedHandler["handler"]) => {
      captured.handler = handler;
    },
  } as object as App;
  return { app, captured };
}

const baseSkill: UserSkill = {
  slug: "foo",
  description: "d",
  body: "b",
  ownerUserId: "U_OWNER",
  createdAt: "t",
  updatedAt: "t",
};

const sessionInfoFixture: SessionInfo = {
  sessionId: "S1",
  channelId: "C1",
  threadTs: "T1",
} as object as SessionInfo;

type PostFn = (...args: unknown[]) => Promise<{ ok: true; ts: string }>;
function makePostMock(): ReturnType<typeof mock.fn<PostFn>> {
  return mock.fn<PostFn>(async () => ({ ok: true as const, ts: "T2" }));
}

function makeClient(): {
  client: App["client"];
  postMessage: ReturnType<typeof mock.fn<PostFn>>;
  postEphemeral: ReturnType<typeof mock.fn<PostFn>>;
} {
  const postMessage = makePostMock();
  const postEphemeral = makePostMock();
  const client = {
    chat: { postMessage, postEphemeral },
  } as object as App["client"];
  return { client, postMessage, postEphemeral };
}

function makeBody(): BlockAction {
  return {
    user: { id: "U_OWNER" },
    actions: [{ value: JSON.stringify({ s: "S1", r: "REF1" }), action_id: "clack_skill_action_0" }],
  } as object as BlockAction;
}

interface MockBundle {
  deps: SkillActionDeps;
  writeUserSkill: ReturnType<typeof mock.fn<SkillActionDeps["writeUserSkill"]>>;
  updateUserSkill: ReturnType<typeof mock.fn<SkillActionDeps["updateUserSkill"]>>;
  disableUserSkill: ReturnType<typeof mock.fn<SkillActionDeps["disableUserSkill"]>>;
  restoreUserSkill: ReturnType<typeof mock.fn<SkillActionDeps["restoreUserSkill"]>>;
}

function makeDeps(
  overrides: {
    intent?: StagedIntent | null;
    role?: UserRole;
    existing?: UserSkill | null;
    userSkillExists?: boolean;
  } = {},
): MockBundle {
  const writeUserSkill = mock.fn<SkillActionDeps["writeUserSkill"]>(() => baseSkill);
  const updateUserSkill = mock.fn<SkillActionDeps["updateUserSkill"]>(() => baseSkill);
  const disableUserSkill = mock.fn<SkillActionDeps["disableUserSkill"]>(() => baseSkill);
  const restoreUserSkill = mock.fn<SkillActionDeps["restoreUserSkill"]>(() => baseSkill);

  const deps: SkillActionDeps = {
    getRole: async () => overrides.role ?? "member",
    decodeActionValue: () => ({ sessionId: "S1", ref: "REF1" }),
    restoreSession: async () => sessionInfoFixture,
    getStagedIntent: async () => overrides.intent ?? null,
    writeUserSkill,
    updateUserSkill,
    disableUserSkill,
    restoreUserSkill,
    readUserSkill: () => overrides.existing ?? null,
    userSkillExists: () => overrides.userSkillExists ?? false,
    errorMessage: (e) => (e instanceof Error ? e.message : String(e)),
  };

  return { deps, writeUserSkill, updateUserSkill, disableUserSkill, restoreUserSkill };
}

async function invoke(bundle: MockBundle) {
  const { app, captured } = makeMockApp();
  registerSkillActionHandler(app, bundle.deps);
  const { client, postMessage, postEphemeral } = makeClient();
  await captured.handler({
    ack: async () => {},
    body: makeBody(),
    client,
    respond: async () => {},
  });
  return { postMessage, postEphemeral };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("skillAction handler — create", () => {
  it("applies a skill_create intent for a member", async () => {
    const intent: StagedIntent = {
      type: "skill_create",
      slug: "foo",
      description: "d",
      body: "b",
      ownerUserId: "U_OWNER",
    };
    const bundle = makeDeps({ intent, role: "member", userSkillExists: false });
    const { postMessage } = await invoke(bundle);
    assert.equal(bundle.writeUserSkill.mock.callCount(), 1);
    assert.equal(postMessage.mock.callCount(), 1);
  });

  it("rejects skill_create when slug already exists at apply time", async () => {
    const intent: StagedIntent = {
      type: "skill_create",
      slug: "foo",
      description: "d",
      body: "b",
      ownerUserId: "U_OWNER",
    };
    const bundle = makeDeps({ intent, role: "member", userSkillExists: true });
    const { postEphemeral } = await invoke(bundle);
    assert.equal(bundle.writeUserSkill.mock.callCount(), 0);
    assert.equal(postEphemeral.mock.callCount(), 1);
  });
});

describe("skillAction handler — update", () => {
  it("applies skill_update for the owner", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "foo", body: "new" };
    const bundle = makeDeps({ intent, role: "member", existing: baseSkill });
    const { postMessage } = await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.callCount(), 1);
    assert.equal(postMessage.mock.callCount(), 1);
  });

  it("rejects skill_update when caller is not the owner and not admin", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "foo", body: "new" };
    const bundle = makeDeps({
      intent,
      role: "member",
      existing: { ...baseSkill, ownerUserId: "U_OTHER" },
    });
    const { postEphemeral } = await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.callCount(), 0);
    assert.equal(postEphemeral.mock.callCount(), 1);
  });

  it("allows skill_update when caller is admin (defense-in-depth)", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "foo", body: "new" };
    const bundle = makeDeps({
      intent,
      role: "admin",
      existing: { ...baseSkill, ownerUserId: "U_OTHER" },
    });
    await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.callCount(), 1);
  });

  it("rejects skill_update when skill no longer exists", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "ghost", body: "x" };
    const bundle = makeDeps({ intent, role: "admin", existing: null });
    const { postEphemeral } = await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.callCount(), 0);
    assert.equal(postEphemeral.mock.callCount(), 1);
  });
});

describe("skillAction handler — disable/restore", () => {
  it("applies skill_disable for the owner", async () => {
    const intent: StagedIntent = { type: "skill_disable", slug: "foo" };
    const bundle = makeDeps({ intent, role: "member", existing: baseSkill });
    await invoke(bundle);
    assert.equal(bundle.disableUserSkill.mock.callCount(), 1);
  });

  it("rejects skill_disable when caller is non-owner non-admin", async () => {
    const intent: StagedIntent = { type: "skill_disable", slug: "foo" };
    const bundle = makeDeps({
      intent,
      role: "member",
      existing: { ...baseSkill, ownerUserId: "U_OTHER" },
    });
    await invoke(bundle);
    assert.equal(bundle.disableUserSkill.mock.callCount(), 0);
  });

  it("applies skill_restore for the owner", async () => {
    const intent: StagedIntent = { type: "skill_restore", slug: "foo" };
    const bundle = makeDeps({
      intent,
      role: "member",
      existing: { ...baseSkill, disabledAt: "x" },
    });
    await invoke(bundle);
    assert.equal(bundle.restoreUserSkill.mock.callCount(), 1);
  });
});

describe("skillAction handler — expired intent", () => {
  it("posts an ephemeral expired message when the intent cannot be resolved", async () => {
    const bundle = makeDeps({ intent: null, role: "member" });
    const { postEphemeral } = await invoke(bundle);
    assert.equal(postEphemeral.mock.callCount(), 1);
  });
});
