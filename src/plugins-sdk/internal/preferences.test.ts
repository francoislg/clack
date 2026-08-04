import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createPreferencesSurface, type PreferencesSurfaceDeps } from "./preferences.js";

const schema = z.object({
  notifyDaily: z.boolean().optional(),
  vibrateOnAnswer: z.boolean().optional(),
});

function makeDeps(overrides: Partial<PreferencesSurfaceDeps> = {}): PreferencesSurfaceDeps {
  return {
    getPluginPreferenceSlice: async () => null,
    ...overrides,
  };
}

describe("createPreferencesSurface — get", () => {
  it("returns null when the slice is null", async () => {
    const surface = createPreferencesSurface(makeDeps(), "trivia", () => {});
    expect(await surface.get("U1", schema)).toBeNull();
  });

  it("parses and returns a valid slice", async () => {
    const deps = makeDeps({
      getPluginPreferenceSlice: async () => ({ notifyDaily: true }),
    });
    const surface = createPreferencesSurface(deps, "trivia", () => {});
    expect(await surface.get("U1", schema)).toEqual({ notifyDaily: true });
  });

  it("returns null and warns on a schema mismatch", async () => {
    const warn = vi.fn();
    const deps = makeDeps({
      getPluginPreferenceSlice: async () => ({ notifyDaily: "nope" }),
    });
    const surface = createPreferencesSurface(deps, "trivia", warn);
    expect(await surface.get("U1", schema)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("preferences slice for U1 failed schema"),
    );
  });

  it("uses getPluginPreferenceSlice with plugin and user ID", async () => {
    const getPluginPreferenceSlice = vi.fn(async () => null);
    const surface = createPreferencesSurface({ getPluginPreferenceSlice }, "trivia", () => {});
    await surface.get("U5", schema);
    expect(getPluginPreferenceSlice).toHaveBeenCalledWith("trivia", "U5");
  });
});
