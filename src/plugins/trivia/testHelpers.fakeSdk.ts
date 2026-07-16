import { vi, type Mock } from "vitest";
import { EventEmitter } from "node:events";
import type { z } from "zod";
import type {
  ClackSdk,
  ClackSdkMemoryData,
  ClackSdkUserData,
  ClackSdkUsers,
  ClackSdkMemory,
  ClackUser,
  PluginLogger,
  RegisteredMcpServer,
} from "../sdk.js";
import type { TriviaConfig } from "./core/configTypes.js";
import {
  _resetTriviaConfigBridge,
  _setTriviaConfigForTests,
  _setTriviaConfigSdkForTests,
} from "./core/configBridge.js";
import type { RevealSlackDeps } from "./tools/reveal/computeAnswers.js";
import type { LockSlackDeps } from "./tools/lock/lockQuestions.js";
import type { PostQuestionsSlackDeps } from "./tools/questions/postQuestions.js";

type AnyFn = (...args: Array<never>) => unknown;

/**
 * Every function-valued `ClackSdk` collaborator member — the complement of the
 * renderers (`t`, `actionId`, `viewCallbackId`, which have exactly one faithful
 * rendering and stay plain functions) and the data members (`capabilities`).
 * `registerTool` and `registerMcpServer` are collaborators too but carry generic /
 * widened-return signatures, so they get dedicated entries on {@link FakeSdk}.
 */
type MockedSdkKeys =
  | "error"
  | "addInstruction"
  | "addTopicInstruction"
  | "readFile"
  | "writeFile"
  | "readFileOrSeed"
  | "watchFile"
  | "reconcileCronJobs"
  | "findOwnedCronJobs"
  | "onDelayedBoot"
  | "missedRuns"
  | "runCronJobNow"
  | "dmOwner"
  | "sendMessage"
  | "engageThread"
  | "getSlackClient"
  | "registerAction"
  | "registerView"
  | "askClaude"
  | "startThreadConversation"
  | "requestSoftRestart"
  | "registerDictionary";

type RegisterToolParams = Parameters<RegisteredMcpServer["registerTool"]>;

/**
 * `registerTool`'s signature with the tool param widened to `{ name: string }`.
 * `Mock<T>` erases generics, and the generic's constraint-instantiated form is
 * NOT mutually assignable with the generic itself (the zod handler args are
 * contravariant) — the widened param is, in both directions. The `ClackSdk` side
 * of the intersection keeps serving the full generic signature to callers; the
 * mock side types `mock.calls` with enough shape to assert on `tool.name`.
 */
type RegisterToolFn = (
  minRole: RegisterToolParams[0],
  tool: { name: string },
  mapping: RegisterToolParams[2],
) => void;

type MockedLogger = { [K in keyof PluginLogger]: Mock<PluginLogger[K]> };

/** An on-demand (or the default) MCP server handle whose bindings are observable. */
export type FakeMcpServer = RegisteredMcpServer & {
  registerTool: Mock<RegisterToolFn>;
  addTopicInstruction: Mock<RegisteredMcpServer["addTopicInstruction"]>;
};

/**
 * `ClackSdk` with every collaborator member widened to a vitest mock. The mock
 * block comes FIRST in the intersection so call-signature resolution prefers the
 * widened forms (`registerMcpServer` returning {@link FakeMcpServer}); `ClackSdk`
 * membership keeps the fake assignable wherever production types are expected.
 *
 * The renderers (`t`, `actionId`, `viewCallbackId`) are deliberately absent from
 * the mock block: `sdk.t.mockReturnValue(...)` is a compile error, which is how
 * the "never override a renderer" rule is enforced.
 */
export type FakeSdk = {
  registerTool: Mock<RegisterToolFn>;
  registerMcpServer: Mock<
    (name: string, options: { autoload?: boolean; description: string }) => FakeMcpServer
  >;
  logger: MockedLogger;
  mcpServer: FakeMcpServer;
} & { [K in MockedSdkKeys]: Mock<Extract<ClackSdk[K], AnyFn>> } & ClackSdk;

