import { describe, it, expect, beforeEach } from "vitest";
import { createSetWorkspaceConfigTool } from "./setWorkspaceConfig.js";
import { setWorkspaceConfigArgs } from "./setWorkspaceConfig.testHelpers.js";
import { loadTriviaConfig } from "../../core/configBridge.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import { createFakeSdk, primeTriviaConfig, type FakeSdk } from "../../testHelpers.fakeSdk.js";

const SESSION = { sessionId: "test" };

describe("set_workspace_config — judgeInstructions", () => {
  let sdk: FakeSdk;

  beforeEach(() => {
    sdk = createFakeSdk().sdk;
  });

  it("sets the workspace tier, trimmed, and reports the field", async () => {
    primeTriviaConfig(sdk, {});
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler(
        setWorkspaceConfigArgs({ judgeInstructions: "  Accept French or English.  " }),
        SESSION,
      ),
    );
    expect(result.updatedFields).toContain("judgeInstructions");
    expect(loadTriviaConfig()?.judgeInstructions).toBe("Accept French or English.");
  });

  it("replaces an existing value", async () => {
    primeTriviaConfig(sdk, { judgeInstructions: "Old rule." });
    const tool = createSetWorkspaceConfigTool();
    await tool.handler(setWorkspaceConfigArgs({ judgeInstructions: "New rule." }), SESSION);
    expect(loadTriviaConfig()?.judgeInstructions).toBe("New rule.");
  });

  it("null clears the tier and leaves additionalInstructions alone", async () => {
    primeTriviaConfig(sdk, {
      judgeInstructions: "Old rule.",
      additionalInstructions: "Avoid politics.",
    });
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler(setWorkspaceConfigArgs({ judgeInstructions: null }), SESSION),
    );
    expect(result.updatedFields).toContain("judgeInstructions (cleared)");
    const cfg = loadTriviaConfig();
    expect(cfg?.judgeInstructions).toBeUndefined();
    expect(cfg?.additionalInstructions).toBe("Avoid politics.");
  });

  it("omitting the argument keeps the existing value", async () => {
    primeTriviaConfig(sdk, { judgeInstructions: "Keep me." });
    const tool = createSetWorkspaceConfigTool();
    await tool.handler(setWorkspaceConfigArgs({ judgeLeniency: "evaluate" }), SESSION);
    const cfg = loadTriviaConfig();
    expect(cfg?.judgeInstructions).toBe("Keep me.");
    expect(cfg?.judgeLeniency).toBe("evaluate");
  });

  it("rejects an empty / whitespace-only string, naming the field, and writes nothing", async () => {
    primeTriviaConfig(sdk, { judgeInstructions: "Keep me." });
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler(setWorkspaceConfigArgs({ judgeInstructions: "   " }), SESSION),
    );
    expect(result.error).toMatch(/judgeInstructions.*non-empty/);
    expect(loadTriviaConfig()?.judgeInstructions).toBe("Keep me.");
  });
});
