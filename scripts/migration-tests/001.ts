import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 001: supportsChanges → access
 */
export const test: MigrationTest = {
  version: 1,
  cases: [
    {
      name: "supportsChanges: true → access with write",
      input: {
        repositories: [
          {
            name: "my-app",
            url: "org/my-app",
            description: "Main app",
            branch: "main",
            supportsChanges: true,
          },
        ],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { timeoutMinutes: 1440, cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        const repo = (output.repositories as Record<string, unknown>[])?.[0];
        if (!repo) return "No repositories in output";
        if ("supportsChanges" in repo) return `supportsChanges still present`;
        const access = repo.access as Record<string, string> | undefined;
        if (!access) return "No access property";
        if (access.read !== "member") return `Expected read: "member", got: "${access.read}"`;
        if (access.write !== "dev") return `Expected write: "dev", got: "${access.write}"`;
        return null;
      },
    },
    {
      name: "supportsChanges: false → access read-only",
      input: {
        repositories: [
          {
            name: "docs",
            url: "org/docs",
            description: "Documentation",
            supportsChanges: false,
          },
        ],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { timeoutMinutes: 1440, cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        const repo = (output.repositories as Record<string, unknown>[])?.[0];
        if (!repo) return "No repositories in output";
        if ("supportsChanges" in repo) return `supportsChanges still present`;
        const access = repo.access as Record<string, string> | undefined;
        if (!access) return "No access property";
        if (access.read !== "member") return `Expected read: "member", got: "${access.read}"`;
        if ("write" in access) return `Unexpected write property: "${access.write}"`;
        return null;
      },
    },
    {
      name: "Mixed repos — true, false, and already migrated",
      input: {
        repositories: [
          {
            name: "app",
            url: "org/app",
            description: "Main app",
            supportsChanges: true,
          },
          {
            name: "infra",
            url: "org/infra",
            description: "Infrastructure",
            supportsChanges: false,
          },
          {
            name: "tools",
            url: "org/tools",
            description: "Dev tools",
            access: { read: "dev", write: "admin" },
          },
        ],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { timeoutMinutes: 1440, cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        const repos = output.repositories as Record<string, unknown>[];
        if (!repos || repos.length !== 3) return `Expected 3 repos, got ${repos?.length}`;

        const app = repos.find((r) => r.name === "app");
        if (!app) return "Missing app repo";
        if ("supportsChanges" in app) return "app still has supportsChanges";
        const appAccess = app.access as Record<string, string>;
        if (!appAccess?.write) return "app missing write access";

        const infra = repos.find((r) => r.name === "infra");
        if (!infra) return "Missing infra repo";
        if ("supportsChanges" in infra) return "infra still has supportsChanges";
        const infraAccess = infra.access as Record<string, string>;
        if (!infraAccess) return "infra missing access";
        if ("write" in infraAccess) return "infra should not have write";

        const tools = repos.find((r) => r.name === "tools");
        if (!tools) return "Missing tools repo";
        const toolsAccess = tools.access as Record<string, string>;
        if (toolsAccess?.read !== "dev")
          return `tools read should be "dev", got "${toolsAccess?.read}"`;
        if (toolsAccess?.write !== "admin")
          return `tools write should be "admin", got "${toolsAccess?.write}"`;

        return null;
      },
    },
    {
      name: "Already migrated — no-op",
      input: {
        repositories: [
          {
            name: "app",
            url: "org/app",
            description: "Main app",
            access: { read: "member", write: "dev" },
          },
        ],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { timeoutMinutes: 1440, cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        const repo = (output.repositories as Record<string, unknown>[])?.[0];
        if (!repo) return "No repositories in output";
        const access = repo.access as Record<string, string>;
        if (access?.read !== "member") return `Expected read: "member", got: "${access?.read}"`;
        if (access?.write !== "dev") return `Expected write: "dev", got: "${access?.write}"`;
        return null;
      },
    },
  ],
};