/**
 * Test-only affordances the `ClackSdk` interface cannot express. Everything here
 * models the OTHER side of the boundary (core acting on its own stores) — never a
 * back door into hidden fake state.
 */
export interface FakeSdkTestHelpers {
  /** The store behind `readFile`/`writeFile`/`readFileOrSeed` — path → content. */
  files: Map<string, string>;
  /** Models core populating the central user registry (`users.get`/`users.list` read it). */
  saveUser(user: ClackUser): void;
}

/** Overridable members: the mocked collaborators plus the `capabilities` flags. */
export type FakeSdkOverrides = Partial<Pick<ClackSdk, MockedSdkKeys | "capabilities">> & {
  registerTool?: RegisterToolFn;
};

/** Benign `FSWatcher` stand-in so booting a plugin against the fake never throws. */
class NoopWatcher extends EventEmitter {
  close(): void {}
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

function createFakeMcpServer(fullName: string): FakeMcpServer {
  return {
    fullName,
    registerTool: vi.fn<RegisterToolFn>(() => {}),
    addTopicInstruction: vi.fn<RegisteredMcpServer["addTopicInstruction"]>(() => {}),
  };
}

function createFakeSdkUsers(
  identities: Map<string, ClackUser>,
  store: Map<string, object>,
): ClackSdkUsers {
  return {
    get: vi.fn<ClackSdkUsers["get"]>(async (userId) => identities.get(userId) ?? null),
    list: vi.fn<ClackSdkUsers["list"]>(async () => [...identities.values()]),
    // Plain generic like production (`createUsersSurface`) — a vi.fn wrapper would
    // erase the generic and break assignability. Fresh accessor per call, mirroring
    // production; every accessor shares the one backing store, so state written
    // through any of them is readable through the production API.
    data: <T>(schema: z.ZodType<T>): ClackSdkUserData<T> => ({
      get: async (userId) => {
        const raw = store.get(userId);
        return raw === undefined ? null : schema.parse(raw);
      },
      merge: async (userId, partial) => {
        store.set(userId, { ...store.get(userId), ...partial });
      },
    }),
  };
}

function createFakeSdkMemory(store: Map<string, object>): ClackSdkMemory {
  return {
    get: vi.fn<ClackSdkMemory["get"]>(async () => null),
    list: vi.fn<ClackSdkMemory["list"]>(async () => []),
    recall: vi.fn<ClackSdkMemory["recall"]>(async (args) => ({
      total: 0,
      limit: args.limit ?? 20,
      offset: args.offset ?? 0,
      entries: [],
    })),
    remember: vi.fn<ClackSdkMemory["remember"]>(async (input) => {
      const ts = "1970-01-01T00:00:00.000Z";
      return {
        id: input.id,
        what: input.what ?? "",
        why: input.why ?? "",
        staleAfter: input.staleAfter,
        nextSteps: input.nextSteps,
        references: input.references ?? [],
        linkedMemories: input.linkedMemories ?? [],
        createdAt: ts,
        updatedAt: ts,
      };
    }),
    onBeforeExpire: vi.fn<ClackSdkMemory["onBeforeExpire"]>(() => {}),
    data: <T>(schema: z.ZodType<T>): ClackSdkMemoryData<T> => ({
      get: async (id) => {
        const raw = store.get(id);
        return raw === undefined ? null : schema.parse(raw);
      },
      merge: async (id, partial) => {
        store.set(id, { ...store.get(id), ...partial });
      },
    }),
  };
}

/**
 * The canonical `ClackSdk` fake. Every collaborator member is a `vi.fn` carrying
 * a coherent default (file I/O over an in-memory store, users/memory over working
 * namespace stores, memoized `registerMcpServer` handles), so existing tests keep
 * their behavior while gaining call recording and per-member stubbing.
 *
 * `overrides` seeds a member's default implementation — the member is still a
 * mock wrapping the override, so its calls stay observable. Prefer stubbing via
 * the mock API (`sdk.readFile.mockResolvedValue(...)`) in new tests.
 *
 * Construct in `beforeEach` (never at module scope) so `restoreMocks: true`
 * cannot strip the defaults between tests.
 */
export function createFakeSdk(overrides: FakeSdkOverrides = {}): {
  sdk: FakeSdk;
  testHelpers: FakeSdkTestHelpers;
} {
  const files = new Map<string, string>();
  const identities = new Map<string, ClackUser>();
  const userStore = new Map<string, object>();
  const memoryStore = new Map<string, object>();
  const handles = new Map<string, FakeMcpServer>();
  const defaultServer = createFakeMcpServer("test");

  const readFile = vi.fn<ClackSdk["readFile"]>(
    overrides.readFile ?? (async (path) => files.get(path) ?? null),
  );
  const writeFile = vi.fn<ClackSdk["writeFile"]>(
    overrides.writeFile ??
      (async (path, content) => {
        files.set(path, content);
      }),
  );

  const sdk: FakeSdk = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    capabilities: overrides.capabilities ?? { crons: true },
    error: vi.fn<ClackSdk["error"]>(overrides.error ?? (() => {})),
    addInstruction: vi.fn<ClackSdk["addInstruction"]>(overrides.addInstruction ?? (() => {})),
    addTopicInstruction: vi.fn<ClackSdk["addTopicInstruction"]>(
      overrides.addTopicInstruction ?? (() => {}),
    ),
    registerTool: vi.fn<RegisterToolFn>(
      overrides.registerTool ??
        ((minRole, tool, mapping) => defaultServer.registerTool(minRole, tool, mapping)),
    ),
    mcpServer: defaultServer,
    registerMcpServer: vi.fn((name: string): FakeMcpServer => {
      let handle = handles.get(name);
      if (handle === undefined) {
        handle = createFakeMcpServer(`test:${name}`);
        handles.set(name, handle);
      }
      return handle;
    }),
    readFile,
    writeFile,
    readFileOrSeed: vi.fn<ClackSdk["readFileOrSeed"]>(
      overrides.readFileOrSeed ??
        (async (path, defaultContent) => {
          const existing = await readFile(path);
          if (existing !== null) return existing;
          await writeFile(path, defaultContent);
          return defaultContent;
        }),
    ),
    watchFile: vi.fn<ClackSdk["watchFile"]>(overrides.watchFile ?? (() => new NoopWatcher())),
    reconcileCronJobs: vi.fn<ClackSdk["reconcileCronJobs"]>(
      overrides.reconcileCronJobs ?? (async () => {}),
    ),
    findOwnedCronJobs: vi.fn<ClackSdk["findOwnedCronJobs"]>(
      overrides.findOwnedCronJobs ?? (async () => []),
    ),
    onDelayedBoot: vi.fn<ClackSdk["onDelayedBoot"]>(overrides.onDelayedBoot ?? (() => {})),
    missedRuns: vi.fn<ClackSdk["missedRuns"]>(
      overrides.missedRuns ?? (async () => ({ lastExpectedRuns: [] })),
    ),
    runCronJobNow: vi.fn<ClackSdk["runCronJobNow"]>(overrides.runCronJobNow ?? (async () => {})),
    dmOwner: vi.fn<ClackSdk["dmOwner"]>(overrides.dmOwner ?? (async () => ({ ok: true }))),
    sendMessage: vi.fn<ClackSdk["sendMessage"]>(
      overrides.sendMessage ?? (async () => ({ ok: true, ts: "1", channel: "C" })),
    ),
    engageThread: vi.fn<ClackSdk["engageThread"]>(overrides.engageThread ?? (async () => {})),
    getSlackClient: vi.fn<ClackSdk["getSlackClient"]>(overrides.getSlackClient ?? (() => null)),
    registerAction: vi.fn<ClackSdk["registerAction"]>(overrides.registerAction ?? (() => {})),
    registerView: vi.fn<ClackSdk["registerView"]>(overrides.registerView ?? (() => {})),
    askClaude: vi.fn<ClackSdk["askClaude"]>(
      overrides.askClaude ??
        (async () => ({
          text: "",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
        })),
    ),
    startThreadConversation: vi.fn<ClackSdk["startThreadConversation"]>(
      overrides.startThreadConversation ?? (async () => {}),
    ),
    requestSoftRestart: vi.fn<ClackSdk["requestSoftRestart"]>(
      overrides.requestSoftRestart ?? (() => {}),
    ),
    registerDictionary: vi.fn<ClackSdk["registerDictionary"]>(
      overrides.registerDictionary ?? (() => {}),
    ),
    actionId: (key: string) => `plugin:test:${key}`,
    viewCallbackId: (key: string) => `plugin:test:${key}`,
    // Mirrors the real `t`'s two observable behaviors — a key resolves to a string,
    // and interpolated vars land in it — without coupling tests to dictionary text.
    // Renders as `key` bare, or `key:value[:value…]` when vars are supplied, so a
    // test can assert that a value actually reached the string.
    t: (key: string, vars?: Record<string, string | number>) =>
      vars === undefined ? key : `${key}:${Object.values(vars).join(":")}`,
    users: createFakeSdkUsers(identities, userStore),
    memory: createFakeSdkMemory(memoryStore),
  };

