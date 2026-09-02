import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeSdk, primeTriviaConfig } from "../testHelpers.fakeSdk.js";
import { createTriviaDataLayer } from "../testHelpers.js";
import type { FakeSdk } from "../testHelpers.fakeSdk.js";
import type { FakeTriviaDataLayer } from "../testHelpers.js";
import type { TriviaConfig } from "./configTypes.js";

/**
 * The fallback season-bootstrap resolves the starter month and its end instant in
 * the game's configured timezone, so the window closes with the last local day of
 * the month rather than the UTC month end.
 */
describe("createSdkDataLayer season seed — timezone-aware month boundary", () => {
  let sdk: FakeSdk;
  let dataLayer: FakeTriviaDataLayer;

  beforeEach(() => {
    vi.useFakeTimers();
    // July 15 2026 12:00 UTC — squarely inside the New York July calendar month.
    vi.setSystemTime(Date.UTC(2026, 6, 15, 12, 0, 0, 0));
    ({ sdk } = createFakeSdk());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function primeWithZone(timezone: string): void {
    const config: TriviaConfig = {
      games: [
        {
          name: "main",
          channel: "C100000000",
          questionCron: "0 9 * * 1-5",
          revealCron: "0 17 * * 1-5",
          timezone,
          enabled: true,
        },
      ],
      seasons: { enabled: true, prompt: "p" },
    };
    primeTriviaConfig(sdk, config);
    ({ dataLayer } = createTriviaDataLayer(sdk));
  }

  // Seasons enabled, but no game named "main" in config → `gameTimezone("main")`
  // resolves to undefined and the seed falls back to UTC month boundaries.
  function primeSeasonsWithoutGame(): void {
    const config: TriviaConfig = {
      games: [],
      seasons: { enabled: true, prompt: "p" },
    };
    primeTriviaConfig(sdk, config);
    ({ dataLayer } = createTriviaDataLayer(sdk));
  }

  it("seeds expectedEndAt at the last New York millisecond of the month, not the UTC month end", async () => {
    primeWithZone("America/New_York");
    const state = await dataLayer.forGame("main").loadSeasonsState();

    // Aug 1 2026 00:00 EDT (UTC-4) is Aug 1 2026 04:00 UTC; the last NY ms of July is one before.
    const lastNyMsOfJuly = Date.UTC(2026, 7, 1, 4, 0, 0, 0) - 1;
    const lastUtcMsOfJuly = Date.UTC(2026, 7, 1, 0, 0, 0, 0) - 1;

    expect(state?.seasons).toHaveLength(1);
    expect(state?.seasons[0]?.expectedEndAt).toBe(lastNyMsOfJuly);
    expect(state?.seasons[0]?.expectedEndAt).not.toBe(lastUtcMsOfJuly);
    expect(state?.seasons[0]?.slug).toBe("season-2026-07");
    expect(state?.seasons[0]?.startedAt).toBe(Date.UTC(2026, 6, 15, 12, 0, 0, 0));
  });

  it("seeds the UTC month end when the game's timezone is not resolvable from config", async () => {
    primeSeasonsWithoutGame();
    const state = await dataLayer.forGame("main").loadSeasonsState();

    // No zone resolves → the month closes at the last UTC millisecond of July.
    const lastUtcMsOfJuly = Date.UTC(2026, 7, 1, 0, 0, 0, 0) - 1;

    expect(state?.seasons).toHaveLength(1);
    expect(state?.seasons[0]?.expectedEndAt).toBe(lastUtcMsOfJuly);
    expect(state?.seasons[0]?.slug).toBe("season-2026-07");
    expect(state?.seasons[0]?.startedAt).toBe(Date.UTC(2026, 6, 15, 12, 0, 0, 0));
  });
});
