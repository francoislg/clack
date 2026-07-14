import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk, type ClackSdk, type ClackSdkMemory, type MemoryEntry } from "../../sdk.js";
import { createMemorySurface } from "../../sdkMemory.js";
import { en as idlerEn, fr as idlerFr } from "../i18n/strings.js";
import { createListTopIdeasTool, createReprioritizeTool, createUpsertIdeaTool } from "./ideas.js";
import { idlerSlotSchema } from "../slice.js";
import {
  createClearActivityTool,
  createReadActivityTool,
  createRecordActivityTool,
} from "./activity.js";
import { createAddRepoTool, createClearIdeaTool, createSetConfigTool } from "./management.js";
import { loadConfig } from "../config.js";
import {
  createReadFetchInstructionsTool,
  createUpdateFetchInstructionsTool,
} from "./instructionsAdmin.js";
import { DEFAULT_FETCH_INSTRUCTIONS } from "../fetchInstructions.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function isToolCallResult(value: object): value is ToolCallResult {
  return "content" in value && Array.isArray((value as { content: unknown }).content);
}

interface IdeaLite {
  id: string;
  priority: number;
  updatedAt?: string;
  overdue?: boolean;
  staleAfter?: { date?: string };
}
interface ParsedTool {
  ok?: boolean;
  id?: string;
  priority?: number;
  error?: string;
  ideas?: IdeaLite[];
  entryCount?: number;
  content?: string;
}

function parseTool(text: string): ParsedTool {
  const obj: unknown = JSON.parse(text);
  if (typeof obj !== "object" || obj === null) return {};
  const c = obj as {
    ok?: unknown;
    id?: unknown;
    priority?: unknown;
    error?: unknown;
    ideas?: unknown;
    entries?: unknown;
    content?: unknown;
  };
  const out: ParsedTool = {};
  if (typeof c.ok === "boolean") out.ok = c.ok;
  if (typeof c.id === "string") out.id = c.id;
  if (typeof c.priority === "number") out.priority = c.priority;
  if (typeof c.error === "string") out.error = c.error;
  if (typeof c.content === "string") out.content = c.content;
  if (Array.isArray(c.ideas)) {
    out.ideas = c.ideas.map((i) => {
      const e = i as {
        id?: unknown;
        priority?: unknown;
        updatedAt?: unknown;
        overdue?: unknown;
        staleAfter?: unknown;
      };
      return {
        id: typeof e.id === "string" ? e.id : "",
        priority: typeof e.priority === "number" ? e.priority : 0,
        updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : undefined,
        overdue: typeof e.overdue === "boolean" ? e.overdue : undefined,
        staleAfter:
          e.staleAfter && typeof e.staleAfter === "object"
            ? (e.staleAfter as { date?: string })
            : undefined,
      };
    });
  }
  if (Array.isArray(c.entries)) out.entryCount = c.entries.length;
  return out;
}

/**
 * A stateful in-memory `sdk.memory`, built from the real surface over a Map so the idler tools are
 * exercised end-to-end (incl. the `data(schema)` namespace path) without the global registry.
 */
function statefulMemory(): ClackSdkMemory {
  const store = new Map<string, MemoryEntry>();
  const createdAtBase = "2026-01-01T00:00:00.000Z";
  const clockBase = Date.parse(createdAtBase);
  let writes = 0;
  // Every write advances updatedAt monotonically (and touch:false preserves it), mirroring the
  // real registry so the coldest-rotation and overdue assertions have strictly-increasing stamps.
  const nextTs = (): string => new Date(clockBase + ++writes * 1000).toISOString();
  return createMemorySurface(
    {
      async getMemory(id) {
        return store.get(id) ?? null;
      },
      async listMemory() {
        return [...store.values()];
      },
      async searchMemory(args) {
        const all = [...store.values()];
        const limit = args.limit ?? 20;
        const offset = args.offset ?? 0;
        return { total: all.length, limit, offset, entries: all };
      },
      async rememberCore(input) {
        const ex = store.get(input.id);
        const entry: MemoryEntry = {
          id: input.id,
          what: input.what ?? ex?.what ?? "",
          why: input.why ?? ex?.why ?? "",
          staleAfter: input.staleAfter ?? ex?.staleAfter,
          nextSteps: input.nextSteps ?? ex?.nextSteps,
          references: input.references ?? ex?.references ?? [],
          linkedMemories: input.linkedMemories ?? ex?.linkedMemories ?? [],
          createdAt: ex?.createdAt ?? createdAtBase,
          updatedAt: nextTs(),
          ...(ex?.plugins ? { plugins: ex.plugins } : {}),
        };
        store.set(input.id, entry);
        return { entry, previous: ex };
      },
      async getMemoryNamespace(plugin, id) {
        return store.get(id)?.plugins?.[plugin] ?? null;
      },
      async mergeMemoryNamespace(plugin, id, partial, opts) {
        const base = store.get(id);
        if (!base) throw new Error(`no memory entry for id "${id}"`);
        const prev = base.plugins?.[plugin] ?? {};
        store.set(id, {
          ...base,
          updatedAt: opts?.touch === false ? base.updatedAt : nextTs(),
          plugins: { ...base.plugins, [plugin]: { ...prev, ...partial } },
        });
      },
      registerBeforeExpire() {},
    },
    "idler",
    () => {},
  );
}

