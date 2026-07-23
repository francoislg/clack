import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ClackSdk } from "../../plugins-sdk/sdk.js";
import type { TriviaGame } from "./core/configTypes.js";
import { createSdkDataLayer } from "./core/dataLayer.js";
import type { TriviaDataLayer, ScopedTriviaDataLayer } from "./core/types.js";

/** `ScopedTriviaDataLayer` with every method exposing the mock API directly. */
export type FakeScopedTriviaDataLayer = {
  [K in keyof ScopedTriviaDataLayer]: Mock<ScopedTriviaDataLayer[K]>;
} & ScopedTriviaDataLayer;

/**
 * `TriviaDataLayer` with every method exposing the mock API directly. The mock
 * block sits first in the intersection so call-signature resolution prefers the
 * widened forms (`forGame` returning the fake scoped type).
 */
export type FakeTriviaDataLayer = {
  loadCategories: Mock<TriviaDataLayer["loadCategories"]>;
  saveCategories: Mock<TriviaDataLayer["saveCategories"]>;
  loadUsers: Mock<TriviaDataLayer["loadUsers"]>;
  refreshIdentities: Mock<TriviaDataLayer["refreshIdentities"]>;
  recordJoin: Mock<TriviaDataLayer["recordJoin"]>;
  forGame: Mock<(name: string) => FakeScopedTriviaDataLayer>;
} & TriviaDataLayer;

/**
 * Spies sit at the collaborator's public surface ONLY. A method that reaches a
 * sibling through its own closure (e.g. `saveQuestion` re-reading via
 * `loadQuestions`) bypasses these spies by design — a test observes exactly the
 * calls the code under test makes, never the data layer's internals.
 */
function spyScoped(scoped: ScopedTriviaDataLayer): FakeScopedTriviaDataLayer {
  return {
    loadQuestions: vi.spyOn(scoped, "loadQuestions"),
    saveQuestion: vi.spyOn(scoped, "saveQuestion"),
    updateQuestion: vi.spyOn(scoped, "updateQuestion"),
    loadAnswers: vi.spyOn(scoped, "loadAnswers"),
    saveAnswer: vi.spyOn(scoped, "saveAnswer"),
    updateAnswer: vi.spyOn(scoped, "updateAnswer"),
    loadCheats: vi.spyOn(scoped, "loadCheats"),
    saveCheat: vi.spyOn(scoped, "saveCheat"),
    removeCheat: vi.spyOn(scoped, "removeCheat"),
    loadTeamAnswers: vi.spyOn(scoped, "loadTeamAnswers"),
    upsertTeamAnswer: vi.spyOn(scoped, "upsertTeamAnswer"),
    removeTeamAnswer: vi.spyOn(scoped, "removeTeamAnswer"),
    loadSeasonsState: vi.spyOn(scoped, "loadSeasonsState"),
    saveSeasonsState: vi.spyOn(scoped, "saveSeasonsState"),
    getCurrentSeasonSlug: vi.spyOn(scoped, "getCurrentSeasonSlug"),
  };
}

/**
 * The canonical `TriviaDataLayer` fake: the REAL `createSdkDataLayer(sdk)` with
 * every method wrapped by a spy, so default behavior is production's (including
 * the season bootstrap) and any single method can still be stubbed per test.
 *
 * State lives in the sdk fake (`createFakeSdk().testHelpers.files` and the
 * users store) — this factory owns nothing, mirrors the production signature,
 * and therefore returns `{ dataLayer }` with no `testHelpers`.
 *
 * `forGame(name)` is memoized by name so the production API is the observation
 * point: `dataLayer.forGame("main").saveQuestion` is the SAME spy the code
 * under test called. Prime the config bridge first via
 * `primeTriviaConfig(sdk, config)` (in `beforeEach`, never at module scope).
 */
export function createTriviaDataLayer(sdk: ClackSdk): { dataLayer: FakeTriviaDataLayer } {
  const real = createSdkDataLayer(sdk);
  const scopedByName = new Map<string, FakeScopedTriviaDataLayer>();
  const dataLayer: FakeTriviaDataLayer = {
    loadCategories: vi.spyOn(real, "loadCategories"),
    saveCategories: vi.spyOn(real, "saveCategories"),
    loadUsers: vi.spyOn(real, "loadUsers"),
    refreshIdentities: vi.spyOn(real, "refreshIdentities"),
    recordJoin: vi.spyOn(real, "recordJoin"),
    forGame: vi.fn((name: string): FakeScopedTriviaDataLayer => {
      let scoped = scopedByName.get(name);
      if (scoped === undefined) {
        scoped = spyScoped(real.forGame(name));
        scopedByName.set(name, scoped);
      }
      return scoped;
    }),
  };
  return { dataLayer };
}

/** Conventional fixture name used throughout the trivia test suite. */
export const FIXTURE_GAME_NAME = "main";

/**
 * Default fixture: one enabled game named `"main"`. Test files that need games
 * registered (which is most of them, since every per-game tool requires `game`)
 * inject `() => FIXTURE_GAMES` as the `getGamesFn` parameter on tool factories.
 */
export const FIXTURE_GAMES: readonly TriviaGame[] = [
  {
    name: FIXTURE_GAME_NAME,
    channel: "C100000000",
    questionCron: "0 9 * * 1-5",
    revealCron: "0 17 * * 1-5",
    timezone: "UTC",
    enabled: true,
  },
];

/** Convenience: the standard `getGamesFn` test injection. */
export const fixtureGetGames = () => FIXTURE_GAMES;

/**
 * Multi-game fixture for cross-game tests: `main`, `sandbox` (both enabled), and
 * `retired` (disabled — still readable per the frozen-archive semantics).
 */
export const MULTI_FIXTURE_GAMES: readonly TriviaGame[] = [
  {
    name: "main",
    channel: "C100000000",
    questionCron: "0 9 * * 1-5",
    revealCron: "0 17 * * 1-5",
    timezone: "UTC",
    enabled: true,
  },
  {
    name: "sandbox",
    channel: "C200000000",
    questionCron: "0 9 * * 1-5",
    revealCron: "0 17 * * 1-5",
    timezone: "UTC",
    enabled: true,
  },
  {
    name: "retired",
    channel: "C300000000",
    questionCron: "0 9 * * 1-5",
    revealCron: "0 17 * * 1-5",
    timezone: "UTC",
    enabled: false,
  },
];

export const multiFixtureGetGames = () => MULTI_FIXTURE_GAMES;
