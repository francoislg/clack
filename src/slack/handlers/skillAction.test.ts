import { describe, it, vi } from "vitest";
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

interface RespondArg {
  replace_original?: boolean;
  delete_original?: boolean;
  text?: string;
  blocks?: unknown[];
}

interface CapturedHandler {
  handler: (args: {
    ack: () => Promise<void>;
    body: BlockAction;
    client: App["client"];
    respond: (args: RespondArg) => Promise<void>;
  }) => Promise<void>;
}

function button(actionId: string, text: string) {
  return { type: "button", action_id: actionId, text: { type: "plain_text", text } };
}

const SKILL_SECTION = { type: "section", text: { type: "mrkdwn", text: "Skill proposal" } };

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
function makePostMock(): ReturnType<typeof vi.fn<PostFn>> {
  return vi.fn<PostFn>(async () => ({ ok: true as const, ts: "T2" }));
}

function makeClient(): {
  client: App["client"];
  postMessage: ReturnType<typeof vi.fn<PostFn>>;
  postEphemeral: ReturnType<typeof vi.fn<PostFn>>;
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
    message: {
      text: "Skill proposal",
      blocks: [
        SKILL_SECTION,
        { type: "divider" },
        { type: "actions", elements: [button("clack_skill_action_0", "Create")] },
      ],
    },
  } as object as BlockAction;
}

interface MockBundle {
  deps: SkillActionDeps;
  writeUserSkill: ReturnType<typeof vi.fn<SkillActionDeps["writeUserSkill"]>>;
  updateUserSkill: ReturnType<typeof vi.fn<SkillActionDeps["updateUserSkill"]>>;
  disableUserSkill: ReturnType<typeof vi.fn<SkillActionDeps["disableUserSkill"]>>;
  restoreUserSkill: ReturnType<typeof vi.fn<SkillActionDeps["restoreUserSkill"]>>;
}

function makeDeps(
  overrides: {
    intent?: StagedIntent | null;
    role?: UserRole;
    existing?: UserSkill | null;
    userSkillExists?: boolean;
  } = {},
): MockBundle {
  const writeUserSkill = vi.fn<SkillActionDeps["writeUserSkill"]>(() => baseSkill);
  const updateUserSkill = vi.fn<SkillActionDeps["updateUserSkill"]>(() => baseSkill);
  const disableUserSkill = vi.fn<SkillActionDeps["disableUserSkill"]>(() => baseSkill);
  const restoreUserSkill = vi.fn<SkillActionDeps["restoreUserSkill"]>(() => baseSkill);

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

async function invoke(bundle: MockBundle, body: BlockAction = makeBody()) {
  const { app, captured } = makeMockApp();
  registerSkillActionHandler(app, bundle.deps);
  const { client, postMessage, postEphemeral } = makeClient();
  const respond = vi.fn(async (_args: RespondArg) => {});
  await captured.handler({
    ack: async () => {},
    body,
    client,
    respond,
  });
  return { postMessage, postEphemeral, respond };
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
    assert.equal(bundle.writeUserSkill.mock.calls.length, 1);
    assert.equal(postMessage.mock.calls.length, 1);
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
    assert.equal(bundle.writeUserSkill.mock.calls.length, 0);
    assert.equal(postEphemeral.mock.calls.length, 1);
  });

  it("preserves the message and removes the clicked button on apply", async () => {
    const intent: StagedIntent = {
      type: "skill_create",
      slug: "foo",
      description: "d",
      body: "b",
      ownerUserId: "U_OWNER",
    };
    const bundle = makeDeps({ intent, role: "member", userSkillExists: false });
    const { respond } = await invoke(bundle);
    assert.equal(respond.mock.calls.length, 1);
    const arg = respond.mock.calls[0][0];
    assert.equal(arg.replace_original, true);
    assert.deepEqual(arg.blocks, [SKILL_SECTION]);
  });

  it("leaves the message untouched (never deletes) when the payload has no blocks", async () => {
    const intent: StagedIntent = {
      type: "skill_create",
      slug: "foo",
      description: "d",
      body: "b",
      ownerUserId: "U_OWNER",
    };
    const bundle = makeDeps({ intent, role: "member", userSkillExists: false });
    const body = makeBody();
    body.message = undefined;
    const { respond, postMessage } = await invoke(bundle, body);
    assert.equal(respond.mock.calls.length, 0);
    assert.equal(postMessage.mock.calls.length, 1);
  });
});