function buildSdk(tempDir: string, memory?: ClackSdkMemory): ClackSdk {
  const { sdk } = createClackSdk("idler", tempDir, {
    getSlackClient: () => null,
    loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
    openDmChannel: async () => null,
    clackQuery: emptyClackQuery,
    requestSoftRestart: () => {},
  });
  sdk.registerDictionary({ en: idlerEn, fr: idlerFr });
  if (memory) (sdk as { memory: ClackSdkMemory }).memory = memory;
  return sdk;
}

async function invoke<Args>(
  tool: { handler: (args: Args, extra?: never) => Promise<object> },
  args: Args,
): Promise<ParsedTool> {
  const result = await tool.handler(args);
  if (!isToolCallResult(result)) {
    throw new Error(`non-ToolCallResult: ${JSON.stringify(result)}`);
  }
  return parseTool(result.content[0]?.text ?? "{}");
}

type UpsertArgs = Parameters<ReturnType<typeof createUpsertIdeaTool>["handler"]>[0];
type CfgArgs = Parameters<ReturnType<typeof createSetConfigTool>["handler"]>[0];
type ListTopArgs = Parameters<ReturnType<typeof createListTopIdeasTool>["handler"]>[0];

/** Fill the zod-optional list_top_ideas keys with undefined to satisfy the exact arg type. */
function topArgs(o: Partial<ListTopArgs> = {}): ListTopArgs {
  return { limit: o.limit, sort_by: o.sort_by };
}

/** Fill the zod-optional keys with undefined so the handler's exact arg type is satisfied. */
function ideaArgs(o: Partial<UpsertArgs> & { id: string; kind: UpsertArgs["kind"] }): UpsertArgs {
  return {
    id: o.id,
    kind: o.kind,
    ignore: o.ignore,
    what: o.what,
    why: o.why,
    whereWeAre: o.whereWeAre,
    nextSteps: o.nextSteps,
    staleAfter: o.staleAfter,
    open: o.open,
    freshInput: o.freshInput,
    blocked: o.blocked,
    references: o.references,
    cursors: o.cursors,
  };
}

function cfgArgs(o: Partial<CfgArgs>): CfgArgs {
  return {
    enabled: o.enabled,
    reportingChannel: o.reportingChannel,
    tickUpdates: o.tickUpdates,
    summary: o.summary,
    summaryHour: o.summaryHour,
    maxActionsPerFire: o.maxActionsPerFire,
    maxActionsPerNight: o.maxActionsPerNight,
    syncEveryHours: o.syncEveryHours,
    trackerSource: o.trackerSource,
    ownPrsSource: o.ownPrsSource,
  };
}

