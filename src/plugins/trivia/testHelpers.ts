import type { TriviaGame } from "./core/configTypes.js";
import type {
  TriviaQuestion,
  TriviaUser,
  SubmittedAnswer,
  CheatReport,
  SeasonsState,
  TriviaDataLayer,
  ScopedTriviaDataLayer,
} from "./core/types.js";
import { findCurrentSeason } from "./core/seasonTimeline.js";

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

/**
 * Per-game in-memory storage cell. The factory below maintains one cell per game
 * name and lazily creates new ones on `forGame(name)` — mirrors how the real SDK
 * data layer treats unregistered games as "empty until first write."
 */
interface GameCell {
  questions: TriviaQuestion[];
  answers: SubmittedAnswer[];
  cheats: CheatReport[];
  seasonsState: SeasonsState | null;
}

/**
 * In-memory implementation of TriviaDataLayer, for unit tests.
 *
 * - Categories and users are global (shared across all games), matching production.
 * - Per-game arrays are isolated per `name` and accessed via `forGame(name)`.
 * - No lazy season-bootstrap (the production behavior depends on `getConfig()`,
 *   which tests typically don't load); seed `seasonsState` explicitly via
 *   `forGame(name).saveSeasonsState(state)` when needed.
 */
export function createInMemoryDataLayer(): TriviaDataLayer {
  let categories: string[] = [];
  const users = new Map<string, TriviaUser>();
  const gameCells = new Map<string, GameCell>();

  function cellFor(name: string): GameCell {
    let cell = gameCells.get(name);
    if (cell === undefined) {
      cell = { questions: [], answers: [], cheats: [], seasonsState: null };
      gameCells.set(name, cell);
    }
    return cell;
  }

  function forGame(name: string): ScopedTriviaDataLayer {
    const cell = cellFor(name);
    return {
      async loadQuestions() {
        return [...cell.questions];
      },
      async saveQuestion(q) {
        cell.questions.push(q);
      },
      async updateQuestion(id, updates) {
        const idx = cell.questions.findIndex((q) => q.id === id);
        if (idx === -1) return;
        cell.questions[idx] = { ...cell.questions[idx], ...updates };
      },
      async loadAnswers() {
        return [...cell.answers];
      },
      async saveAnswer(a) {
        cell.answers.push(a);
      },
      async updateAnswer(userId, questionId, partial) {
        const idx = cell.answers.findIndex(
          (a) => a.userId === userId && a.questionId === questionId,
        );
        if (idx === -1) return;
        cell.answers[idx] = { ...cell.answers[idx], ...partial };
      },
      async deleteAnswersForQuestion(questionId) {
        const before = cell.answers.length;
        cell.answers = cell.answers.filter((a) => a.questionId !== questionId);
        return before - cell.answers.length;
      },
      async loadCheats() {
        return [...cell.cheats];
      },
      async saveCheat(report) {
        cell.cheats.push(report);
        const existing = users.get(report.cheaterUserId);
        const next: TriviaUser = existing
          ? { ...existing, cheatAttempts: (existing.cheatAttempts ?? 0) + 1 }
          : {
              userId: report.cheaterUserId,
              displayName: report.cheaterUserId,
              joinedAt: Date.now(),
              cheatAttempts: 1,
            };
        users.set(report.cheaterUserId, next);
        return { totalAttempts: next.cheatAttempts ?? 1 };
      },
      async loadSeasonsState() {
        return cell.seasonsState === null ? null : structuredClone(cell.seasonsState);
      },
      async saveSeasonsState(state) {
        cell.seasonsState = structuredClone(state);
      },
      async getCurrentSeasonSlug() {
        return findCurrentSeason(cell.seasonsState, Date.now())?.slug ?? null;
      },
    };
  }

  return {
    async loadCategories() {
      return [...categories];
    },
    async saveCategories(c) {
      categories = [...c];
    },
    async loadUsers() {
      return new Map(users);
    },
    async saveUser(u) {
      users.set(u.userId, u);
    },
    forGame,
  };
}
