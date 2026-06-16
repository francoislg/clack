import type { WorkerToolContext } from "../types.js";
import type { Config, RepositoryConfig } from "../../config.js";

/** A minimal but fully-typed `Config` for worker-tool unit tests. */
export function makeWorkerConfig(repositories: RepositoryConfig[] = []): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "test",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "eyes" },
    directMessages: { enabled: false, dmType: "assistant" },
    mentions: { enabled: false },
    repositories,
    git: { pullIntervalMinutes: 5, shallowClone: false, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: {},
  };
}

/** A worker tool context with sensible defaults for unit tests. */
export function makeWorkerCtx(overrides?: Partial<WorkerToolContext>): WorkerToolContext {
  return {
    mode: "worker",
    worktreePath: "/tmp/worktrees/my-repo/branch",
    branchName: "clack/fix/my-branch",
    repoName: "my-repo",
    repoUrl: "https://github.com/org/my-repo.git",
    channelId: "C123",
    threadTs: "1.0",
    sessionId: "sess-1",
    config: makeWorkerConfig(),
    ...overrides,
  };
}