describe("idler memory tools", () => {
  let tempDir: string;
  let sdk: ClackSdk;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idler-tools-"));
    sdk = buildSdk(tempDir, statefulMemory());
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("upsert_idea creates a unit and computes priority from kind", async () => {
    const payload = await invoke(
      createUpsertIdeaTool(sdk),
      ideaArgs({ id: "sentry:PROJ-1", kind: "continue", what: "Fix NPE" }),
    );
    assert.equal(payload.ok, true);
    assert.equal(payload.id, "sentry:PROJ-1");
    assert.equal(typeof payload.priority, "number");
  });

  it("upsert_idea dedups by id and list_top_ideas returns it once, sorted", async () => {
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "A", kind: "review" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "A", kind: "continue" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "B", kind: "triage" }));

    const payload = await invoke(createListTopIdeasTool(sdk), topArgs({ limit: 5 }));
    assert.equal(payload.ideas?.length, 2, "A deduped");
    assert.equal(payload.ideas?.[0].id, "A", "continue (highest) sorts first");
  });

  it("upsert_idea open:false closes; list_top_ideas excludes it", async () => {
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "A", kind: "implement" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "A", kind: "none", open: false }));
    const payload = await invoke(createListTopIdeasTool(sdk), topArgs());
    assert.equal(payload.ideas?.length, 0);
  });

  it("reprioritize_idea overrides the computed score", async () => {
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "A", kind: "review" }));
    await invoke(createReprioritizeTool(sdk), { id: "A", priority: 9999 });
    const payload = await invoke(createListTopIdeasTool(sdk), topArgs());
    assert.equal(payload.ideas?.[0].priority, 9999);
  });

  it("reprioritize_idea errors on unknown id", async () => {
    const payload = await invoke(createReprioritizeTool(sdk), { id: "nope", priority: 1 });
    assert.ok(payload.error);
  });

  it("upsert_idea ignore snapshots ignoredAt and excludes the entry from list_top_ideas", async () => {
    await sdk.memory.remember({ id: "note:x", what: "a user preference" });
    const before = await sdk.memory.get("note:x");

    const payload = await invoke(
      createUpsertIdeaTool(sdk),
      ideaArgs({ id: "note:x", kind: undefined, ignore: true }),
    );
    assert.equal(payload.ok, true);

    const slot = await sdk.memory.data(idlerSlotSchema).get("note:x");
    assert.equal(slot?.ignoredAt, before?.updatedAt, "ignoredAt snapshots updatedAt");
    assert.equal(slot?.open, false);

    const top = await invoke(createListTopIdeasTool(sdk), topArgs());
    assert.equal(top.ideas?.length, 0, "ignored entry is not an open unit");
  });

  it("upsert_idea ignore errors when no memory entry exists", async () => {
    const payload = await invoke(
      createUpsertIdeaTool(sdk),
      ideaArgs({ id: "ghost", kind: undefined, ignore: true }),
    );
    assert.ok(payload.error);
  });

  it("upsert_idea requires kind unless ignoring", async () => {
    await sdk.memory.remember({ id: "note:y", what: "note" });
    const payload = await invoke(
      createUpsertIdeaTool(sdk),
      ideaArgs({ id: "note:y", kind: undefined }),
    );
    assert.ok(payload.error);
  });

  it("adopting a previously-ignored entry clears ignoredAt and opens the unit", async () => {
    await sdk.memory.remember({ id: "note:z", what: "actionable after all" });
    await invoke(
      createUpsertIdeaTool(sdk),
      ideaArgs({ id: "note:z", kind: undefined, ignore: true }),
    );
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "note:z", kind: "triage" }));

    const slot = await sdk.memory.data(idlerSlotSchema).get("note:z");
    assert.equal(slot?.ignoredAt, undefined, "adopt clears the ignore marker");

    const top = await invoke(createListTopIdeasTool(sdk), topArgs());
    assert.equal(top.ideas?.length, 1);
    assert.equal(top.ideas?.[0].id, "note:z");
  });

  it("clear_idler_idea closes the unit and errors on unknown id", async () => {
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "A", kind: "review" }));
    const cleared = await invoke(createClearIdeaTool(sdk), { key: "A" });
    assert.equal(cleared.ok, true);
    const top = await invoke(createListTopIdeasTool(sdk), topArgs());
    assert.equal(top.ideas?.length, 0, "cleared unit is closed");

    const missing = await invoke(createClearIdeaTool(sdk), { key: "missing" });
    assert.ok(missing.error);
  });

  it("list_top_ideas sort_by coldest returns oldest-updatedAt first", async () => {
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "first", kind: "review" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "second", kind: "review" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "third", kind: "review" }));

    const payload = await invoke(createListTopIdeasTool(sdk), topArgs({ sort_by: "coldest" }));
    assert.deepEqual(
      payload.ideas?.map((i) => i.id),
      ["first", "second", "third"],
    );
  });

  it("list_top_ideas surfaces updatedAt, staleAfter, and a computed overdue flag", async () => {
    await invoke(
      createUpsertIdeaTool(sdk),
      ideaArgs({ id: "past", kind: "review", staleAfter: { date: "2000-01-01T00:00:00.000Z" } }),
    );
    await invoke(
      createUpsertIdeaTool(sdk),
      ideaArgs({ id: "future", kind: "review", staleAfter: { date: "2999-01-01T00:00:00.000Z" } }),
    );
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "none", kind: "review" }));

    const payload = await invoke(createListTopIdeasTool(sdk), topArgs());
    const byId = new Map((payload.ideas ?? []).map((i) => [i.id, i]));
    assert.equal(byId.get("past")?.overdue, true, "past staleAfter is overdue");
    assert.equal(typeof byId.get("past")?.updatedAt, "string", "updatedAt is surfaced");
    assert.equal(byId.get("past")?.staleAfter?.date, "2000-01-01T00:00:00.000Z");
    assert.equal(byId.get("future")?.overdue, false, "future staleAfter is not overdue");
    assert.equal(byId.get("none")?.overdue, false, "no staleAfter is not overdue");
    assert.equal(byId.get("none")?.staleAfter, undefined, "absent staleAfter is omitted");
  });

  it("list_top_ideas defaults to priority-descending order", async () => {
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "lo", kind: "review" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "hi", kind: "continue" }));

    const payload = await invoke(createListTopIdeasTool(sdk), topArgs());
    assert.equal(payload.ideas?.[0].id, "hi", "continue outranks review under the default order");
  });

  it("re-verifying a unit rotates it to the back of the coldest order", async () => {
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "a", kind: "review" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "b", kind: "review" }));

    const before = await invoke(createListTopIdeasTool(sdk), topArgs({ sort_by: "coldest" }));
    assert.equal(before.ideas?.[0].id, "a", "a is coldest initially");

    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "a", kind: "review" }));
    const after = await invoke(createListTopIdeasTool(sdk), topArgs({ sort_by: "coldest" }));
    assert.equal(after.ideas?.[0].id, "b", "a rotated to the back after re-verification");
  });

  it("a parked (blocked) unit sorts below a workable one", async () => {
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ id: "workable", kind: "continue" }));
    await invoke(
      createUpsertIdeaTool(sdk),
      ideaArgs({ id: "parked", kind: "continue", blocked: true }),
    );

    const payload = await invoke(createListTopIdeasTool(sdk), topArgs({ limit: 1 }));
    assert.equal(payload.ideas?.length, 1);
    assert.equal(payload.ideas?.[0].id, "workable", "parked unit falls outside the top-1 window");
  });
});

