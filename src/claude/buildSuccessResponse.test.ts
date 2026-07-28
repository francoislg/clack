import { describe, it, beforeEach, expect, vi } from "vitest";
import type { ClackQueryToolsResult } from "../tools/types.js";
import { buildSuccessResponse } from "./index.js";

/**
 * `escalate_to_owner` is captured by `submit_response` even when that call is rejected, so a
 * run can reach any terminal outcome still holding a diagnostic. These cover which outcomes
 * carry it through to the delivery layer.
 */
describe("buildSuccessResponse escalation propagation", () => {
  let tools: ClackQueryToolsResult;

  beforeEach(() => {
    tools = {
      toolNames: [],
      mcpServers: {},
      getResult: vi.fn<ClackQueryToolsResult["getResult"]>(() => null),
      getRenderedBlocks: vi.fn<ClackQueryToolsResult["getRenderedBlocks"]>(() => null),
      getStagedIntents: vi.fn<ClackQueryToolsResult["getStagedIntents"]>(() => new Map()),
      getToolCallHistory: vi.fn<ClackQueryToolsResult["getToolCallHistory"]>(() => []),
      isSkipped: vi.fn<ClackQueryToolsResult["isSkipped"]>(() => false),
      getAttentionLevel: vi.fn<ClackQueryToolsResult["getAttentionLevel"]>(() => null),
      getDeliveryMode: vi.fn<ClackQueryToolsResult["getDeliveryMode"]>(() => null),
      isPostedTopLevel: vi.fn<ClackQueryToolsResult["isPostedTopLevel"]>(() => false),
      getEscalateToOwner: vi.fn<ClackQueryToolsResult["getEscalateToOwner"]>(() => null),
    };
  });

  const DIAGNOSTIC = "card 758 failed: SELECT denied on `participants`";

  it("carries the diagnostic when the run ends with plain assistant text", () => {
    tools.getEscalateToOwner = vi.fn(() => DIAGNOSTIC);

    const result = buildSuccessResponse("here is what I found", [], tools, []);

    expect(result.success).toBe(true);
    expect(result.answer).toBe("here is what I found");
    expect(result.escalateToOwner).toBe(DIAGNOSTIC);
    expect(tools.getEscalateToOwner).toHaveBeenCalled();
  });

  it("carries the diagnostic when the run produces no response at all", () => {
    tools.getEscalateToOwner = vi.fn(() => DIAGNOSTIC);

    const result = buildSuccessResponse("", [], tools, []);

    expect(result.success).toBe(false);
    expect(result.error).toBe("No response received from Claude");
    expect(result.escalateToOwner).toBe(DIAGNOSTIC);
  });

  it("carries the diagnostic when the run skipped its response", () => {
    tools.isSkipped = vi.fn(() => true);
    tools.getEscalateToOwner = vi.fn(() => DIAGNOSTIC);

    const result = buildSuccessResponse("", [], tools, []);

    expect(result.skipped).toBe(true);
    expect(result.escalateToOwner).toBe(DIAGNOSTIC);
  });

  it("leaves escalateToOwner undefined on every outcome when nothing was captured", () => {
    const rawText = buildSuccessResponse("some answer", [], tools, []);
    const noResponse = buildSuccessResponse("", [], tools, []);

    expect(rawText.escalateToOwner).toBeUndefined();
    expect(noResponse.escalateToOwner).toBeUndefined();
  });
});
