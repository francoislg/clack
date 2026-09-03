import { describe, it, expect } from "vitest";
import {
  derivePhaseWindows,
  selectActivePhase,
  selectActivePhaseWindow,
  findPhaseBySlug,
  DAY_MS,
} from "./seasonPhases.js";
import type { SeasonEntry, PhaseSlice } from "../core/types.js";

// A non-zero start so "now before startedAt" tests can stay in positive time.
const T = 100 * DAY_MS;

function season(overrides: Partial<SeasonEntry>): SeasonEntry {
  return { slug: "s1", startedAt: T, expectedEndAt: T + 60 * DAY_MS, ...overrides };
}

const CHAIN: PhaseSlice[] = [
  { slug: "warmup", days: 14 },
  { slug: "ramp", days: 14 },
  { slug: "gauntlet" },
];

describe("derivePhaseWindows", () => {
  it("chains phase windows by duration from startedAt", () => {
    expect(derivePhaseWindows(season({ phases: CHAIN }))).toEqual([
      { slice: CHAIN[0], start: T, end: T + 14 * DAY_MS },
      { slice: CHAIN[1], start: T + 14 * DAY_MS, end: T + 28 * DAY_MS },
      { slice: CHAIN[2], start: T + 28 * DAY_MS, end: T + 60 * DAY_MS },
    ]);
  });

  it("the open-ended final slice absorbs a moved expectedEndAt; earlier windows are byte-identical", () => {
    const short = derivePhaseWindows(season({ phases: CHAIN, expectedEndAt: T + 60 * DAY_MS }));
    const long = derivePhaseWindows(season({ phases: CHAIN, expectedEndAt: T + 90 * DAY_MS }));
    expect(long[0]).toEqual(short[0]);
    expect(long[1]).toEqual(short[1]);
    expect(short[2].end).toBe(T + 60 * DAY_MS);
    expect(long[2].start).toBe(T + 28 * DAY_MS);
    expect(long[2].end).toBe(T + 90 * DAY_MS);
  });

  it("endedAt wins over expectedEndAt as the season end", () => {
    const windows = derivePhaseWindows(
      season({ phases: CHAIN, endedAt: T + 40 * DAY_MS, expectedEndAt: T + 90 * DAY_MS }),
    );
    expect(windows[windows.length - 1].end).toBe(T + 40 * DAY_MS);
  });

  it("truncates later windows to the season end (possibly zero-length) and never extends past it", () => {
    const seasonEnd = T + 20 * DAY_MS;
    const windows = derivePhaseWindows(season({ phases: CHAIN, expectedEndAt: seasonEnd }));
    for (const w of windows) {
      expect(w.start).toBeLessThanOrEqual(seasonEnd);
      expect(w.end).toBeLessThanOrEqual(seasonEnd);
    }
    expect(windows[0]).toEqual({ slice: CHAIN[0], start: T, end: T + 14 * DAY_MS });
    expect(windows[1]).toEqual({ slice: CHAIN[1], start: T + 14 * DAY_MS, end: seasonEnd });
    expect(windows[2]).toEqual({ slice: CHAIN[2], start: seasonEnd, end: seasonEnd });
  });

  it("returns [] for a null season, a season with no phases, and phases: []", () => {
    expect(derivePhaseWindows(null)).toEqual([]);
    expect(derivePhaseWindows(season({}))).toEqual([]);
    expect(derivePhaseWindows(season({ phases: [] }))).toEqual([]);
  });
});

describe("selectActivePhase", () => {
  it("selects the slice whose half-open window contains now — boundary belongs to the later slice", () => {
    const s = season({ phases: CHAIN });
    expect(selectActivePhase(s, T + 14 * DAY_MS - 1)?.slug).toBe("warmup");
    expect(selectActivePhase(s, T + 14 * DAY_MS)?.slug).toBe("ramp");
  });

  it("a now inside an over-long chain's truncated span still resolves to a slice without throwing", () => {
    const s = season({ phases: CHAIN, expectedEndAt: T + 20 * DAY_MS });
    expect(() => selectActivePhase(s, T + 15 * DAY_MS)).not.toThrow();
    expect(selectActivePhase(s, T + 15 * DAY_MS)?.slug).toBe("ramp");
  });

  it("endedAt bounds selection: a now past endedAt but before expectedEndAt is null", () => {
    const s = season({ phases: CHAIN, endedAt: T + 40 * DAY_MS, expectedEndAt: T + 90 * DAY_MS });
    expect(selectActivePhase(s, T + 50 * DAY_MS)).toBeNull();
  });

  it("returns null for a null season", () => {
    expect(selectActivePhase(null, T)).toBeNull();
  });

  it("returns null for a season with no phases / an empty phase list", () => {
    expect(selectActivePhase(season({}), T + DAY_MS)).toBeNull();
    expect(selectActivePhase(season({ phases: [] }), T + DAY_MS)).toBeNull();
  });

  it("returns null when now is before startedAt", () => {
    expect(selectActivePhase(season({ phases: CHAIN }), T - DAY_MS)).toBeNull();
  });

  it("returns null when now is at or after the season end", () => {
    const s = season({ phases: CHAIN });
    expect(selectActivePhase(s, T + 60 * DAY_MS)).toBeNull();
    expect(selectActivePhase(s, T + 61 * DAY_MS)).toBeNull();
  });
});

describe("selectActivePhaseWindow agrees with selectActivePhase", () => {
  const s = season({ phases: CHAIN });
  const windows = derivePhaseWindows(s);

  // Sample instants spanning before the season, each phase window, and past its end.
  const instants = [
    T - DAY_MS, // before startedAt
    T, // start of warmup
    T + 7 * DAY_MS, // inside warmup
    T + 14 * DAY_MS, // boundary → ramp
    T + 20 * DAY_MS, // inside ramp
    T + 28 * DAY_MS, // boundary → gauntlet
    T + 45 * DAY_MS, // inside gauntlet
    T + 60 * DAY_MS, // season end
    T + 61 * DAY_MS, // past season end
  ];

  it("the slice-returning selector is the window selector's slice for every instant", () => {
    for (const now of instants) {
      const window = selectActivePhaseWindow(s, now);
      expect(selectActivePhase(s, now)).toBe(window?.slice ?? null);
    }
  });

  it("a returned window's bounds are the derived ones", () => {
    for (const now of instants) {
      const window = selectActivePhaseWindow(s, now);
      if (window === null) continue;
      const derived = windows.find((w) => w.slice === window.slice);
      expect(window).toEqual(derived);
    }
  });

  it("both selectors are null outside the season", () => {
    expect(selectActivePhaseWindow(s, T - DAY_MS)).toBeNull();
    expect(selectActivePhase(s, T - DAY_MS)).toBeNull();
    expect(selectActivePhaseWindow(s, T + 61 * DAY_MS)).toBeNull();
    expect(selectActivePhase(s, T + 61 * DAY_MS)).toBeNull();
  });
});

describe("findPhaseBySlug", () => {
  const s = season({ phases: CHAIN });

  it("returns the slice with the matching slug", () => {
    expect(findPhaseBySlug(s, "ramp")).toBe(CHAIN[1]);
  });

  it("returns null when no phase has the slug", () => {
    expect(findPhaseBySlug(s, "nope")).toBeNull();
  });

  it("returns null when the slug is undefined", () => {
    expect(findPhaseBySlug(s, undefined)).toBeNull();
  });

  it("returns null for a null season", () => {
    expect(findPhaseBySlug(null, "ramp")).toBeNull();
  });
});
