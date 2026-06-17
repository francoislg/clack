import { describe, it, expect } from "vitest";
import { buildSyncPrompt } from "./sync.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { IdlerConfig } from "../types.js";

function config(scanMemory: boolean): IdlerConfig {
  return { ...DEFAULT_CONFIG, sources: { ...DEFAULT_CONFIG.sources, scanMemory } };
}

describe("buildSyncPrompt — memory scan", () => {
  it("includes the memory-scan block and classification rule when scanMemory is true", () => {
    const prompt = buildSyncPrompt(config(true), "fetch");
    expect(prompt).toContain("Memory scan source enabled: true");
    expect(prompt).toContain("MEMORY SCAN");
    expect(prompt).toContain("recall");
    expect(prompt).toContain("ignoredAt EQUALS");
    expect(prompt).toContain("ignore: true");
  });

  it("omits the memory-scan block when scanMemory is false", () => {
    const prompt = buildSyncPrompt(config(false), "fetch");
    expect(prompt).toContain("Memory scan source enabled: false");
    expect(prompt).not.toContain("MEMORY SCAN");
  });
});
