import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { SessionContext } from "../sessions.js";
import type { SessionInfo } from "./activeSessions.js";
import {
  getDmSynthesisActions,
  getDmPostAcceptActions,
  storeDmCoordinates,
  type DmResponseDeps,
} from "./dmResponse.js";

// ============================================================================
// Mocks
// ============================================================================

const mockUpdateSession = vi.fn<
  (id: string, updates: Partial<SessionContext>) => Promise<SessionContext | null>
>(async () => null);

let sessionInfoStore: Map<string, SessionInfo>;

const mockGetSessionInfo = vi.fn((id: string) => sessionInfoStore.get(id));
const mockSetSessionInfo = vi.fn((id: string, info: SessionInfo) => {
  sessionInfoStore.set(id, info);
});

function makeDeps(): DmResponseDeps {
  return {
    updateSession: mockUpdateSession,
    getSessionInfo: mockGetSessionInfo,
    setSessionInfo: mockSetSessionInfo,
  };
}

// ============================================================================
// Helpers
// ============================================================================

beforeEach(() => {
  mockUpdateSession.mockClear();
  mockGetSessionInfo.mockClear();
  mockSetSessionInfo.mockClear();
  sessionInfoStore = new Map();
});

// ============================================================================
// getDmSynthesisActions
// ============================================================================

describe("getDmSynthesisActions", () => {
  it("returns a single actions block with three buttons", () => {
    const blocks = getDmSynthesisActions("sess-1");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "actions");
    assert.equal(blocks[0].elements.length, 3);
  });

  it("has Accept, Edit, and Reject buttons in order", () => {
    const blocks = getDmSynthesisActions("sess-1");
    const elements = blocks[0].elements;
    assert.equal(elements[0].text.text, "Accept");
    assert.equal(elements[1].text.text, "Edit");
    assert.equal(elements[2].text.text, "Reject");
  });

  it("assigns correct action_ids", () => {
    const blocks = getDmSynthesisActions("sess-1");
    const elements = blocks[0].elements;
    assert.equal(elements[0].action_id, "clack_dm_accept_synthesis");
    assert.equal(elements[1].action_id, "clack_dm_edit_synthesis");
    assert.equal(elements[2].action_id, "clack_dm_reject");
  });

  it("passes sessionId as value on all buttons", () => {
    const blocks = getDmSynthesisActions("sess-xyz");
    for (const element of blocks[0].elements) {
      assert.equal(element.value, "sess-xyz");
    }
  });

  it("applies primary style to Accept and danger style to Reject", () => {
    const blocks = getDmSynthesisActions("sess-1");
    const elements = blocks[0].elements;
    assert.equal(elements[0].style, "primary");
    const elem1 = elements[1] as { style?: string };
    assert.equal(elem1.style, undefined);
    assert.equal(elements[2].style, "danger");
  });

  it("uses plain_text type with emoji for all button labels", () => {
    const blocks = getDmSynthesisActions("sess-1");
    for (const element of blocks[0].elements) {
      assert.equal(element.text.type, "plain_text");
      assert.equal(element.text.emoji, true);
    }
  });

  it("all buttons have type 'button'", () => {
    const blocks = getDmSynthesisActions("sess-1");
    for (const element of blocks[0].elements) {
      assert.equal(element.type, "button");
    }
  });
});

// ============================================================================
// getDmPostAcceptActions
// ============================================================================

