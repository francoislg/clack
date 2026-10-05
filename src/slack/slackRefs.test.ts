import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { checkFileAccess, type AccessRequest, type FileFacts } from "./requesterAccess.js";
import {
  classifyFile,
  isImageFile,
  mergeRefs,
  parseSlackRef,
  parseSlackRefs,
  resolveRefsInto,
  resolveSlackRefs,
  type ReaderGates,
  type SlackRef,
} from "./slackRefs.js";
import type { SlackFileBase } from "./slackFileBase.js";
import { createSlackClientMock } from "./testSlackClient.js";

vi.mock("./requesterAccess.js", () => ({ checkFileAccess: vi.fn() }));

const ALL_ON: ReaderGates = { listsMode: "read", canvasesMode: "read" };
const LIST_FACTS: FileFacts = {
  filetype: "list",
  prettyType: "List",
  mimetype: "application/vnd.slack-list",
  name: "Groceries",
};
const CANVAS_FACTS: FileFacts = {
  filetype: "quip",
  prettyType: "Canvas",
  mimetype: "application/vnd.slack-docs",
  name: "Infrastructure_TODO",
};

function makeRequest(): AccessRequest {
  return { client: createSlackClientMock(), userId: "U_ALICE", role: "member" };
}

function allow(facts: FileFacts) {
  return { allowed: true as const, botAccess: "read" as const, creator: "U_BOB", facts };
}

function attached(overrides: Partial<SlackFileBase> = {}): SlackFileBase {
  return {
    id: "F0IMAGE01",
    name: "shot.png",
    mimetype: "image/png",
    size: 1024,
    url_private: "https://files.slack.com/files-pri/T1-F0IMAGE01/shot.png",
    ...overrides,
  };
}

describe("parseSlackRef", () => {
  it("parses a bare file id", () => {
    expect(parseSlackRef("  F09SBU6D3FV ")).toEqual({ type: "file", fileId: "F09SBU6D3FV" });
  });

  it("parses a /files/ URL", () => {
    expect(parseSlackRef("https://acme.slack.com/files/U123/F0ABC1234/report.pdf")).toEqual({
      type: "file",
      fileId: "F0ABC1234",
    });
  });

  it("parses a /lists/ URL and keeps record_id as the item id", () => {
    expect(parseSlackRef("https://acme.slack.com/lists/T0123/F0456ABC?record_id=Rec789")).toEqual({
      type: "file",
      fileId: "F0456ABC",
      itemId: "Rec789",
    });
  });

  it("parses a /docs/ URL", () => {
    expect(parseSlackRef("https://example.slack.com/docs/T0123/F09SBU6D3FV")).toEqual({
      type: "file",
      fileId: "F09SBU6D3FV",
    });
  });

  it("parses a /canvas/ URL", () => {
    expect(parseSlackRef("https://acme.slack.com/canvas/F09SBU6D3FV")).toEqual({
      type: "file",
      fileId: "F09SBU6D3FV",
    });
  });

  it("parses a message permalink with thread_ts", () => {
    expect(
      parseSlackRef(
        "https://acme.slack.com/archives/C123/p1700000000123456?thread_ts=1700000000.000100",
      ),
    ).toEqual({
      type: "message",
      channelId: "C123",
      ts: "1700000000.123456",
      threadTs: "1700000000.000100",
    });
  });

  it("parses a DM permalink without thread_ts", () => {
    expect(parseSlackRef("https://acme.slack.com/archives/D0EXAMPLE04/p1700000000123456")).toEqual({
      type: "message",
      channelId: "D0EXAMPLE04",
      ts: "1700000000.123456",
    });
  });

  it("parses a URL inside Slack link markup", () => {
    expect(parseSlackRef("<https://acme.slack.com/canvas/F09SBU6D3FV|Plan>")).toEqual({
      type: "file",
      fileId: "F09SBU6D3FV",
    });
  });

  it("ignores a record_id of the wrong shape", () => {
    expect(parseSlackRef("https://acme.slack.com/lists/T0123/F0456ABC?record_id=789abc")).toEqual({
      type: "file",
      fileId: "F0456ABC",
    });
  });

  it("ignores a canvas URL's query string and trailing path", () => {
    expect(
      parseSlackRef("https://acme.slack.com/docs/T0123/F0456ABC?focus_section_id=temp"),
    ).toEqual({ type: "file", fileId: "F0456ABC" });
    expect(parseSlackRef("https://acme.slack.com/canvas/F0456ABC/edit")).toEqual({
      type: "file",
      fileId: "F0456ABC",
    });
  });

  it("rejects non-Slack hosts, unknown paths and short ids", () => {
    expect(parseSlackRef("https://example.com/canvas/F09SBU6D3FV")).toBeUndefined();
    expect(parseSlackRef("https://notslack.com/canvas/F0456ABC")).toBeUndefined();
    expect(parseSlackRef("https://example.com/lists/T0123/F0456ABC")).toBeUndefined();
    expect(parseSlackRef("https://acme.slack.com/team/U123")).toBeUndefined();
    expect(parseSlackRef("F1")).toBeUndefined();
    expect(parseSlackRef("https://acme.slack.com/archives/C123/p123")).toBeUndefined();
  });

  it("rejects an empty value, a channel id and plain words", () => {
    expect(parseSlackRef("")).toBeUndefined();
    expect(parseSlackRef("C0456ABC")).toBeUndefined();
    expect(parseSlackRef("hello world")).toBeUndefined();
  });
});

