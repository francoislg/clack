import { describe, expect, it } from "vitest";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultError,
  SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
import { stub } from "../testStubs.js";
import { collectTurn, resultOutcome } from "./resultOutcome.js";

describe("resultOutcome", () => {
  it("returns the result text for a successful turn", () => {
    const message = stub<SDKResultSuccess>({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "the answer",
    });
    expect(resultOutcome(message)).toEqual({ ok: true, text: "the answer" });
  });

  it("treats a success-subtype turn with is_error as a failure carrying the API error", () => {
    const message = stub<SDKResultSuccess>({
      type: "result",
      subtype: "success",
      is_error: true,
      api_error_status: 400,
      result: "API Error: 400 Claude Code 2.1.276 does not support this model",
    });
    expect(resultOutcome(message)).toEqual({
      ok: false,
      error: "API Error: 400 Claude Code 2.1.276 does not support this model (HTTP 400)",
    });
  });

  it("falls back to a generic message when an API error carries no text or status", () => {
    const message = stub<SDKResultSuccess>({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "",
    });
    expect(resultOutcome(message)).toEqual({ ok: false, error: "API error" });
  });

  it("joins the errors of an error-subtype turn", () => {
    const message = stub<SDKResultError>({
      type: "result",
      subtype: "error_during_execution",
      errors: ["first", "second"],
    });
    expect(resultOutcome(message)).toEqual({ ok: false, error: "first, second" });
  });

  it("names the subtype when an error-subtype turn carries no errors", () => {
    const message = stub<SDKResultError>({
      type: "result",
      subtype: "error_max_turns",
      errors: [],
    });
    expect(resultOutcome(message)).toEqual({ ok: false, error: "error_max_turns" });
  });
});

function assistant(text: string): SDKAssistantMessage {
  return stub<SDKAssistantMessage>({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

function success(result: string, isError = false): SDKResultSuccess {
  return stub<SDKResultSuccess>({ type: "result", subtype: "success", is_error: isError, result });
}

async function* stream(...messages: SDKMessage[]): AsyncGenerator<SDKMessage> {
  yield* messages;
}

describe("collectTurn", () => {
  it("returns the result text and the result message", async () => {
    const result = success("final");
    expect(await collectTurn(stream(assistant("draft"), result))).toEqual({
      ok: true,
      text: "final",
      result,
    });
  });

  it("falls back to the last assistant message's text when the result has none", async () => {
    const turn = await collectTurn(stream(assistant("first"), assistant("second"), success("")));
    expect(turn).toMatchObject({ ok: true, text: "second" });
  });

  it("reports an API-error turn as a failure, keeping the last assistant text", async () => {
    const turn = await collectTurn(stream(assistant("partial"), success("API Error: 400", true)));
    expect(turn).toMatchObject({ ok: false, error: "API Error: 400", text: "partial" });
  });

  it("stops at the first result message", async () => {
    const turn = await collectTurn(stream(success("first"), success("second")));
    expect(turn).toMatchObject({ ok: true, text: "first" });
  });

  it("reports a stream that ends without a result", async () => {
    const turn = await collectTurn(stream(assistant("partial")));
    expect(turn).toEqual({ ok: false, error: "no result", text: "partial" });
  });
});
