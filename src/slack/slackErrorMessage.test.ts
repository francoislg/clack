import { describe, expect, it } from "vitest";
import { createSlackErrorMessage } from "./slackErrorMessage.js";
import { slackError } from "./testCanvasApi.js";

describe("createSlackErrorMessage", () => {
  const messages = new Map([["not_found", (operation: string) => `Missing thing (${operation}).`]]);
  const toMessage = createSlackErrorMessage("things", messages);

  it("formats a mapped Slack error code", () => {
    expect(toMessage("read thing", slackError("not_found"))).toBe("Missing thing (read thing).");
  });

  it("falls back to the raw code for an unmapped Slack error code", () => {
    expect(toMessage("read thing", slackError("internal_error"))).toBe(
      "Slack rejected read thing: internal_error.",
    );
  });

  it("falls back to the error text for a non-Slack error", () => {
    expect(toMessage("read thing", new Error("socket hang up"))).toBe(
      "read thing failed: socket hang up",
    );
  });
});
