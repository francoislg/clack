import { describe, it, expect } from "vitest";
import { buildSyncPrompt } from "./sync.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { IdlerConfig } from "../types.js";

function config(scanMemory: boolean): IdlerConfig {
  return { ...DEFAULT_CONFIG, sources: { ...DEFAULT_CONFIG.sources, scanMemory } };
}

describe("buildSyncPrompt — every-fire memory maintenance", () => {
  it("runs close-resolved, memory triage, and coldest re-verify every fire (not as a round-robin arm)", () => {
    const prompt = buildSyncPrompt(config(true), "fetch");
    expect(prompt).toContain("Memory triage enabled: true");
    // Close-resolved is part of the every-fire maintenance pass.
    expect(prompt).toContain("CLOSE RESOLVED");
    expect(prompt).toContain("open:false");
    // Triage is an every-fire step, not one of the rotated discovery sources.
    expect(prompt).toContain("TRIAGE RECENTLY-CHANGED MEMORY (every fire)");
    expect(prompt).toContain("recall");
    expect(prompt).toContain("ignoredAt EQUALS");
    expect(prompt).toContain("ignore: true");
    // Triage is step 2, so coldest re-verify is step 3 when scanMemory is enabled.
    expect(prompt).toContain("3. RE-VERIFY THE COLDEST UNITS");
  });

  it("keeps memory out of the external round-robin", () => {
    const prompt = buildSyncPrompt(config(true), "fetch");
    expect(prompt).toContain("External discovery");
    expect(prompt).toContain("Memory is NOT a discovery source here");
  });

  it("still closes resolved units and re-verifies the coldest units when scanMemory is false", () => {
    const prompt = buildSyncPrompt(config(false), "fetch");
    expect(prompt).toContain("Memory triage enabled: false");
    expect(prompt).toContain("CLOSE RESOLVED");
    // With triage omitted, coldest re-verify moves up to step 2 — no gap in the numbering.
    expect(prompt).toContain("2. RE-VERIFY THE COLDEST UNITS");
  });

  it("omits the memory-triage block when scanMemory is false", () => {
    const prompt = buildSyncPrompt(config(false), "fetch");
    expect(prompt).not.toContain("TRIAGE RECENTLY-CHANGED MEMORY");
  });
});
