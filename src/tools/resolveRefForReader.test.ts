import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRefForReader, type ReaderContext } from "./resolveRefForReader.js";
import { parseToolResult } from "./testHelpers.js";
import {
  checkFileAccess,
  FILE_ACCESS_DENIED_MESSAGE,
  type FileFacts,
} from "../slack/requesterAccess.js";
import type { SlackFileRef, SlackRef } from "../slack/slackRefs.js";
import { createSlackClientMock, type MockSlackClient } from "../slack/testSlackClient.js";
import { stub } from "../testStubs.js";

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../slack/requesterAccess.js")>();
  return { ...actual, checkFileAccess: vi.fn() };
});

const LIST_FACTS: FileFacts = { filetype: "list", prettyType: "List", name: "Groceries" };
const CANVAS_FACTS: FileFacts = { filetype: "quip", prettyType: "Canvas" };
const IMAGE_FACTS: FileFacts = { mimetype: "image/png", name: "shot.png", size: 1024 };

function allow(facts: FileFacts, botAccess: "read" | "write" | undefined = "write") {
  vi.mocked(checkFileAccess).mockResolvedValue({
    allowed: true,
    botAccess,
    creator: "U1",
    facts,
  });
}

function registered(id: string, overrides: Partial<SlackFileRef> = {}): SlackFileRef {
  return {
    type: "file",
    id,
    kind: "list",
    label: "Slack List",
    reader: "read_list",
    mustOpen: false,
    fromCurrentMessage: true,
    ...overrides,
  };
}

