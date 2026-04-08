import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 009: add autoRespond config field
 */
export const test: MigrationTest = {
  version: 9,
  cases: [
    {
      name: "Adds autoRespond with enabled: false",
      input: {
        reactions: { trigger: "robot_face" },
        directMessages: { enabled: true },
        mentions: { enabled: true },
        repositories: [
          { name: "app", url: "org/app", description: "App", access: { read: "member" } },
        ],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { timeoutMinutes: 1440, cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        const ar = output.autoRespond as Record<string, unknown> | undefined;
        if (!ar) return "autoRespond field missing";
        if (ar.enabled !== false) return `Expected enabled: false, got: ${ar.enabled}`;
        return null;
      },
    },
    {
      name: "Already migrated — no-op",
      input: {
        reactions: { trigger: "robot_face" },
        directMessages: { enabled: true },
        mentions: { enabled: true },
        autoRespond: { enabled: true },
        repositories: [
          { name: "app", url: "org/app", description: "App", access: { read: "member" } },
        ],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { timeoutMinutes: 1440, cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        const ar = output.autoRespond as Record<string, unknown> | undefined;
        if (!ar) return "autoRespond field was removed";
        if (ar.enabled !== true) return `Expected enabled: true (preserved), got: ${ar.enabled}`;
        return null;
      },
    },
    {
      name: "Preserves all other fields unchanged",
      input: {
        reactions: { trigger: "clack", thinking: { type: "emoji", emoji: "clack-loading" } },
        directMessages: { enabled: false },
        mentions: { enabled: true },
        repositories: [
          {
            name: "app",
            url: "org/app",
            description: "App",
            access: { read: "member", write: "dev" },
          },
        ],
        git: { pullIntervalMinutes: 30, shallowClone: false, cloneDepth: 5 },
        sessions: { timeoutMinutes: 3600, cleanupIntervalMinutes: 10 },
        claudeCode: { model: "opus" },
        changesWorkflow: { enabled: true, timeoutMinutes: 10 },
      },
      validate: (output) => {
        const ar = output.autoRespond as Record<string, unknown> | undefined;
        if (!ar) return "autoRespond field missing";
        if (ar.enabled !== false) return `Expected enabled: false, got: ${ar.enabled}`;
        const reactions = output.reactions as Record<string, unknown>;
        if (reactions?.trigger !== "clack")
          return `reactions.trigger changed to ${reactions?.trigger}`;
        const cw = output.changesWorkflow as Record<string, unknown>;
        if (cw?.enabled !== true) return "changesWorkflow.enabled was modified";
        const git = output.git as Record<string, unknown>;
        if (git?.pullIntervalMinutes !== 30) return "git.pullIntervalMinutes was modified";
        return null;
      },
    },
  ],
};