describe("parseSlackRefs", () => {
  it("finds a bare id in a DM", () => {
    expect(parseSlackRefs("F09SBU6D3FV")).toEqual([{ type: "file", fileId: "F09SBU6D3FV" }]);
  });

  it("finds a List URL in Slack link markup", () => {
    expect(
      parseSlackRefs(
        "see <https://acme.slack.com/lists/T0123/F0456ABC?record_id=Rec789|Groceries>",
      ),
    ).toEqual([{ type: "file", fileId: "F0456ABC", itemId: "Rec789" }]);
  });

  it("finds a plain permalink with &amp;-escaped query and trailing punctuation", () => {
    expect(
      parseSlackRefs(
        "look at https://acme.slack.com/archives/C123/p1700000000123456?thread_ts=1700000000.000100&amp;cid=C123.",
      ),
    ).toEqual([
      {
        type: "message",
        channelId: "C123",
        ts: "1700000000.123456",
        threadTs: "1700000000.000100",
      },
    ]);
  });

  it("keeps references in order of appearance", () => {
    expect(
      parseSlackRefs("first F0BSE12AF7Z then <https://acme.slack.com/canvas/F09SBU6D3FV>"),
    ).toEqual([
      { type: "file", fileId: "F0BSE12AF7Z" },
      { type: "file", fileId: "F09SBU6D3FV" },
    ]);
  });

  it("ignores words that only look like ids", () => {
    expect(
      parseSlackRefs("Read the FAQ, then xF1y and F1 and XF09SBU6D3FV and F09SBU6D3FVx"),
    ).toEqual([]);
  });

  it("ignores ids inside non-Slack URLs", () => {
    expect(parseSlackRefs("https://example.com/F09SBU6D3FV")).toEqual([]);
  });

  it("dedupes the same file across forms", () => {
    expect(
      parseSlackRefs("F09SBU6D3FV and https://acme.slack.com/canvas/F09SBU6D3FV and F09SBU6D3FV"),
    ).toEqual([{ type: "file", fileId: "F09SBU6D3FV" }]);
  });

  it("caps at 10 distinct references and logs how many were dropped", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => false);
    const ids = Array.from({ length: 12 }, (_, i) => `F0000000${String(i).padStart(2, "0")}`);
    const refs = parseSlackRefs([...ids, ids[0]].join(" "));

    expect(refs).toEqual(ids.slice(0, 10).map((fileId) => ({ type: "file", fileId })));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 2"));
  });
});

describe("classifyFile", () => {
  it("classifies a List", () => {
    expect(classifyFile(LIST_FACTS, ALL_ON)).toEqual({
      kind: "list",
      label: "Slack List",
      reader: "read_list",
      mustOpen: false,
    });
  });

  it("classifies a canvas", () => {
    expect(classifyFile(CANVAS_FACTS, ALL_ON)).toMatchObject({
      kind: "canvas",
      reader: "read_canvas",
      mustOpen: false,
    });
  });

  it("falls a List through to file when lists are off", () => {
    expect(classifyFile(LIST_FACTS, { ...ALL_ON, listsMode: "off" })).toEqual({
      kind: "file",
      label: "List",
      reader: "view_slack_file",
      mustOpen: false,
    });
  });

  it("falls a canvas through to file when canvases are off", () => {
    expect(classifyFile(CANVAS_FACTS, { ...ALL_ON, canvasesMode: "off" })).toMatchObject({
      kind: "file",
      reader: "view_slack_file",
    });
  });

  it("classifies an image as must-open", () => {
    expect(classifyFile({ mimetype: "image/png" }, ALL_ON)).toMatchObject({
      kind: "image",
      reader: "view_slack_file",
      mustOpen: true,
    });
  });

  it.each(["application/pdf", "text/plain", "application/json"])(
    "classifies %s as a must-open document",
    (mimetype) => {
      expect(classifyFile({ mimetype }, ALL_ON)).toMatchObject({
        kind: "document",
        reader: "view_slack_file",
        mustOpen: true,
      });
    },
  );

  it("labels an unknown type with its pretty_type", () => {
    expect(
      classifyFile(
        { filetype: "workflow", prettyType: "Workflow", mimetype: "application/x-wf" },
        ALL_ON,
      ),
    ).toEqual({ kind: "file", label: "Workflow", reader: "view_slack_file", mustOpen: false });
  });

  it("labels an unknown type with its mimetype when pretty_type is absent", () => {
    expect(classifyFile({ mimetype: "application/zip" }, ALL_ON)).toMatchObject({
      kind: "file",
      label: "application/zip",
    });
  });
});