describe("resolveRefForReader", () => {
  let client: MockSlackClient;
  let refs: Map<string, SlackRef>;
  let ctx: ReaderContext;

  beforeEach(() => {
    client = createSlackClientMock();
    refs = new Map();
    ctx = {
      slackClient: client,
      userId: "U1",
      role: "member",
      session: stub<ReaderContext["session"]>({ sessionId: "s1" }),
      config: stub<ReaderContext["config"]>({
        repositories: [],
        lists: { mode: "write", writeRole: "dev" },
        canvases: { mode: "read", writeRole: "dev" },
      }),
      availableRefs: refs,
    };
    vi.mocked(checkFileAccess).mockReset();
  });

  it("refuses a value that is no Slack reference without a Slack call", async () => {
    const result = await resolveRefForReader(ctx, "hello world", ["list"], {
      alwaysCheckAccess: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(parseToolResult(result.error).error).toMatch(/is not a Slack reference/);
    expect(checkFileAccess).not.toHaveBeenCalled();
  });

  it("resolves a message permalink without a Slack call", async () => {
    const result = await resolveRefForReader(
      ctx,
      "https://acme.slack.com/archives/C123/p1700000000123456?thread_ts=1700000000.000100",
      ["message"],
      { alwaysCheckAccess: true },
    );

    expect(result).toMatchObject({
      ok: true,
      ref: { type: "message", channelId: "C123", ts: "1700000000.123456" },
    });
    expect(checkFileAccess).not.toHaveBeenCalled();
  });

  it("redirects a message permalink passed where a file is expected, without a Slack call", async () => {
    const result = await resolveRefForReader(
      ctx,
      "https://acme.slack.com/archives/C123/p1700000000123456",
      ["canvas"],
      { alwaysCheckAccess: true },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(parseToolResult(result.error).error).toBe(
      '"C123:1700000000.123456" is a Slack message: use fetch_slack_message',
    );
    expect(checkFileAccess).not.toHaveBeenCalled();
  });

  it("uses a registered file for its kind with no call when access need not be checked", async () => {
    const ref = registered("F0456ABC");
    refs.set(ref.id, ref);

    const result = await resolveRefForReader(ctx, "F0456ABC", ["list"], {
      alwaysCheckAccess: false,
    });

    expect(result).toEqual({ ok: true, ref });
    expect(checkFileAccess).not.toHaveBeenCalled();
  });

  it("refuses a registered inaccessible file with no call", async () => {
    refs.set("F0456ABC", registered("F0456ABC", { kind: "file", inaccessible: true }));

    const result = await resolveRefForReader(ctx, "F0456ABC", ["file"], {
      alwaysCheckAccess: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(parseToolResult(result.error).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
    expect(checkFileAccess).not.toHaveBeenCalled();
  });

  it("still checks access on a registered file when asked to, and returns the verdict", async () => {
    const ref = registered("F0456ABC");
    refs.set(ref.id, ref);
    allow(LIST_FACTS, "read");

    const result = await resolveRefForReader(ctx, "F0456ABC", ["list"], {
      alwaysCheckAccess: true,
    });

    expect(checkFileAccess).toHaveBeenCalledWith(
      { client, userId: "U1", role: "member", session: ctx.session },
      "F0456ABC",
    );
    expect(result).toMatchObject({ ok: true, ref, access: { allowed: true, botAccess: "read" } });
  });

  it("refuses a registered file whose fresh check denies", async () => {
    refs.set("F0456ABC", registered("F0456ABC"));
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const result = await resolveRefForReader(ctx, "F0456ABC", ["list"], {
      alwaysCheckAccess: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(parseToolResult(result.error).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
  });

  it("resolves and registers an unregistered file from the verdict's facts", async () => {
    allow(IMAGE_FACTS);

    const result = await resolveRefForReader(ctx, "F0IMAGE01", ["image"], {
      alwaysCheckAccess: false,
    });

    expect(checkFileAccess).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      ref: { type: "file", id: "F0IMAGE01", kind: "image", name: "shot.png" },
    });
    expect(refs.get("F0IMAGE01")).toMatchObject({
      kind: "image",
      reader: "view_slack_file",
      fromCurrentMessage: false,
      facts: IMAGE_FACTS,
    });
  });

  it("refuses an unregistered file the requester cannot see and registers nothing", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const result = await resolveRefForReader(ctx, "F0456ABC", ["list"], {
      alwaysCheckAccess: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(parseToolResult(result.error).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
    expect(refs.size).toBe(0);
  });

  it("redirects a file of another kind to its reader", async () => {
    allow(LIST_FACTS);

    const result = await resolveRefForReader(ctx, "F0456ABC", ["image", "document", "file"], {
      alwaysCheckAccess: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(parseToolResult(result.error).error).toBe('"F0456ABC" is a Slack List: use read_list');
  });

  it("redirects an image to view_slack_file", async () => {
    allow(IMAGE_FACTS);

    const result = await resolveRefForReader(ctx, "F0IMAGE01", ["canvas"], {
      alwaysCheckAccess: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(parseToolResult(result.error).error).toBe(
      '"F0IMAGE01" is an Image: use view_slack_file',
    );
  });

  it("returns the item id a List URL names", async () => {
    allow(LIST_FACTS);

    const result = await resolveRefForReader(
      ctx,
      "https://acme.slack.com/lists/T0123/F0456ABC?record_id=Rec789",
      ["list"],
      { alwaysCheckAccess: true },
    );

    expect(result).toMatchObject({ ok: true, ref: { id: "F0456ABC" }, itemId: "Rec789" });
  });

  it("classifies with the live reader gates", async () => {
    ctx = { ...ctx, config: stub<ReaderContext["config"]>({ repositories: [] }) };
    allow(CANVAS_FACTS);

    const result = await resolveRefForReader(ctx, "F0456ABC", ["file"], {
      alwaysCheckAccess: false,
    });

    expect(result).toMatchObject({ ok: true, ref: { kind: "file" } });
  });

  it("errors without a Slack client when a file must be checked", async () => {
    ctx = { ...ctx, slackClient: undefined };

    const result = await resolveRefForReader(ctx, "F0456ABC", ["list"], {
      alwaysCheckAccess: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(parseToolResult(result.error).error).toMatch(/Slack client is not available/);
    expect(checkFileAccess).not.toHaveBeenCalled();
  });
});
