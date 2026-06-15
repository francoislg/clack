import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../../sdk.js";
import { en as idlerEn, fr as idlerFr } from "../i18n/strings.js";
import { createListTopIdeasTool, createReprioritizeTool, createUpsertIdeaTool } from "./ideas.js";
import {
  createClearActivityTool,
  createReadActivityTool,
  createRecordActivityTool,
} from "./activity.js";
import { createAddRepoTool, createClearIdeaTool, createSetConfigTool } from "./management.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function isToolCallResult(value: object): value is ToolCallResult {
  return "content" in value && Array.isArray((value as { content: unknown }).content);
}

interface IdeaLite {
  key: string;
  priority: number;
}
interface ParsedTool {
  ok?: boolean;
  key?: string;
  priority?: number;
  error?: string;
  ideas?: IdeaLite[];
  entryCount?: number;
}

function parseTool(text: string): ParsedTool {
  const obj: unknown = JSON.parse(text);
  if (typeof obj !== "object" || obj === null) return {};
  const c = obj as {
    ok?: unknown;
    key?: unknown;
    priority?: unknown;
    error?: unknown;
    ideas?: unknown;
    entries?: unknown;
  };
  const out: ParsedTool = {};
  if (typeof c.ok === "boolean") out.ok = c.ok;
  if (typeof c.key === "string") out.key = c.key;
  if (typeof c.priority === "number") out.priority = c.priority;
  if (typeof c.error === "string") out.error = c.error;
  if (Array.isArray(c.ideas)) {
    out.ideas = c.ideas.map((i) => {
      const e = i as { key?: unknown; priority?: unknown };
      return {
        key: typeof e.key === "string" ? e.key : "",
        priority: typeof e.priority === "number" ? e.priority : 0,
      };
    });
  }
  if (Array.isArray(c.entries)) out.entryCount = c.entries.length;
  return out;
}

function buildSdk(tempDir: string): ReturnType<typeof createClackSdk>["sdk"] {
  const { sdk } = createClackSdk("idler", tempDir, {
    getSlackClient: () => null,
    loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
    openDmChannel: async () => null,
    clackQuery: emptyClackQuery,
    requestSoftRestart: () => {},
  });
  sdk.registerDictionary({ en: idlerEn, fr: idlerFr });
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

/** Fill the zod-optional keys with undefined so the handler's exact arg type is satisfied. */
function ideaArgs(o: Partial<UpsertArgs> & { key: string; kind: UpsertArgs["kind"] }): UpsertArgs {
  return {
    key: o.key,
    kind: o.kind,
    source: o.source,
    what: o.what,
    whereWeAre: o.whereWeAre,
    nextSteps: o.nextSteps,
    open: o.open,
    freshInput: o.freshInput,
    blocked: o.blocked,
    references: o.references,
  };
}

function cfgArgs(o: Partial<CfgArgs>): CfgArgs {
  return {
    enabled: o.enabled,
    reportingChannel: o.reportingChannel,
    maxActionsPerFire: o.maxActionsPerFire,
    maxActionsPerNight: o.maxActionsPerNight,
    trackerSource: o.trackerSource,
    ownPrsSource: o.ownPrsSource,
  };
}

describe("idler ledger tools", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idler-tools-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("upsert_idea creates a unit and computes priority from kind", async () => {
    const sdk = buildSdk(tempDir);
    const payload = await invoke(
      createUpsertIdeaTool(sdk),
      ideaArgs({
        key: "PROJ-1",
        kind: "continue",
        source: "sentry",
        what: "Fix NPE",
      }),
    );
    assert.equal(payload.ok, true);
    assert.equal(payload.key, "PROJ-1");
    assert.equal(typeof payload.priority, "number");
  });

  it("upsert_idea dedups by key and list_top_ideas returns it once, sorted", async () => {
    const sdk = buildSdk(tempDir);
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ key: "A", kind: "review" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ key: "A", kind: "continue" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ key: "B", kind: "triage" }));

    const payload = await invoke(createListTopIdeasTool(sdk), { limit: 5 });
    assert.equal(payload.ideas?.length, 2, "A deduped");
    assert.equal(payload.ideas?.[0].key, "A", "continue (highest) sorts first");
  });

  it("upsert_idea open:false closes; list_top_ideas excludes it", async () => {
    const sdk = buildSdk(tempDir);
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ key: "A", kind: "implement" }));
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ key: "A", kind: "none", open: false }));
    const payload = await invoke(createListTopIdeasTool(sdk), { limit: undefined });
    assert.equal(payload.ideas?.length, 0);
  });

  it("reprioritize_idea overrides the computed score", async () => {
    const sdk = buildSdk(tempDir);
    await invoke(createUpsertIdeaTool(sdk), ideaArgs({ key: "A", kind: "review" }));
    await invoke(createReprioritizeTool(sdk), { key: "A", priority: 9999 });
    const payload = await invoke(createListTopIdeasTool(sdk), { limit: undefined });
    assert.equal(payload.ideas?.[0].priority, 9999);
  });

  it("reprioritize_idea errors on unknown key", async () => {
    const sdk = buildSdk(tempDir);
    const payload = await invoke(createReprioritizeTool(sdk), { key: "nope", priority: 1 });
    assert.ok(payload.error);
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

  it("clear_idler_idea errors on unknown key", async () => {
    const sdk = buildSdk(tempDir);
    const payload = await invoke(createClearIdeaTool(sdk), { key: "missing" });
    assert.ok(payload.error);
  });
});
