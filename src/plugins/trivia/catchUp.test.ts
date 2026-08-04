import { describe, it, expect } from "vitest";
import { installCatchUp } from "./catchUp.js";
import { createFakeSdk, type FakeSdk, type FakeSdkOverrides } from "./testHelpers.fakeSdk.js";
import type { TriviaGame } from "./core/configTypes.js";

function makeGame(overrides: Partial<TriviaGame> = {}): TriviaGame {
  return {
    name: "daily",
    channel: "C123",
    questionCron: "0 10 * * *",
    revealCron: "0 16 * * *",
    lockCron: "0 15 * * *",
    timezone: "UTC",
    ...overrides,
  };
}

interface Harness {
  run: () => Promise<void>;
  sdk: FakeSdk;
}

/**
 * Install the catch-up handler against the canonical fake SDK — tests assert on
 * its member mocks directly (`sdk.runCronJobNow`, `sdk.dmOwner`, `sdk.missedRuns`).
 * `run` dispatches the handler captured by the `onDelayedBoot` mock.
 * `missedBySpecKey` maps a specKey to its missed occurrences; unlisted specKeys
 * report none.
 */
function makeHarness(
  games: TriviaGame[],
  now: Date,
  missedBySpecKey: Record<string, Date[]>,
  overrides: FakeSdkOverrides = {},
): Harness {
  const { sdk } = createFakeSdk({
    missedRuns: async (specKey) => ({ lastExpectedRuns: missedBySpecKey[specKey] ?? [] }),
    ...overrides,
  });
  installCatchUp(
    sdk,
    () => games,
    () => now,
  );
  const handler = sdk.onDelayedBoot.mock.calls[0]?.[0];
  if (!handler) throw new Error("installCatchUp did not register a delayed-boot handler");
  return { run: () => Promise.resolve(handler()), sdk };
}

function firedKeys(h: Harness): string[] {
  return h.sdk.runCronJobNow.mock.calls.map((c) => c[0]);
}

const RECOVERABLE_NOW = new Date("2026-06-10T10:33:00.000Z");
const MISSED_TODAY = [new Date("2026-06-10T10:00:00.000Z")];