  return {
    sdk,
    testHelpers: {
      files,
      saveUser: (user) => {
        identities.set(user.userId, user);
      },
    },
  };
}

/**
 * Prime the trivia config bridge for a test: reset the module-global cache, point
 * `saveTriviaConfig` at the fake sdk, and inject `config` as the loaded snapshot.
 * The `{ games: [] }` default keeps the omission inert — season bootstrap and
 * cascade resolution simply see an empty workspace. Call in `beforeEach`, never at
 * module scope.
 */
export function primeTriviaConfig(
  sdk: ClackSdk,
  config: TriviaConfig | null = { games: [] },
): void {
  _resetTriviaConfigBridge();
  _setTriviaConfigSdkForTests(sdk);
  _setTriviaConfigForTests(config);
}

/** Canonical fake for `RevealSlackDeps` — Slack available, no reactions, no edits. */
export function createFakeRevealSlackDeps(overrides: Partial<RevealSlackDeps> = {}): {
  [K in keyof RevealSlackDeps]: Mock<RevealSlackDeps[K]>;
} {
  return {
    isAvailable: vi.fn<RevealSlackDeps["isAvailable"]>(overrides.isAvailable ?? (() => null)),
    fetchBotUserId: vi.fn<RevealSlackDeps["fetchBotUserId"]>(
      overrides.fetchBotUserId ?? (async () => "BBOT"),
    ),
    fetchMessageReactions: vi.fn<RevealSlackDeps["fetchMessageReactions"]>(
      overrides.fetchMessageReactions ?? (async () => []),
    ),
    fetchUserDisplayName: vi.fn<RevealSlackDeps["fetchUserDisplayName"]>(
      overrides.fetchUserDisplayName ?? (async () => null),
    ),
    updateMessage: vi.fn<RevealSlackDeps["updateMessage"]>(
      overrides.updateMessage ?? (async () => {}),
    ),
  };
}