describe("isImageFile", () => {
  it("matches image mimetypes only", () => {
    expect(isImageFile({ mimetype: "image/jpeg" })).toBe(true);
    expect(isImageFile({ mimetype: "application/pdf" })).toBe(false);
  });
});

describe("resolveSlackRefs", () => {
  let req: AccessRequest;

  beforeEach(() => {
    req = makeRequest();
    vi.mocked(checkFileAccess).mockReset();
  });

  it("classifies attached files without a Slack call", async () => {
    const refs = await resolveSlackRefs(req, {
      files: [
        attached(),
        attached({ id: "F0BIG0001", size: 30 * 1024 * 1024, unavailable: "too_large" }),
      ],
      fromCurrentMessage: true,
      gates: ALL_ON,
    });

    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(refs).toMatchObject([
      { type: "file", id: "F0IMAGE01", kind: "image", name: "shot.png", fromCurrentMessage: true },
      { type: "file", id: "F0BIG0001", tooLarge: true },
    ]);
  });

  it("classifies an attached canvas from its own filetype", async () => {
    const refs = await resolveSlackRefs(req, {
      files: [
        attached({
          id: "F09SBU6D3FV",
          name: "Infrastructure_TODO",
          mimetype: "application/vnd.slack-docs",
          filetype: "quip",
          pretty_type: "Canvas",
        }),
      ],
      fromCurrentMessage: false,
      gates: ALL_ON,
    });
    expect(refs).toMatchObject([{ kind: "canvas", reader: "read_canvas" }]);
  });

  it("names a canvas resolved from text by its title", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue(
      allow({ filetype: "quip", name: "Infrastructure_TODO", title: "Infrastructure TODO" }),
    );
    const refs = await resolveSlackRefs(req, {
      text: "F09SBU6D3FV",
      fromCurrentMessage: true,
      gates: ALL_ON,
    });
    expect(refs).toMatchObject([{ kind: "canvas", name: "Infrastructure TODO" }]);
  });

  it("names an attached List by its title", async () => {
    const refs = await resolveSlackRefs(req, {
      files: [
        attached({
          id: "F0BSE12AF7Z",
          name: "Infra_tasks",
          title: "Infra tasks",
          mimetype: "application/vnd.slack-list",
          filetype: "list",
        }),
      ],
      fromCurrentMessage: true,
      gates: ALL_ON,
    });
    expect(refs).toMatchObject([{ kind: "list", name: "Infra tasks" }]);
  });

  it("keeps an attached image's file name over its title", async () => {
    const refs = await resolveSlackRefs(req, {
      files: [attached({ title: "Screenshot of the dashboard" })],
      fromCurrentMessage: true,
      gates: ALL_ON,
    });
    expect(refs).toMatchObject([{ kind: "image", name: "shot.png" }]);
  });

  it.each([
    ["application/vnd.slack-docs", "canvas", "read_canvas"],
    ["application/vnd.slack-list", "list", "read_list"],
  ])(
    "classifies an attachment with mimetype %s and no filetype as %s",
    async (mimetype, kind, reader) => {
      const refs = await resolveSlackRefs(req, {
        files: [attached({ id: "F0NOFTYPE", name: "untyped", mimetype })],
        fromCurrentMessage: true,
        gates: ALL_ON,
      });
      expect(refs).toMatchObject([{ kind, reader }]);
    },
  );

  it("resolves a text ref through checkFileAccess and classifies it from the facts", async () => {
    const access = allow(LIST_FACTS);
    vi.mocked(checkFileAccess).mockResolvedValue(access);

    const refs = await resolveSlackRefs(req, {
      text: "Can you read this list: F0BSE12AF7Z",
      fromCurrentMessage: true,
      gates: ALL_ON,
    });

    expect(checkFileAccess).toHaveBeenCalledWith(req, "F0BSE12AF7Z");
    expect(refs).toEqual([
      {
        type: "file",
        id: "F0BSE12AF7Z",
        kind: "list",
        label: "Slack List",
        reader: "read_list",
        mustOpen: false,
        name: "Groceries",
        facts: access.facts,
        fromCurrentMessage: true,
      },
    ]);
  });

  it("keeps a List URL's item id", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue(allow(LIST_FACTS));
    const refs = await resolveSlackRefs(req, {
      text: "<https://acme.slack.com/lists/T0123/F0456ABC?record_id=Rec789|Groceries>",
      fromCurrentMessage: false,
      gates: ALL_ON,
    });
    expect(refs).toMatchObject([{ id: "F0456ABC", itemId: "Rec789" }]);
  });

  it("makes a denied text ref inaccessible with no name or facts", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const [ref] = await resolveSlackRefs(req, {
      text: "F0SECRET01",
      fromCurrentMessage: true,
      gates: ALL_ON,
    });

    expect(ref).toMatchObject({ type: "file", id: "F0SECRET01", kind: "file", inaccessible: true });
    expect(ref).not.toHaveProperty("name");
    expect(ref).not.toHaveProperty("facts");
  });

  it("makes exactly one checkFileAccess call per distinct text ref", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue(allow({ mimetype: "application/pdf" }));

    await resolveSlackRefs(req, {
      text: "F0AAAAAA1 F0BBBBBB2 F0AAAAAA1 https://acme.slack.com/files/U1/F0BBBBBB2/a.pdf",
      fromCurrentMessage: true,
      gates: ALL_ON,
    });

    expect(checkFileAccess).toHaveBeenCalledTimes(2);
    expect(checkFileAccess).toHaveBeenCalledWith(req, "F0AAAAAA1");
    expect(checkFileAccess).toHaveBeenCalledWith(req, "F0BBBBBB2");
  });

  it("makes no call for a text ref an attachment covers", async () => {
    const refs = await resolveSlackRefs(req, {
      text: "here F0IMAGE01",
      files: [attached()],
      fromCurrentMessage: true,
      gates: ALL_ON,
    });

    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(refs).toHaveLength(1);
  });

  it("parses permalinks without a Slack call", async () => {
    const refs = await resolveSlackRefs(req, {
      text: "https://acme.slack.com/archives/C123/p1700000000123456",
      fromCurrentMessage: false,
      gates: ALL_ON,
    });

    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(refs).toEqual([
      {
        type: "message",
        id: "C123:1700000000.123456",
        kind: "message",
        label: "Slack message",
        reader: "fetch_slack_message",
        mustOpen: false,
        channelId: "C123",
        ts: "1700000000.123456",
        fromCurrentMessage: false,
      },
    ]);
  });

  it("resolves at most 10 text refs", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => false);
    vi.mocked(checkFileAccess).mockResolvedValue(allow({ mimetype: "image/png" }));
    const ids = Array.from({ length: 12 }, (_, i) => `F0000000${String(i).padStart(2, "0")}`);

    const refs = await resolveSlackRefs(req, {
      text: ids.join(" "),
      fromCurrentMessage: true,
      gates: ALL_ON,
    });

    expect(refs).toHaveLength(10);
    expect(checkFileAccess).toHaveBeenCalledTimes(10);
  });
});