describe("idler activity tools", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idler-activity-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("record_activity appends, read_activity returns entries, clear_activity empties", async () => {
    const sdk = buildSdk(tempDir);
    await invoke(createRecordActivityTool(sdk), {
      kind: "pr_opened",
      detail: "PR #1",
      unitKey: undefined,
    });
    await invoke(createRecordActivityTool(sdk), {
      kind: "review",
      detail: "reviewed",
      unitKey: undefined,
    });

    const read = await invoke(createReadActivityTool(sdk), {});
    assert.equal(read.entryCount, 2);

    await invoke(createClearActivityTool(sdk), {});
    const after = await invoke(createReadActivityTool(sdk), {});
    assert.equal(after.entryCount, 0);
  });
});

describe("idler management tools", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idler-mgmt-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("set_idler_config enables and add_idler_repo allowlists a repo", async () => {
    const sdk = buildSdk(tempDir);
    const enabled = await invoke(createSetConfigTool(sdk), cfgArgs({ enabled: true }));
    assert.equal(enabled.ok, true);
    const repo = await invoke(createAddRepoTool(sdk), { repo: "my-repo" });
    assert.equal(repo.ok, true);
  });

  it("set_idler_config patches the reporting block with omit-to-keep semantics", async () => {
    const sdk = buildSdk(tempDir);

    const first = await invoke(
      createSetConfigTool(sdk),
      cfgArgs({ reportingChannel: "C777", tickUpdates: "optional", summary: false }),
    );
    assert.equal(first.ok, true);

    let config = await loadConfig(sdk);
    assert.equal(config.reporting.channel, "C777");
    assert.equal(config.reporting.tickUpdates, "optional");
    assert.equal(config.reporting.summary, false);

    await invoke(createSetConfigTool(sdk), cfgArgs({ summaryHour: 6 }));
    config = await loadConfig(sdk);
    assert.equal(config.reporting.summaryHour, 6);
    assert.equal(config.reporting.channel, "C777");
    assert.equal(config.reporting.tickUpdates, "optional");
    assert.equal(config.reporting.summary, false);
  });
});

describe("idler fetch-instructions tools", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idler-fetch-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("read returns the shipped default when never edited", async () => {
    const sdk = buildSdk(tempDir);
    const payload = await invoke(createReadFetchInstructionsTool(sdk), {});
    assert.equal(payload.content, DEFAULT_FETCH_INSTRUCTIONS);
  });

  it("update overwrites the file; read returns the new content", async () => {
    const sdk = buildSdk(tempDir);
    const updated = await invoke(createUpdateFetchInstructionsTool(sdk), {
      content: "# Custom sourcing\nLook at #bugs only.",
    });
    assert.equal(updated.ok, true);

    const payload = await invoke(createReadFetchInstructionsTool(sdk), {});
    assert.equal(payload.content, "# Custom sourcing\nLook at #bugs only.");
  });
});