describe("trivia boot catch-up", () => {
  it("fires lock, then reveal, then question, in order", async () => {
    const h = makeHarness([makeGame()], RECOVERABLE_NOW, {
      "daily:lock": [new Date("2026-06-09T15:00:00.000Z")],
      "daily:reveal": [new Date("2026-06-09T16:00:00.000Z")],
      "daily:question": MISSED_TODAY,
    });

    await h.run();

    expect(firedKeys(h)).toEqual(["daily:lock", "daily:reveal", "daily:question"]);
  });

  it("processes games sequentially — all of game A's fires before game B's", async () => {
    const gameA = makeGame({ name: "aaa" });
    const gameB = makeGame({ name: "bbb" });
    const h = makeHarness([gameA, gameB], RECOVERABLE_NOW, {
      "aaa:reveal": [new Date("2026-06-09T16:00:00.000Z")],
      "aaa:question": MISSED_TODAY,
      "bbb:reveal": [new Date("2026-06-09T16:00:00.000Z")],
    });

    await h.run();

    expect(firedKeys(h)).toEqual(["aaa:reveal", "aaa:question", "bbb:reveal"]);
  });

  it("never queries or fires the prep spec", async () => {
    const h = makeHarness([makeGame({ prepCron: "30 9 * * *" })], RECOVERABLE_NOW, {
      "daily:prep": [new Date("2026-06-10T09:30:00.000Z")],
    });

    await h.run();

    expect(firedKeys(h)).toEqual([]);
    const queried = h.sdk.missedRuns.mock.calls.map((c) => c[0]);
    expect(queried).not.toContain("daily:prep");
  });

  it("never queries or fires the reminder spec", async () => {
    const h = makeHarness([makeGame({ remindMissedPlayers: true })], RECOVERABLE_NOW, {
      "daily:reminder": [new Date("2026-06-10T15:00:00.000Z")],
    });

    await h.run();

    expect(firedKeys(h)).toEqual([]);
    const queried = h.sdk.missedRuns.mock.calls.map((c) => c[0]);
    expect(queried).not.toContain("daily:reminder");
  });

  it("skips the lock query for a game without lockCron", async () => {
    const h = makeHarness([makeGame({ lockCron: undefined })], RECOVERABLE_NOW, {});

    await h.run();

    const queried = h.sdk.missedRuns.mock.calls.map((c) => c[0]);
    expect(queried).toEqual(["daily:reveal", "daily:question"]);
  });

  it("skips disabled games entirely", async () => {
    const h = makeHarness([makeGame({ enabled: false })], RECOVERABLE_NOW, {
      "daily:question": MISSED_TODAY,
    });

    await h.run();

    expect(firedKeys(h)).toEqual([]);
    expect(h.sdk.missedRuns).not.toHaveBeenCalled();
  });

  it("fires a missed question inside the recovery window, without a DM", async () => {
    // 10:33, lock at 15:00: next question fire is tomorrow (after the deadline)
    // and 10:33 + 2h = 12:33 ≤ 15:00.
    const h = makeHarness([makeGame()], RECOVERABLE_NOW, { "daily:question": MISSED_TODAY });

    await h.run();

    expect(firedKeys(h)).toEqual(["daily:question"]);
    expect(h.sdk.dmOwner).not.toHaveBeenCalled();
  });

  it("fires at most once even when several question slots were missed", async () => {
    const h = makeHarness([makeGame()], RECOVERABLE_NOW, {
      "daily:question": [
        new Date("2026-06-08T10:00:00.000Z"),
        new Date("2026-06-09T10:00:00.000Z"),
        new Date("2026-06-10T10:00:00.000Z"),
      ],
    });

    await h.run();

    expect(firedKeys(h)).toEqual(["daily:question"]);
  });

  it("skips and DMs the owner when the next regular fire covers the round", async () => {
    // 08:00: today's 10:00 question fire precedes the 15:00 lock, so the regular
    // fire covers today — yesterday's missed quiz is lost.
    const now = new Date("2026-06-10T08:00:00.000Z");
    const h = makeHarness([makeGame()], now, {
      "daily:question": [new Date("2026-06-09T10:00:00.000Z")],
    });

    await h.run();

    expect(firedKeys(h)).toEqual([]);
    expect(h.sdk.dmOwner.mock.calls).toEqual([["catchup.quiz_lost:daily:2026-06-09"]]);
  });

  it("skips and DMs the owner when less than 2h remain before the deadline", async () => {
    const now = new Date("2026-06-10T14:33:00.000Z");
    const h = makeHarness([makeGame()], now, { "daily:question": MISSED_TODAY });

    await h.run();

    expect(firedKeys(h)).toEqual([]);
    expect(h.sdk.dmOwner.mock.calls).toEqual([["catchup.quiz_lost:daily:2026-06-10"]]);
  });

  it("names every distinct lost day in the owner DM", async () => {
    // 08:00: the regular 10:00 fire covers today, so both missed days are lost.
    const now = new Date("2026-06-10T08:00:00.000Z");
    const h = makeHarness([makeGame()], now, {
      "daily:question": [
        new Date("2026-06-08T10:00:00.000Z"),
        new Date("2026-06-09T10:00:00.000Z"),
      ],
    });

    await h.run();

    expect(firedKeys(h)).toEqual([]);
    expect(h.sdk.dmOwner.mock.calls).toEqual([["catchup.quiz_lost:daily:2026-06-08, 2026-06-09"]]);
  });

  it("uses revealCron as the deadline when lockCron is absent", async () => {
    // 14:33 with reveal at 16:00: 14:33 + 2h > 15:00 would fail against a lock,
    // but against the 16:00 reveal the window is still open.
    const now = new Date("2026-06-10T13:33:00.000Z");
    const h = makeHarness([makeGame({ lockCron: undefined })], now, {
      "daily:question": MISSED_TODAY,
    });

    await h.run();

    expect(firedKeys(h)).toEqual(["daily:question"]);
  });

  it("fires missed lock and reveal unconditionally with no DM", async () => {
    const now = new Date("2026-06-10T16:30:00.000Z");
    const h = makeHarness([makeGame()], now, {
      "daily:lock": [new Date("2026-06-10T15:00:00.000Z")],
      "daily:reveal": [new Date("2026-06-10T16:00:00.000Z")],
    });

    await h.run();

    expect(firedKeys(h)).toEqual(["daily:lock", "daily:reveal"]);
    expect(h.sdk.dmOwner).not.toHaveBeenCalled();
  });

  it("skips question catch-up on an unparseable deadline cron and continues to the next game", async () => {
    const broken = makeGame({ name: "broken", lockCron: "not a cron" });
    const healthy = makeGame({ name: "healthy" });
    const h = makeHarness([broken, healthy], RECOVERABLE_NOW, {
      "broken:question": MISSED_TODAY,
      "healthy:question": MISSED_TODAY,
    });

    await h.run();

    expect(firedKeys(h)).toEqual(["healthy:question"]);
    expect(h.sdk.dmOwner).not.toHaveBeenCalled();
  });

  it("logs and continues to the next game when the owner DM fails", async () => {
    const now = new Date("2026-06-10T14:33:00.000Z");
    const lostA = makeGame({ name: "aaa" });
    const recoverable = makeGame({ name: "bbb" });
    const h = makeHarness(
      [lostA, recoverable],
      now,
      {
        "aaa:question": [new Date("2026-06-10T10:00:00.000Z")],
        "bbb:lock": [new Date("2026-06-10T14:00:00.000Z")],
      },
      {
        dmOwner: async () => ({ ok: false, error: "owner not configured" }),
      },
    );

    await h.run();

    expect(h.sdk.logger.error.mock.calls.flat().join(" ")).toContain("owner not configured");
    expect(firedKeys(h)).toEqual(["bbb:lock"]);
  });

  it("isolates a failing fire — the question step still runs after a reveal failure", async () => {
    const h = makeHarness(
      [makeGame()],
      RECOVERABLE_NOW,
      {
        "daily:reveal": [new Date("2026-06-09T16:00:00.000Z")],
        "daily:question": MISSED_TODAY,
      },
      {
        runCronJobNow: async (specKey) => {
          if (specKey === "daily:reveal") throw new Error("reveal exploded");
        },
      },
    );

    await h.run();

    expect(h.sdk.dmOwner).not.toHaveBeenCalled();
    const queried = h.sdk.missedRuns.mock.calls.map((c) => c[0]);
    expect(queried).toContain("daily:question");
  });
});
