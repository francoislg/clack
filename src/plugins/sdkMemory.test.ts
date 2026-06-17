import { describe, it, expect, vi } from "vitest";
import { createMemorySurface } from "./sdkMemory.js";
import type { MemoryEntry, RememberInput } from "../memoryRegistry.js";

const noopWarn = (_message: string): void => {};

describe("createMemorySurface remember", () => {
  it("forwards linkedMemories through to rememberCore unchanged", async () => {
    const captured: RememberInput[] = [];
    const entry: MemoryEntry = {
      id: "note:a",
      what: "a",
      why: "b",
      references: [],
      linkedMemories: [{ id: "sentry:1", reason: "root cause of" }],
      createdAt: "t0",
      updatedAt: "t1",
    };
    const rememberCore = vi.fn(async (input: RememberInput) => {
      captured.push(input);
      return entry;
    });

    const memory = createMemorySurface({ rememberCore }, "idler", noopWarn);
    await memory.remember({
      id: "note:a",
      linkedMemories: [{ id: "sentry:1", reason: "root cause of" }],
    });

    expect(captured[0].linkedMemories).toEqual([{ id: "sentry:1", reason: "root cause of" }]);
  });
});
