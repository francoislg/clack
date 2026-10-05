import { describe, expect, it } from "vitest";
import { parseListRef } from "./listRef.js";

describe("parseListRef", () => {
  it("accepts a bare List id", () => {
    expect(parseListRef("F0456ABC")).toEqual({ listId: "F0456ABC", itemId: undefined });
  });

  it("trims surrounding whitespace", () => {
    expect(parseListRef("  F0456ABC\n")).toEqual({ listId: "F0456ABC", itemId: undefined });
  });

  it("extracts the id from a /lists/<team>/<id> URL", () => {
    expect(parseListRef("https://acme.slack.com/lists/T0123/F0456ABC")).toEqual({
      listId: "F0456ABC",
      itemId: undefined,
    });
  });

  it("extracts the item id from the record_id query param", () => {
    expect(parseListRef("https://acme.slack.com/lists/T0123/F0456ABC?record_id=Rec789ABC")).toEqual(
      { listId: "F0456ABC", itemId: "Rec789ABC" },
    );
  });

  it("ignores a record_id of the wrong shape", () => {
    expect(parseListRef("https://acme.slack.com/lists/T0123/F0456ABC?record_id=789abc")).toEqual({
      listId: "F0456ABC",
      itemId: undefined,
    });
  });

  it("rejects a message permalink", () => {
    expect(parseListRef("https://acme.slack.com/archives/C123/p1234567890123456")).toBeUndefined();
  });

  it("rejects a canvas URL", () => {
    expect(parseListRef("https://acme.slack.com/docs/T0123/F0456ABC")).toBeUndefined();
  });

  it("rejects a non-Slack host", () => {
    expect(parseListRef("https://example.com/lists/T0123/F0456ABC")).toBeUndefined();
  });
});
