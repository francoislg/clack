import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 011: add allowScheduledMessages config field
 */
export const test: MigrationTest = {
  version: 11,
  cases: [
    {
      name: "Adds allowScheduledMessages with false default",
      input: {
        reactions: { trigger: "robot_face" },
        directMessages: { enabled: true },
        mentions: { enabled: true },
        autoRespond: { enabled: false },
        repositories: [{ name: "app", url: "org/app", description: "App", access: { read: "member" } }],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        if (!("allowScheduledMessages" in output)) return "allowScheduledMessages field missing";
        if (output.allowScheduledMessages !== false) return `Expected false, got: ${output.allowScheduledMessages}`;
        return null;
      },
    },
    {
      name: "Already migrated — preserves existing true value",
      input: {
        reactions: { trigger: "robot_face" },
        directMessages: { enabled: true },
        mentions: { enabled: true },
        autoRespond: { enabled: false },
        allowScheduledMessages: true,
        repositories: [{ name: "app", url: "org/app", description: "App", access: { read: "member" } }],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        if (!("allowScheduledMessages" in output)) return "allowScheduledMessages was removed";
        if (output.allowScheduledMessages !== true) return `Expected true (preserved), got: ${output.allowScheduledMessages}`;
        return null;
      },
    },
    {
      name: "Preserves all other fields unchanged",
      input: {
        reactions: { trigger: "clack", thinking: { type: "emoji", emoji: "clack-loading" } },
        directMessages: { enabled: false },
        mentions: { enabled: true },
        autoRespond: { enabled: true },
        repositories: [{ name: "app", url: "org/app", description: "App", access: { read: "member", write: "dev" } }],
        git: { pullIntervalMinutes: 30, shallowClone: false, cloneDepth: 5 },
        sessions: { cleanupIntervalMinutes: 10 },
        claudeCode: { model: "opus" },
        changesWorkflow: { enabled: true, timeoutMinutes: 10 },
      },
      validate: (output) => {
        if (!("allowScheduledMessages" in output)) return "allowScheduledMessages field missing";
        if (output.allowScheduledMessages !== false) return `Expected false, got: ${output.allowScheduledMessages}`;
        const reactions = output.reactions as Record<string, unknown>;
        if (reactions?.trigger !== "clack") return `reactions.trigger changed to ${reactions?.trigger}`;
        const cw = output.changesWorkflow as Record<string, unknown>;
        if (cw?.enabled !== true) return "changesWorkflow.enabled was modified";
        const ar = output.autoRespond as Record<string, unknown>;
        if (ar?.enabled !== true) return "autoRespond.enabled was modified";
        return null;
      },
    },
  ],
};
