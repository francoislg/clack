import { describe, it, expect } from "vitest";
import { buildSummaryPrompt } from "./summary.js";

describe("buildSummaryPrompt", () => {
  const prompt = buildSummaryPrompt();

  it("scopes the usage query by plugin actor, not channel", () => {
    expect(prompt).toContain('plugin: "idler"');
    expect(prompt).not.toContain("channel:");
  });

  it("uses the server-computed relative window and forbids epoch math", () => {
    expect(prompt).toContain("since_hours: 24");
    expect(prompt).toContain("never compute epoch timestamps");
  });

  it("instructs a scoped usage-only query via find_recent_interactions", () => {
    expect(prompt).toContain("find_recent_interactions");
    expect(prompt).toContain('include: ["usage"]');
    expect(prompt).toContain('trigger_type: "scheduled"');
    // Explains WHY usage-only is safe (bounded result) so the instruction isn't lost on reword.
    expect(prompt).toContain("keeps the result small");
  });

  it("instructs reporting a spend line and omitting it only on failure", () => {
    expect(prompt).toContain("Spend:");
    expect(prompt.toLowerCase()).toContain("omit this line only if");
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
