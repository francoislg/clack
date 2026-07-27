import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { handleClassicDmEvent, type ClassicDmDeps, type DmTurnHooks } from "./classicDm.js";

// ============================================================================
// Mocks
// ============================================================================

type ProcessMessageFn = ClassicDmDeps["processMessage"];
const mockProcessMessage = vi.fn<ProcessMessageFn>(async () => ({
  success: true,
  answer: "",
}));

const mockStopThread = vi.fn<ClassicDmDeps["stopThread"]>(async () => ({
  queryAborted: 0,
  workerAborted: false,
  queuedCancelled: false,
  sessionDisengaged: false,
}));

const mockExtractAttachments = vi.fn<ClassicDmDeps["extractAttachments"]>(() => ({}));

function makeDeps(overrides: { stop?: string | null; enabled?: boolean } = {}): ClassicDmDeps {
  const stop = "stop" in overrides ? overrides.stop : "octagonal_sign";
  return {
    getConfig: () => ({
      directMessages: { enabled: overrides.enabled ?? true, dmType: "classic" },
      reactions: { stop },
    }),
    processMessage: mockProcessMessage,
    extractAttachments: mockExtractAttachments,
    stopThread: mockStopThread,
  };
}

// `Object.create(null)` is typed as `any` in lib.d.ts, so we can assign it to
// `App["client"]` without an explicit cast. The handler never touches the
// client — it only forwards it to `processMessage`, which is mocked.
const FAKE_CLIENT: App["client"] = Object.create(null);

beforeEach(() => {
  mockProcessMessage.mockClear();
  mockStopThread.mockClear();
  mockExtractAttachments.mockClear();
});

// ============================================================================
// Tests
// ============================================================================

describe("classic DM filter", () => {
  it("ignores messages from non-IM channels", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "channel",
        channel: "C001",
        ts: "1.0",
        user: "U1",
        text: "hello",
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    assert.equal(mockProcessMessage.mock.calls.length, 0);
  });

  it("ignores messages with bot_id set", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "1.0",
        user: "U1",
        bot_id: "B001",
        text: "hello",
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    assert.equal(mockProcessMessage.mock.calls.length, 0);
  });

  it("ignores subtyped messages (e.g., message_changed)", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "1.0",
        user: "U1",
        subtype: "message_changed",
        text: "edited",
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    assert.equal(mockProcessMessage.mock.calls.length, 0);
  });

  it("admits a file_share DM and forwards its attachments", async () => {
    mockExtractAttachments.mockReturnValueOnce({
      imageFiles: [
        { id: "F1", name: "a.png", mimetype: "image/png", size: 100, url_private: "https://x" },
      ],
    });
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "1.0",
        user: "U1",
        subtype: "file_share",
        text: "why did this fail?",
        files: [{ id: "F1" }],
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    const call = mockProcessMessage.mock.calls[0][0];
    assert.equal(call.messageText, "why did this fail?");
    assert.equal(call.imageFiles?.length, 1);
  });

  it("admits thread_broadcast and me_message DMs", async () => {
    for (const subtype of ["thread_broadcast", "me_message"]) {
      mockProcessMessage.mockClear();
      await handleClassicDmEvent(
        {
          channel_type: "im",
          channel: "D001",
          ts: "1.0",
          user: "U1",
          subtype,
          text: "hello",
        },
        FAKE_CLIENT,
        makeDeps(),
      );
      assert.equal(mockProcessMessage.mock.calls.length, 1, `expected ${subtype} to be admitted`);
    }
  });

  it("ignores bot_message even though auto-respond admits it", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "1.0",
        user: "U1",
        subtype: "bot_message",
        text: "automated post",
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    assert.equal(mockProcessMessage.mock.calls.length, 0);
  });

  it("ignores DMs with no text and no files", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "1.0",
        user: "U1",
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    assert.equal(mockProcessMessage.mock.calls.length, 0);
  });

  it("ignores when directMessages.enabled is false", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "1.0",
        user: "U1",
        text: "hello",
      },
      FAKE_CLIENT,
      makeDeps({ enabled: false }),
    );
    assert.equal(mockProcessMessage.mock.calls.length, 0);
  });
});

describe("classic DM routing", () => {
  it("routes a top-level DM to processMessage with threadTs undefined", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "1.0",
        user: "U1",
        text: "hello",
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    assert.equal(mockProcessMessage.mock.calls.length, 1);
    const call = mockProcessMessage.mock.calls[0][0];
    assert.equal(call.userId, "U1");
    assert.equal(call.channelId, "D001");
    assert.equal(call.messageTs, "1.0");
    assert.equal(call.messageText, "hello");
    assert.equal(call.threadTs, undefined);
    assert.equal(call.triggerType, "directMessages");
    assert.equal(call.assistantChannelId, undefined);
  });

  it("routes a thread reply to processMessage with the inbound threadTs", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "2.0",
        user: "U1",
        text: "follow-up",
        thread_ts: "1.0",
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    const call = mockProcessMessage.mock.calls[0][0];
    assert.equal(call.threadTs, "1.0");
    assert.equal(call.messageTs, "2.0");
  });

  it("uses the image-only fallback prompt when text is empty but files are present", async () => {
    mockExtractAttachments.mockReturnValueOnce({
      imageFiles: [
        {
          id: "F1",
          name: "a.png",
          mimetype: "image/png",
          size: 100,
          url_private: "https://x",
        },
      ],
    });
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "1.0",
        user: "U1",
        subtype: "file_share",
        files: [{ id: "F1" }],
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    const call = mockProcessMessage.mock.calls[0][0];
    assert.ok(call.messageText.length > 0);
    assert.notEqual(call.messageText, "");
    assert.equal(call.imageFiles?.length, 1);
  });
});

