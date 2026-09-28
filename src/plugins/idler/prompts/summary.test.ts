import { describe, it, expect } from "vitest";
import { buildSummaryPrompt } from "./summary.js";

describe("buildSummaryPrompt", () => {
  const prompt = buildSummaryPrompt();

  it("scopes the usage query by plugin actor, not channel", () => {
    expect(prompt).toContain('plugin: "idler"');
    expect(prompt).not.toContain("channel:");
  });

  it("scopes spend to the activity log's windowStart, falling back to 24h, and forbids date math", () => {
    expect(prompt).toContain("windowStart");
    expect(prompt).toContain("since: <that windowStart, copied verbatim>");
    expect(prompt).toContain("pass `since_hours: 24` instead");
    expect(prompt).toContain("Never compute or adjust a timestamp yourself");
  });

  it("instructs a scoped usage-only query via find_recent_interactions", () => {
    expect(prompt).toContain("find_recent_interactions");
    expect(prompt).toContain('include: ["usage"]');
    expect(prompt).toContain('trigger_type: "scheduled"');
    // Explains WHY usage-only is safe (bounded result) so the instruction isn't lost on reword.
    expect(prompt).toContain("keeps the result small");
  });

  it("instructs reporting a spend line and omitting it only on failure", () => {
    expect(prompt).toContain("🧮 Spend:");
    expect(prompt.toLowerCase()).toContain("omit this line only if");
  });

  it("copies the preformatted totalUsage.summary instead of doing arithmetic", () => {
    expect(prompt).toContain("totalUsage.summary");
    expect(prompt).not.toContain("inputTokens + outputTokens");
  });

  it("still drives the read_activity + clear_activity cycle", () => {
    expect(prompt).toContain("read_activity");
    expect(prompt).toContain("clear_activity");
  });

  it("instructs rendering digest items as Slack hyperlinks", () => {
    expect(prompt).toContain("<url|label>");
  });

  it("instructs suppressing unfurls on delivery", () => {
    expect(prompt).toContain("suppress_unfurls: true");
  });
});