describe("mergeRefs", () => {
  function imageRef(fromCurrentMessage: boolean): SlackRef {
    return {
      type: "file",
      id: "F0IMAGE01",
      kind: "image",
      label: "Image",
      reader: "view_slack_file",
      mustOpen: true,
      name: "shot.png",
      facts: { mimetype: "image/png" },
      fromCurrentMessage,
    };
  }

  it("keeps fromCurrentMessage true when an earlier source follows", () => {
    const map = new Map<string, SlackRef>();
    mergeRefs(map, [imageRef(true)]);
    mergeRefs(map, [imageRef(false)]);
    expect(map.get("F0IMAGE01")?.fromCurrentMessage).toBe(true);
  });

  it("upgrades to fromCurrentMessage when the current message follows", () => {
    const map = new Map<string, SlackRef>();
    mergeRefs(map, [imageRef(false)]);
    mergeRefs(map, [imageRef(true)]);
    expect(map.size).toBe(1);
    expect(map.get("F0IMAGE01")?.fromCurrentMessage).toBe(true);
  });

  it("replaces a fact-less entry with a later resolution that has facts", () => {
    const map = new Map<string, SlackRef>([
      [
        "F0IMAGE01",
        {
          type: "file",
          id: "F0IMAGE01",
          kind: "file",
          label: "Slack file",
          reader: "view_slack_file",
          mustOpen: false,
          inaccessible: true,
          fromCurrentMessage: true,
        },
      ],
    ]);
    mergeRefs(map, [imageRef(false)]);
    expect(map.get("F0IMAGE01")).toEqual({ ...imageRef(true) });
  });

  it("keeps an entry with facts over a later fact-less one", () => {
    const map = new Map<string, SlackRef>();
    mergeRefs(map, [imageRef(false)]);
    mergeRefs(map, [
      {
        type: "file",
        id: "F0IMAGE01",
        kind: "file",
        label: "Slack file",
        reader: "view_slack_file",
        mustOpen: false,
        inaccessible: true,
        fromCurrentMessage: false,
      },
    ]);
    expect(map.get("F0IMAGE01")).toEqual(imageRef(false));
  });
});

