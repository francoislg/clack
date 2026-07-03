import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createRememberTool, type RememberToolResult } from "./remember.js";
import type { MemoryEntry } from "../../memoryRegistry.js";

interface ToolResult {
  content: { type: string; text?: string }[];
}

const rememberPayloadSchema: z.ZodType<RememberToolResult> = z.object({
  ok: z.literal(true),
  id: z.string(),
  updatedAt: z.string(),
  replaced: z.object({ previousWhatLength: z.number(), newWhatLength: z.number() }).optional(),
  warning: z.string().optional(),
});

async function invoke<A>(
  tool: { handler: (args: A, extra?: never) => Promise<ToolResult> },
  args: A,
): Promise<ToolResult> {
  return tool.handler(args);
}

function makeEntry(what: string): MemoryEntry {
  return {
    id: "note:a",
    what,
    why: "b",
    references: [],
    linkedMemories: [],
    createdAt: "t0",
    updatedAt: "t1",
  };
}

function baseArgs(what: string | undefined) {
  return {
    id: "note:a",
    what,
    why: undefined,
    staleAfter: undefined,
    nextSteps: undefined,
    references: undefined,
    linkedMemories: undefined,
  };
}

function payloadOf(result: ToolResult): z.infer<typeof rememberPayloadSchema> {
  return rememberPayloadSchema.parse(JSON.parse(result.content[0].text ?? "{}"));
}

describe("remember tool", () => {
  it("calls rememberCore with the args and reports id + updatedAt", async () => {
    const entry = makeEntry("a");
    const rememberCore = vi.fn(async () => ({ entry, previous: undefined }));
    const result = await invoke(createRememberTool({ rememberCore }), {
      ...baseArgs("a"),
      why: "b",
    });
    expect(rememberCore).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note:a", what: "a", why: "b" }),
    );
    expect(payloadOf(result)).toEqual({ ok: true, id: "note:a", updatedAt: "t1" });
  });

  it("forwards linkedMemories to rememberCore", async () => {
    const entry: MemoryEntry = {
      ...makeEntry("a"),
      linkedMemories: [{ id: "sentry:1", reason: "root cause of" }],
    };
    const rememberCore = vi.fn(async () => ({ entry, previous: undefined }));
    await invoke(createRememberTool({ rememberCore }), {
      ...baseArgs("a"),
      why: "b",
      linkedMemories: [{ id: "sentry:1", reason: "root cause of" }],
    });
    expect(rememberCore).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedMemories: [{ id: "sentry:1", reason: "root cause of" }],
      }),
    );
  });

  it("echoes replaced lengths when overwriting an existing what", async () => {
    const rememberCore = vi.fn(async () => ({
      entry: makeEntry("x".repeat(2800)),
      previous: makeEntry("y".repeat(3000)),
    }));
    const result = await invoke(createRememberTool({ rememberCore }), baseArgs("x".repeat(2800)));
    const payload = payloadOf(result);
    expect(payload.replaced).toEqual({ previousWhatLength: 3000, newWhatLength: 2800 });
    expect(payload.warning).toBeUndefined();
  });

  it("warns on a drastic shrink of a large what", async () => {
    const rememberCore = vi.fn(async () => ({
      entry: makeEntry("x".repeat(90)),
      previous: makeEntry("y".repeat(3000)),
    }));
    const result = await invoke(createRememberTool({ rememberCore }), baseArgs("x".repeat(90)));
    const payload = payloadOf(result);
    expect(payload.ok).toBe(true);
    expect(payload.replaced).toEqual({ previousWhatLength: 3000, newWhatLength: 90 });
    expect(payload.warning).toMatch(/living document/);
  });

  it("never warns when the previous what is small", async () => {
    const rememberCore = vi.fn(async () => ({
      entry: makeEntry("x".repeat(20)),
      previous: makeEntry("y".repeat(120)),
    }));
    const result = await invoke(createRememberTool({ rememberCore }), baseArgs("x".repeat(20)));
    const payload = payloadOf(result);
    expect(payload.replaced).toEqual({ previousWhatLength: 120, newWhatLength: 20 });
    expect(payload.warning).toBeUndefined();
  });

  it("does not warn at the 500-char floor boundary", async () => {
    const rememberCore = vi.fn(async () => ({
      entry: makeEntry("x".repeat(100)),
      previous: makeEntry("y".repeat(500)),
    }));
    const result = await invoke(createRememberTool({ rememberCore }), baseArgs("x".repeat(100)));
    expect(payloadOf(result).warning).toBeUndefined();
  });

  it("does not warn at exactly 25% of the previous length", async () => {
    const rememberCore = vi.fn(async () => ({
      entry: makeEntry("x".repeat(250)),
      previous: makeEntry("y".repeat(1000)),
    }));
    const result = await invoke(createRememberTool({ rememberCore }), baseArgs("x".repeat(250)));
    expect(payloadOf(result).warning).toBeUndefined();
  });

  it("reports no replaced info on first create", async () => {
    const rememberCore = vi.fn(async () => ({
      entry: makeEntry("brand new"),
      previous: undefined,
    }));
    const result = await invoke(createRememberTool({ rememberCore }), baseArgs("brand new"));
    const payload = payloadOf(result);
    expect(payload.replaced).toBeUndefined();
    expect(payload.warning).toBeUndefined();
  });

  it("reports no replaced info when what is omitted (omit keeps prior value)", async () => {
    const rememberCore = vi.fn(async () => ({
      entry: makeEntry("y".repeat(3000)),
      previous: makeEntry("y".repeat(3000)),
    }));
    const result = await invoke(createRememberTool({ rememberCore }), {
      ...baseArgs(undefined),
      nextSteps: "follow up",
    });
    const payload = payloadOf(result);
    expect(payload.replaced).toBeUndefined();
    expect(payload.warning).toBeUndefined();
  });
});
