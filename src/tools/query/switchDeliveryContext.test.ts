import { describe, it, expect, vi } from "vitest";
import type { DeliveryControl } from "../types.js";
import { createSwitchDeliveryContextTool } from "./switchDeliveryContext.js";
import { parseToolResult } from "../testHelpers.js";

describe("switch_delivery_context tool", () => {
  it("forwards the mode to deliveryControl.switchTo and returns success", async () => {
    const switchTo = vi.fn(async () => {});
    const control: DeliveryControl = { switchTo };
    const toolDef = createSwitchDeliveryContextTool(control);

    const result = await toolDef.handler({ mode: "streamer" }, {});

    expect(switchTo).toHaveBeenCalledWith("streamer");
    const parsed = parseToolResult(result);
    expect(parsed).toMatchObject({ success: true, mode: "streamer" });
  });

  it("forwards invisible as well", async () => {
    const switchTo = vi.fn(async () => {});
    const toolDef = createSwitchDeliveryContextTool({ switchTo });

    await toolDef.handler({ mode: "invisible" }, {});
    expect(switchTo).toHaveBeenCalledWith("invisible");
  });
});