describe("resolveRefsInto", () => {
  function ref(id: string, fromCurrentMessage: boolean): SlackRef {
    return {
      type: "file",
      id,
      kind: "file",
      label: "File",
      reader: "view_slack_file",
      mustOpen: false,
      fromCurrentMessage,
    };
  }

  function makeDeps() {
    return { resolveSlackRefs: vi.fn<typeof resolveSlackRefs>() };
  }

  it("resolves each source with the gates and returns each source's refs in source order", async () => {
    const deps = makeDeps();
    const first = [ref("F0FIRST01", true)];
    const second = [ref("F0SECOND1", false)];
    deps.resolveSlackRefs.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const req = makeRequest();
    const sources = [
      { text: "one", fromCurrentMessage: true },
      { files: [attached()], fromCurrentMessage: false },
    ];

    const result = await resolveRefsInto(req, ALL_ON, sources, new Map(), deps);

    expect(result).toEqual([first, second]);
    expect(deps.resolveSlackRefs).toHaveBeenNthCalledWith(1, req, { ...sources[0], gates: ALL_ON });
    expect(deps.resolveSlackRefs).toHaveBeenNthCalledWith(2, req, { ...sources[1], gates: ALL_ON });
  });

  it("merges into the target in source order, whatever order the sources settle in", async () => {
    const deps = makeDeps();
    let settleFirst: (refs: SlackRef[]) => void = () => {};
    deps.resolveSlackRefs
      .mockReturnValueOnce(
        new Promise((resolve) => {
          settleFirst = resolve;
        }),
      )
      .mockResolvedValueOnce([ref("F0SECOND1", false)]);
    const target = new Map<string, SlackRef>();

    const pending = resolveRefsInto(
      makeRequest(),
      ALL_ON,
      [{ fromCurrentMessage: true }, { fromCurrentMessage: false }],
      target,
      deps,
    );
    await Promise.resolve();
    expect(target.size).toBe(0);
    settleFirst([ref("F0FIRST01", true)]);
    await pending;

    expect([...target.keys()]).toEqual(["F0FIRST01", "F0SECOND1"]);
  });

  it("keeps a ref current-message when any source resolved it as such", async () => {
    const deps = makeDeps();
    deps.resolveSlackRefs
      .mockResolvedValueOnce([ref("F0SHARED1", false)])
      .mockResolvedValueOnce([ref("F0SHARED1", true)]);
    const target = new Map<string, SlackRef>([["F0OLD0001", ref("F0OLD0001", false)]]);

    const result = await resolveRefsInto(
      makeRequest(),
      ALL_ON,
      [{ fromCurrentMessage: false }, { fromCurrentMessage: true }],
      target,
      deps,
    );

    expect(target.size).toBe(2);
    expect(target.get("F0SHARED1")?.fromCurrentMessage).toBe(true);
    expect(result[0]?.[0]?.fromCurrentMessage).toBe(false);
  });

  it("returns no refs and leaves the target untouched for no sources", async () => {
    const deps = makeDeps();
    const target = new Map<string, SlackRef>();
    expect(await resolveRefsInto(makeRequest(), ALL_ON, [], target, deps)).toEqual([]);
    expect(target.size).toBe(0);
    expect(deps.resolveSlackRefs).not.toHaveBeenCalled();
  });
});
