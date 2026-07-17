import { describe, it, expect } from "vitest";
import {
  buildSyncDeepPrompt,
  buildSyncDiscoveryPrompt,
  buildSyncLightPrompt,
  buildSyncMaintenancePrompt,
} from "./sync.js";
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

  it("reads only a server-computed recency window, never the full store", () => {
    const prompt = buildSyncLightPrompt(config(true));
    expect(prompt).toContain("`since_hours: 24`");
    expect(prompt).not.toContain("recall with no query and limit 50");
  });

  it("caps recall calls and forbids offload-file and codebase reads", () => {
    const prompt = buildSyncLightPrompt(config(true));
    expect(prompt).toContain("at most 2 recall calls");
    expect(prompt).toContain("NEVER paginate");
    expect(prompt).toContain("do NOT Read or Grep that file");
    expect(prompt).toContain("Never open repository files");
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

  it("keeps the unwindowed full-page recall (the daily catch-all)", () => {
    const prompt = buildSyncDeepPrompt(config(true), FETCH);
    expect(prompt).toContain("recall with no query and limit 50");
    expect(prompt).not.toContain("since_hours");
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
    expect(buildSyncMaintenancePrompt(config(true))).toContain(fragment);
  });
});

describe("buildSyncMaintenancePrompt — split-layout maintenance pass", () => {
  it("covers the three maintenance steps", () => {
    const prompt = buildSyncMaintenancePrompt(config(true));
    expect(prompt).toContain("QUICK-FETCH + CLOSE RESOLVED");
    expect(prompt).toContain("TRIAGE RECENTLY-CHANGED MEMORY");
    expect(prompt).toContain("RE-VERIFY THE COLDEST UNITS AND RECOMPUTE PRIORITY");
  });

  it("carries no fetch instructions and no discovery instructions", () => {
    const prompt = buildSyncMaintenancePrompt(config(true));
    expect(prompt).not.toContain(FETCH);
    expect(prompt).not.toContain("## External discovery");
    expect(prompt).not.toContain("Sourcing instructions");
    expect(prompt).toContain("the discovery fire owns sourcing");
  });

  it("renumbers the coldest step when triage is disabled", () => {
    const prompt = buildSyncMaintenancePrompt(config(false));
    expect(prompt).toContain("2. RE-VERIFY THE COLDEST UNITS");
    expect(prompt).not.toContain("TRIAGE RECENTLY-CHANGED MEMORY");
  });
});

describe("buildSyncDiscoveryPrompt — split-layout discovery pass", () => {
  it("scans all enabled sources and bakes in the fetch instructions", () => {
    const prompt = buildSyncDiscoveryPrompt(config(true), FETCH);
    expect(prompt).toContain("DISCOVERY SYNC FIRE");
    expect(prompt).toContain("scan ALL enabled sources");
    expect(prompt).toContain("get_archived");
    expect(prompt).toContain(FETCH);
  });

  it("forbids the maintenance duties", () => {
    const prompt = buildSyncDiscoveryPrompt(config(true), FETCH);
    expect(prompt).toContain("Do NOT run memory triage, the coldest-unit rotation");
    expect(prompt).not.toContain("QUICK-FETCH + CLOSE RESOLVED");
    expect(prompt).not.toContain("TRIAGE RECENTLY-CHANGED MEMORY");
    expect(prompt).not.toContain('sort_by: "coldest"');
  });
});

describe("deep-tier session discipline (warm-up + result budget)", () => {
  const deepTier: Array<[string, string]> = [
    ["maintenance", buildSyncMaintenancePrompt(config(true))],
    ["discovery", buildSyncDiscoveryPrompt(config(true), FETCH)],
    ["combined", buildSyncDeepPrompt(config(true), FETCH)],
  ];

  it.each(deepTier)("%s prompt batches the ToolSearch warm-up", (_name, prompt) => {
    expect(prompt).toContain("ONE message of batched ToolSearch calls");
    expect(prompt).toContain("never one solo ToolSearch per turn");
  });

  it.each(deepTier)("%s prompt bounds fat results", (_name, prompt) => {
    expect(prompt).toContain("small explicit limit");
    expect(prompt).toContain("Never Read a whole file");
    expect(prompt).toContain("do NOT Read or Grep that file");
  });

  it("the light prompt keeps its own stricter budget instead", () => {
    const prompt = buildSyncLightPrompt(config(true));
    expect(prompt).not.toContain("batched ToolSearch calls");
    expect(prompt).toContain("at most 2 recall calls");
  });
});