describe("skillAction handler — update", () => {
  it("applies skill_update for the owner", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "foo", body: "new" };
    const bundle = makeDeps({ intent, role: "member", existing: baseSkill });
    const { postMessage } = await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.calls.length, 1);
    assert.equal(postMessage.mock.calls.length, 1);
  });

  it("rejects skill_update when caller is not the owner and not admin", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "foo", body: "new" };
    const bundle = makeDeps({
      intent,
      role: "member",
      existing: { ...baseSkill, ownerUserId: "U_OTHER" },
    });
    const { postEphemeral } = await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.calls.length, 0);
    assert.equal(postEphemeral.mock.calls.length, 1);
  });

  it("allows skill_update when caller is admin (defense-in-depth)", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "foo", body: "new" };
    const bundle = makeDeps({
      intent,
      role: "admin",
      existing: { ...baseSkill, ownerUserId: "U_OTHER" },
    });
    await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.calls.length, 1);
  });

  it("allows non-owner member content edit when the skill is everyone-editable", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "foo", body: "new" };
    const bundle = makeDeps({
      intent,
      role: "member",
      existing: { ...baseSkill, ownerUserId: "U_OTHER", editableByAnyone: true },
    });
    await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.calls.length, 1);
  });

  it("persists editableByAnyone from the staged intent for the owner", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "foo", editableByAnyone: true };
    const bundle = makeDeps({ intent, role: "member", existing: baseSkill });
    await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.calls.length, 1);
    assert.equal(bundle.updateUserSkill.mock.calls[0][0].editableByAnyone, true);
  });

  it("rejects a flag change by a non-manager (everyone-editable skill)", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "foo", editableByAnyone: false };
    const bundle = makeDeps({
      intent,
      role: "member",
      existing: { ...baseSkill, ownerUserId: "U_OTHER", editableByAnyone: true },
    });
    const { postEphemeral } = await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.calls.length, 0);
    assert.equal(postEphemeral.mock.calls.length, 1);
  });

  it("rejects skill_update when skill no longer exists", async () => {
    const intent: StagedIntent = { type: "skill_update", slug: "ghost", body: "x" };
    const bundle = makeDeps({ intent, role: "admin", existing: null });
    const { postEphemeral } = await invoke(bundle);
    assert.equal(bundle.updateUserSkill.mock.calls.length, 0);
    assert.equal(postEphemeral.mock.calls.length, 1);
  });
});

describe("skillAction handler — disable/restore", () => {
  it("applies skill_disable for the owner", async () => {
    const intent: StagedIntent = { type: "skill_disable", slug: "foo" };
    const bundle = makeDeps({ intent, role: "member", existing: baseSkill });
    await invoke(bundle);
    assert.equal(bundle.disableUserSkill.mock.calls.length, 1);
  });

  it("rejects skill_disable when caller is non-owner non-admin", async () => {
    const intent: StagedIntent = { type: "skill_disable", slug: "foo" };
    const bundle = makeDeps({
      intent,
      role: "member",
      existing: { ...baseSkill, ownerUserId: "U_OTHER" },
    });
    await invoke(bundle);
    assert.equal(bundle.disableUserSkill.mock.calls.length, 0);
  });

  it("applies skill_restore for the owner", async () => {
    const intent: StagedIntent = { type: "skill_restore", slug: "foo" };
    const bundle = makeDeps({
      intent,
      role: "member",
      existing: { ...baseSkill, disabledAt: "x" },
    });
    await invoke(bundle);
    assert.equal(bundle.restoreUserSkill.mock.calls.length, 1);
  });
});

describe("skillAction handler — expired intent", () => {
  it("posts an ephemeral expired message when the intent cannot be resolved", async () => {
    const bundle = makeDeps({ intent: null, role: "member" });
    const { postEphemeral } = await invoke(bundle);
    assert.equal(postEphemeral.mock.calls.length, 1);
  });
});
