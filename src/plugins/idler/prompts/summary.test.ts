import { describe, it, expect } from "vitest";
import { buildSummaryPrompt } from "./summary.js";

describe("buildSummaryPrompt", () => {
  const prompt = buildSummaryPrompt("C0REPORT");

  it("embeds the reporting channel id for the usage query", () => {
    expect(prompt).toContain('channel: "C0REPORT"');
  });

  it("instructs a scoped usage query via find_recent_interactions", () => {
    expect(prompt).toContain("find_recent_interactions");
    expect(prompt).toContain("include_usage");
    expect(prompt).toContain('trigger_type: "scheduled"');
    expect(prompt).toContain("since");
  });

  it("instructs reporting a spend line and omitting it only on failure", () => {
    expect(prompt).toContain("Spend:");
    expect(prompt.toLowerCase()).toContain("omit this line only if");
  });

  it("still drives the read_activity + clear_activity cycle", () => {
    expect(prompt).toContain("read_activity");
    expect(prompt).toContain("clear_activity");
  });
});