/** Canonical fake for `LockSlackDeps` — no Slack client unless overridden. */
export function createFakeLockSlackDeps(overrides: Partial<LockSlackDeps> = {}): {
  [K in keyof LockSlackDeps]: Mock<LockSlackDeps[K]>;
} {
  return {
    getSlackClient: vi.fn<LockSlackDeps["getSlackClient"]>(
      overrides.getSlackClient ?? (() => null),
    ),
  };
}

/** Canonical fake for `PostQuestionsSlackDeps` — Slack available; sequential fake posts. */
export function createFakePostQuestionsSlackDeps(overrides: Partial<PostQuestionsSlackDeps> = {}): {
  [K in keyof PostQuestionsSlackDeps]: Mock<PostQuestionsSlackDeps[K]>;
} {
  let posted = 0;
  return {
    isAvailable: vi.fn<PostQuestionsSlackDeps["isAvailable"]>(
      overrides.isAvailable ?? (() => null),
    ),
    postBlocks: vi.fn<PostQuestionsSlackDeps["postBlocks"]>(
      overrides.postBlocks ??
        (async ({ channel }) => {
          posted++;
          const suffix = String(posted).padStart(3, "0");
          return {
            ts: `1700000${suffix}.000000`,
            permalink: `https://test.slack.com/archives/${channel}/p1700000${suffix}000000`,
          };
        }),
    ),
  };
}
