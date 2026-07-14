import { describe, it, expect } from "vitest";
import { buildSyncDeepPrompt, buildSyncLightPrompt } from "./sync.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { IdlerConfig } from "../types.js";

function config(scanMemory: boolean): IdlerConfig {
  return { ...DEFAULT_CONFIG, sources: { ...DEFAULT_CONFIG.sources, scanMemory } };
}

const FETCH = "ADMIN FETCH INSTRUCTIONS BODY";

describe("buildSyncLightPrompt — triage-only with early exit", () => {
  it("runs the memory triage and frames skip_response as the expected outcome", () => {
    const prompt = buildSyncLightPrompt(config(true));
    expect(prompt).toContain("LIGHT SYNC FIRE");
    expect(prompt).toContain("recall");
    expect(prompt).toContain("ignoredAt EQUALS");
    expect(prompt).toContain("ignore: true");
    expect(prompt).toContain("skip_response");
  });

  it("does NOT bake in the admin fetch instructions", () => {
    const prompt = buildSyncLightPrompt(config(true));
    expect(prompt).not.toContain(FETCH);
  });

  it("forbids the deep-fire steps (no PR listing, coldest rotation, or discovery)", () => {
    const prompt = buildSyncLightPrompt(config(true));
    expect(prompt).not.toContain("find_pull_requests");
    expect(prompt).not.toContain("sort_by");
    expect(prompt).not.toContain("External discovery");
  });

  it("short-circuits to skip_response when memory triage is disabled", () => {
    const prompt = buildSyncLightPrompt(config(false));
    expect(prompt).toContain("skip_response");
    expect(prompt).not.toContain("recall with no query");
  });
});

describe("buildSyncDeepPrompt — full maintenance pass", () => {
  it("covers all four maintenance steps", () => {
    const prompt = buildSyncDeepPrompt(config(true), FETCH);
    expect(prompt).toContain("DEEP SYNC FIRE");
    // (a) quick-fetch + close resolved
    expect(prompt).toContain("QUICK-FETCH + CLOSE RESOLVED");
    expect(prompt).toContain("open:false");
    // (b) coldest rotation + priority recompute
    expect(prompt).toContain("RE-VERIFY THE COLDEST UNITS AND RECOMPUTE PRIORITY");
    expect(prompt).toContain('sort_by: "coldest"');
    // (c) memory triage
    expect(prompt).toContain("TRIAGE RECENTLY-CHANGED MEMORY");
    // (d) all-sources discovery
    expect(prompt).toContain("External discovery");
  });

  it("scans ALL enabled sources rather than one per fire (no round-robin)", () => {
    const prompt = buildSyncDeepPrompt(config(true), FETCH);
    expect(prompt).toContain("scan ALL enabled sources");
    expect(prompt).not.toContain("do ONE source per fire");
    expect(prompt).not.toContain("round-robin, so every external source");
  });

  it("bakes in the admin fetch instructions", () => {
    const prompt = buildSyncDeepPrompt(config(true), FETCH);
    expect(prompt).toContain(FETCH);
  });

  it("still closes resolved units and re-verifies the coldest when scanMemory is false", () => {
    const prompt = buildSyncDeepPrompt(config(false), FETCH);
    expect(prompt).toContain("Memory triage enabled: false");
    expect(prompt).toContain("QUICK-FETCH + CLOSE RESOLVED");
    // With triage omitted, coldest re-verify moves up to step 2 — no gap in the numbering.
    expect(prompt).toContain("2. RE-VERIFY THE COLDEST UNITS");
    expect(prompt).not.toContain("TRIAGE RECENTLY-CHANGED MEMORY");
  });

  it("points PR references at the PR-handling contract in both reference-reading steps", () => {
    const prompt = buildSyncDeepPrompt(config(true), FETCH);
    expect(prompt).toContain(
      "for PR references, follow the PR-handling contract (canonical review check)",
    );
    expect(prompt).toContain(
      "(PR references: follow the PR-handling contract's canonical review check)",
    );
  });
});

describe("light and deep share the triage classification", () => {
  it("use identical classify-then-take keying rules", () => {
    const light = buildSyncLightPrompt(config(true));
    const deep = buildSyncDeepPrompt(config(true), FETCH);
    const fragment = "Take up to 10 candidates (classify the whole page FIRST";
    expect(light).toContain(fragment);
    expect(deep).toContain(fragment);
  });
});
