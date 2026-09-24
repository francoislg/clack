import { describe, expect, it } from "vitest";
import { streamingZod } from "./configSchemas.js";

describe("streamingZod", () => {
  it("returns undefined when absent", () => {
    expect(streamingZod.parse(undefined)).toBeUndefined();
  });

  it("defaults taskCardTransport to stream", () => {
    expect(streamingZod.parse({})).toEqual({ taskCardTransport: "stream" });
  });

  it("accepts streamThenUpdate", () => {
    expect(streamingZod.parse({ taskCardTransport: "streamThenUpdate" })).toEqual({
      taskCardTransport: "streamThenUpdate",
    });
  });

  it("rejects an unknown taskCardTransport", () => {
    const result = streamingZod.safeParse({ taskCardTransport: "poll" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Config 'streaming.taskCardTransport' must be one of: stream, streamThenUpdate",
    );
  });

  it("rejects an unknown key", () => {
    const result = streamingZod.safeParse({ taskCardTranport: "streamThenUpdate" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("rejects a non-object", () => {
    const result = streamingZod.safeParse("stream");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Config 'streaming' must be an object");
  });
});