describe("classic DM inline stop emoji", () => {
  it("short-circuits to stopThread on inline stop emoji match", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "2.0",
        user: "U1",
        text: ":octagonal_sign:",
        thread_ts: "1.0",
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    assert.equal(mockStopThread.mock.calls.length, 1);
    assert.equal(mockProcessMessage.mock.calls.length, 0);

    const stopCall = mockStopThread.mock.calls[0];
    assert.equal(stopCall[0], "D001");
    assert.equal(stopCall[1], "1.0");
    assert.equal(stopCall[2], "U1");
  });

  it("uses ts as threadTs when no thread_ts is set on the stop message", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "5.0",
        user: "U1",
        text: ":octagonal_sign:",
      },
      FAKE_CLIENT,
      makeDeps(),
    );
    assert.equal(mockStopThread.mock.calls[0][1], "5.0");
  });

  it("does not fire when stop emoji config is null", async () => {
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "1.0",
        user: "U1",
        text: ":octagonal_sign:",
      },
      FAKE_CLIENT,
      makeDeps({ stop: null }),
    );
    assert.equal(mockStopThread.mock.calls.length, 0);
    assert.equal(mockProcessMessage.mock.calls.length, 1);
  });
});

describe("classic DM turn hooks", () => {
  function makeHooks(): {
    hooks: DmTurnHooks;
    onTurnStart: ReturnType<typeof vi.fn>;
    onTurnEnd: ReturnType<typeof vi.fn>;
  } {
    const onTurnStart = vi.fn<NonNullable<DmTurnHooks["onTurnStart"]>>(async () => {});
    const onTurnEnd = vi.fn<NonNullable<DmTurnHooks["onTurnEnd"]>>(async () => {});
    return { hooks: { onTurnStart, onTurnEnd }, onTurnStart, onTurnEnd };
  }

  it("fires onTurnStart before processMessage and onTurnEnd after, with the resolved root", async () => {
    const { hooks, onTurnStart, onTurnEnd } = makeHooks();
    await handleClassicDmEvent(
      { channel_type: "im", channel: "D001", ts: "1.0", user: "U1", text: "hello" },
      FAKE_CLIENT,
      makeDeps(),
      hooks,
    );

    assert.equal(onTurnStart.mock.calls.length, 1);
    assert.equal(onTurnEnd.mock.calls.length, 1);
    assert.deepEqual(onTurnStart.mock.calls[0][0], {
      client: FAKE_CLIENT,
      channel: "D001",
      threadRoot: "1.0",
    });
    assert.deepEqual(onTurnEnd.mock.calls[0][0], {
      client: FAKE_CLIENT,
      channel: "D001",
      threadRoot: "1.0",
      messageText: "hello",
      isThreadStart: true,
      threadTitle: undefined,
    });
    // Ordering: start → processMessage → end.
    assert.ok(
      onTurnStart.mock.invocationCallOrder[0] < mockProcessMessage.mock.invocationCallOrder[0],
    );
    assert.ok(
      mockProcessMessage.mock.invocationCallOrder[0] < onTurnEnd.mock.invocationCallOrder[0],
    );
  });

  it("threads Claude's submit_response.thread_title into onTurnEnd", async () => {
    const { hooks, onTurnEnd } = makeHooks();
    mockProcessMessage.mockResolvedValueOnce({
      success: true,
      answer: "",
      response: { blocks: [], actions: [], thread_title: "Bolt 5 upgrade questions" },
    });
    await handleClassicDmEvent(
      { channel_type: "im", channel: "D001", ts: "1.0", user: "U1", text: "hello" },
      FAKE_CLIENT,
      makeDeps(),
      hooks,
    );
    assert.equal(onTurnEnd.mock.calls[0][0].threadTitle, "Bolt 5 upgrade questions");
  });

  it("resolves the root to the inbound thread_ts on a thread reply", async () => {
    const { hooks, onTurnStart } = makeHooks();
    await handleClassicDmEvent(
      {
        channel_type: "im",
        channel: "D001",
        ts: "2.0",
        user: "U1",
        text: "follow-up",
        thread_ts: "1.0",
      },
      FAKE_CLIENT,
      makeDeps(),
      hooks,
    );
    assert.equal(onTurnStart.mock.calls[0][0].threadRoot, "1.0");
  });

  it("does not fire hooks for filtered events (subtype) or stop commands", async () => {
    const { hooks, onTurnStart, onTurnEnd } = makeHooks();
    await handleClassicDmEvent(
      { channel_type: "im", channel: "D001", ts: "1.0", user: "U1", subtype: "message_changed" },
      FAKE_CLIENT,
      makeDeps(),
      hooks,
    );
    await handleClassicDmEvent(
      { channel_type: "im", channel: "D001", ts: "2.0", user: "U1", text: ":octagonal_sign:" },
      FAKE_CLIENT,
      makeDeps(),
      hooks,
    );
    assert.equal(onTurnStart.mock.calls.length, 0);
    assert.equal(onTurnEnd.mock.calls.length, 0);
  });

  it("still fires onTurnEnd when processMessage throws", async () => {
    const { hooks, onTurnEnd } = makeHooks();
    mockProcessMessage.mockRejectedValueOnce(new Error("boom"));
    await assert.rejects(
      handleClassicDmEvent(
        { channel_type: "im", channel: "D001", ts: "1.0", user: "U1", text: "hello" },
        FAKE_CLIENT,
        makeDeps(),
        hooks,
      ),
    );
    assert.equal(onTurnEnd.mock.calls.length, 1);
  });
});