describe("getDmPostAcceptActions", () => {
  it("returns a single actions block with three buttons", () => {
    const blocks = getDmPostAcceptActions("sess-1");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "actions");
    assert.equal(blocks[0].elements.length, 3);
  });

  it("has Update original post, Post new reply, and Cancel buttons in order", () => {
    const blocks = getDmPostAcceptActions("sess-1");
    const elements = blocks[0].elements;
    assert.equal(elements[0].text.text, "Update original post");
    assert.equal(elements[1].text.text, "Post new reply");
    assert.equal(elements[2].text.text, "Cancel");
  });

  it("assigns correct action_ids", () => {
    const blocks = getDmPostAcceptActions("sess-1");
    const elements = blocks[0].elements;
    assert.equal(elements[0].action_id, "clack_dm_update_post");
    assert.equal(elements[1].action_id, "clack_dm_post_new");
    assert.equal(elements[2].action_id, "clack_dm_reject");
  });

  it("passes sessionId as value on all buttons", () => {
    const blocks = getDmPostAcceptActions("sess-abc");
    for (const element of blocks[0].elements) {
      assert.equal(element.value, "sess-abc");
    }
  });

  it("applies primary style to Update and danger style to Cancel", () => {
    const blocks = getDmPostAcceptActions("sess-1");
    const elements = blocks[0].elements;
    assert.equal(elements[0].style, "primary");
    const elem1 = elements[1] as { style?: string };
    assert.equal(elem1.style, undefined);
    assert.equal(elements[2].style, "danger");
  });

  it("uses plain_text type with emoji for all button labels", () => {
    const blocks = getDmPostAcceptActions("sess-1");
    for (const element of blocks[0].elements) {
      assert.equal(element.text.type, "plain_text");
      assert.equal(element.text.emoji, true);
    }
  });

  it("Cancel shares the same action_id as Reject in synthesis actions", () => {
    const synthesisBlocks = getDmSynthesisActions("sess-1");
    const postAcceptBlocks = getDmPostAcceptActions("sess-1");
    const rejectActionId = synthesisBlocks[0].elements[2].action_id;
    const cancelActionId = postAcceptBlocks[0].elements[2].action_id;
    assert.equal(rejectActionId, cancelActionId);
  });
});

// ============================================================================
// storeDmCoordinates
// ============================================================================

describe("storeDmCoordinates", () => {
  it("calls updateSession with the DM coordinate fields", async () => {
    const deps = makeDeps();
    await storeDmCoordinates("sess-1", "D100", "1700.001", "C200", "1700.002", deps);

    assert.equal(mockUpdateSession.mock.calls.length, 1);
    const [sessionId, updates] = mockUpdateSession.mock.calls[0];
    assert.equal(sessionId, "sess-1");
    assert.deepEqual(updates, {
      dmChannel: "D100",
      dmThreadTs: "1700.001",
      originChannel: "C200",
      originThreadTs: "1700.002",
    });
  });

  it("updates in-memory session info when it exists", async () => {
    const deps = makeDeps();
    sessionInfoStore.set("sess-1", {
      channelId: "C200",
      threadTs: "1700.002",
      userId: "U001",
    });

    await storeDmCoordinates("sess-1", "D100", "1700.001", "C200", "1700.002", deps);

    assert.equal(mockSetSessionInfo.mock.calls.length, 1);
    const [id, info] = mockSetSessionInfo.mock.calls[0];
    assert.equal(id, "sess-1");
    assert.equal(info.dmChannel, "D100");
    assert.equal(info.dmThreadTs, "1700.001");
    assert.equal(info.originChannel, "C200");
    assert.equal(info.originThreadTs, "1700.002");
    // Original fields should be preserved
    assert.equal(info.channelId, "C200");
    assert.equal(info.threadTs, "1700.002");
    assert.equal(info.userId, "U001");
  });

  it("does not call activeSessions.set when session info is not in memory", async () => {
    const deps = makeDeps();
    // sessionInfoStore is empty — getSessionInfo will return undefined

    await storeDmCoordinates("sess-1", "D100", "1700.001", "C200", "1700.002", deps);

    assert.equal(mockSetSessionInfo.mock.calls.length, 0);
  });

  it("still calls updateSession even when session info is not in memory", async () => {
    const deps = makeDeps();
    await storeDmCoordinates("sess-1", "D100", "1700.001", "C200", "1700.002", deps);

    assert.equal(mockUpdateSession.mock.calls.length, 1);
  });

  it("preserves existing session info fields when merging", async () => {
    const deps = makeDeps();
    sessionInfoStore.set("sess-1", {
      channelId: "C200",
      threadTs: "1700.002",
      userId: "U001",
      triggerType: "reactions",
      channelPostTs: "1700.999",
    });

    await storeDmCoordinates("sess-1", "D100", "1700.001", "C200", "1700.002", deps);

    const [, info] = mockSetSessionInfo.mock.calls[0];
    assert.equal(info.triggerType, "reactions");
    assert.equal(info.channelPostTs, "1700.999");
  });
});
