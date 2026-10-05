import { describe, it, expect } from "vitest";
import { actionSchema } from "./submitResponse.js";
import { getResponseActionBlocks } from "../../slack/blocks.js";

describe("list_items_delete action schema", () => {
  it("accepts a ref and an optional label", () => {
    const parsed = actionSchema.parse({ type: "list_items_delete", ref: "ref-1", label: "Remove" });

    expect(parsed).toEqual({ type: "list_items_delete", ref: "ref-1", label: "Remove" });
  });

  it("requires a ref", () => {
    expect(actionSchema.safeParse({ type: "list_items_delete" }).success).toBe(false);
  });

  it("drops auto, so the action still renders as a confirm button", () => {
    const parsed = actionSchema.parse({ type: "list_items_delete", ref: "ref-1", auto: true });

    expect(parsed).toEqual({ type: "list_items_delete", ref: "ref-1" });
    const [block] = getResponseActionBlocks([parsed], "s1");
    expect(block.elements).toHaveLength(1);
    expect(block.elements[0]).toMatchObject({
      type: "button",
      action_id: "clack_list_items_delete_0",
    });
  });
});
