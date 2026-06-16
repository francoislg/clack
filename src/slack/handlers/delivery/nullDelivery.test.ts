import { describe, it, expect } from "vitest";
import { NullDelivery } from "./nullDelivery.js";

describe("NullDelivery", () => {
  it("deliver posts nothing and reports success + notified (no follow-up ping)", async () => {
    const handler = new NullDelivery();
    const res = await handler.deliver();
    expect(res).toEqual({ ok: true, ts: undefined, notified: true });
  });

  it("every verb is a no-op", async () => {
    const handler = new NullDelivery();
    await expect(handler.windUp()).resolves.toBeUndefined();
    expect(handler.handleEvent()).toBeUndefined();
    await expect(handler.windDown()).resolves.toBeUndefined();
  });
});
