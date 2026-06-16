import type { ClackSdk, ClackSdkUsers, ClackSdkMemory } from "../sdk.js";
import type { TriviaGame } from "./core/configTypes.js";
import type {
  TriviaQuestion,
  TriviaUser,
  TriviaUserData,
  SubmittedAnswer,
  CheatReport,
  SeasonsState,
  TriviaDataLayer,
  ScopedTriviaDataLayer,
} from "./core/types.js";

/**
 * In-memory data layer with test-only seeding seams. Production identity is owned by the
 * central registry (`sdk.users`); tests seed it directly via `saveUser`/`saveUsers`.
 */
export type InMemoryDataLayer = TriviaDataLayer & {
  saveUser(u: TriviaUser & TriviaUserData): Promise<void>;
  saveUsers(users: readonly (TriviaUser & TriviaUserData)[]): Promise<void>;
  /** Read trivia's namespace slice for a user — the in-memory stand-in for `sdk.users.data`. */
  getUserData(userId: string): Promise<TriviaUserData | null>;
};

/**
 * Stub for `sdk.users` in tests that build a fake `ClackSdk` but don't exercise the registry.
 * `get`/`list` resolve from the optional `identities` seed; `data(schema)` is an inert
 * get→null / merge→no-op pair.
 */
export function fakeSdkUsers(identities: Record<string, string> = {}): ClackSdkUsers {
  return {
    async get(userId) {
      const displayName = identities[userId];
      return displayName === undefined ? null : { userId, displayName };
    },
    async list() {
      return Object.entries(identities).map(([userId, displayName]) => ({ userId, displayName }));
    },
    data() {
      return {
        async get() {
          return null;
        },
        async merge() {},
      };
    },
  };
}

/**
 * Stub for `sdk.memory` in tests that build a fake `ClackSdk` but don't exercise the registry.
 * Reads resolve empty; `data(schema)` is an inert get→null / merge→no-op pair; `onBeforeExpire`
 * is a no-op.
 */
export function fakeSdkMemory(): ClackSdkMemory {
  return {
    async get() {
      return null;
    },
    async list() {
      return [];
    },
    async recall(args) {
      return { total: 0, limit: args.limit ?? 20, offset: args.offset ?? 0, entries: [] };
    },
    async remember(input) {
      const ts = "1970-01-01T00:00:00.000Z";
      return {
        id: input.id,
        what: input.what ?? "",
        why: input.why ?? "",
        staleAfter: input.staleAfter,
        nextSteps: input.nextSteps,
        references: input.references ?? [],
        createdAt: ts,
        updatedAt: ts,
      };
    },
    onBeforeExpire() {},
    data() {
      return {
        async get() {
          return null;
        },
        async merge() {},
      };
    },
  };
}

/**
 * A fully-stubbed `ClackSdk` for tool tests, with no-op defaults for every member. Pass
 * `overrides` to supply the few behaviors a given test exercises (typically `readFile`/
 * `writeFile` over a backing store, or `dmOwner`).
 */
export function createFakeSdk(overrides: Partial<ClackSdk> = {}): ClackSdk {
  return {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    capabilities: { crons: true },
    error: () => {},
    addInstruction: () => {},
    addTopicInstruction: () => {},
    registerTool: () => {},
    mcpServer: { fullName: "test", registerTool: () => {}, addTopicInstruction: () => {} },
    registerMcpServer: () => ({
      fullName: "test",
      registerTool: () => {},
      addTopicInstruction: () => {},
    }),
    readFile: async () => null,
    writeFile: async () => {},
    readFileOrSeed: async function (path, defaultContent) {
      const existing = await this.readFile(path);
      if (existing !== null) return existing;
      await this.writeFile(path, defaultContent);
      return defaultContent;
    },
    watchFile: () => {
      throw new Error("watchFile not stubbed in this fake sdk");
    },
    reconcileCronJobs: async () => {},
    findOwnedCronJobs: async () => [],
    dmOwner: async () => ({ ok: true as const }),
    getSlackClient: () => null,
    sendMessage: async () => ({ ok: true as const, ts: "1", channel: "C" }),
    engageThread: async () => {},
    startThreadConversation: async () => {},
    registerAction: () => {},
    registerView: () => {},
    actionId: (key: string) => `plugin:test:${key}`,
    viewCallbackId: (key: string) => `plugin:test:${key}`,
    askClaude: async () => ({
      text: "",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    requestSoftRestart: () => {},
    registerDictionary: () => {},
    t: (key: string) => key,
    users: fakeSdkUsers(),
    memory: fakeSdkMemory(),
    ...overrides,
  };
}
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
/**
 * @param opts.resolveIdentity Stands in for the registry's Slack-backed refresh: when
 *   `refreshIdentities` runs, each id is passed through this and any returned name updates the
 *   identity map. Omit for tests that don't exercise refresh (refreshIdentities is then a no-op).
 */
export function createInMemoryDataLayer(opts?: {
  resolveIdentity?: (userId: string) => string | undefined;
}): InMemoryDataLayer {
  let categories: string[] = [];
  const identities = new Map<string, TriviaUser>();
  const userData = new Map<string, TriviaUserData>();
  const gameCells = new Map<string, GameCell>();

  function seedUser(u: TriviaUser & TriviaUserData): void {
    identities.set(u.userId, { userId: u.userId, displayName: u.displayName });
    const namespace: TriviaUserData = {
      ...(u.joinedAt !== undefined ? { joinedAt: u.joinedAt } : {}),
      ...(u.cheatAttempts !== undefined ? { cheatAttempts: u.cheatAttempts } : {}),
    };
    if (Object.keys(namespace).length > 0) {
      userData.set(u.userId, { ...userData.get(u.userId), ...namespace });
    }
  }

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
      async loadCheats() {
        return [...cell.cheats];
      },
      async saveCheat(report) {
        cell.cheats.push(report);
        const existing = userData.get(report.cheaterUserId);
        const totalAttempts = (existing?.cheatAttempts ?? 0) + 1;
        userData.set(report.cheaterUserId, { ...existing, cheatAttempts: totalAttempts });
        return { totalAttempts };
      },
      async removeCheat(cheaterUserId, questionId) {
        const before = cell.cheats.length;
        cell.cheats = cell.cheats.filter(
          (c) => !(c.cheaterUserId === cheaterUserId && c.questionId === questionId),
        );
        const removedCount = before - cell.cheats.length;
        const existing = userData.get(cheaterUserId);
        if (removedCount === 0) {
          return { removedCount: 0, totalAttempts: existing?.cheatAttempts ?? 0 };
        }
        const totalAttempts = Math.max(0, (existing?.cheatAttempts ?? 0) - removedCount);
        userData.set(cheaterUserId, { ...existing, cheatAttempts: totalAttempts });
        return { removedCount, totalAttempts };
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
      return new Map(identities);
    },
    async refreshIdentities(userIds) {
      if (opts?.resolveIdentity === undefined) return;
      for (const userId of userIds) {
        const displayName = opts.resolveIdentity(userId);
        if (displayName !== undefined) identities.set(userId, { userId, displayName });
      }
    },
    async recordJoin(userId) {
      const existing = userData.get(userId);
      if (existing?.joinedAt !== undefined) return;
      userData.set(userId, { ...existing, joinedAt: Date.now() });
    },
    async saveUser(u) {
      seedUser(u);
    },
    async saveUsers(updates) {
      for (const u of updates) seedUser(u);
    },
    async getUserData(userId) {
      return userData.get(userId) ?? null;
    },
    forGame,
  };
}
