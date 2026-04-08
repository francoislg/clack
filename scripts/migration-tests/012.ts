import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 012: add threadAutoRespondMaxAgeMinutes config field
 */
export const test: MigrationTest = {
  version: 12,
  cases: [
    {
      name: "Adds threadAutoRespondMaxAgeMinutes with default of 60",
      input: {
        reactions: { trigger: "robot_face" },
        directMessages: { enabled: true },
        mentions: { enabled: true },
        autoRespond: { enabled: false },
        allowScheduledMessages: false,
        repositories: [
          { name: "app", url: "org/app", description: "App", access: { read: "member" } },
        ],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        if (!("threadAutoRespondMaxAgeMinutes" in output))
          return "threadAutoRespondMaxAgeMinutes field missing";
        if (output.threadAutoRespondMaxAgeMinutes !== 60)
          return `Expected 60, got: ${output.threadAutoRespondMaxAgeMinutes}`;
        return null;
      },
    },
    {
      name: "Already migrated — preserves existing custom value",
      input: {
        reactions: { trigger: "robot_face" },
        directMessages: { enabled: true },
        mentions: { enabled: true },
        autoRespond: { enabled: false },
        allowScheduledMessages: false,
        threadAutoRespondMaxAgeMinutes: 30,
        repositories: [
          { name: "app", url: "org/app", description: "App", access: { read: "member" } },
        ],
        git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
        sessions: { cleanupIntervalMinutes: 5 },
        claudeCode: { model: "sonnet" },
      },
      validate: (output) => {
        if (!("threadAutoRespondMaxAgeMinutes" in output))
          return "threadAutoRespondMaxAgeMinutes was removed";
        if (output.threadAutoRespondMaxAgeMinutes !== 30)
          return `Expected 30 (preserved), got: ${output.threadAutoRespondMaxAgeMinutes}`;
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
        allowScheduledMessages: true,
        repositories: [
          {
            name: "app",
            url: "org/app",
            description: "App",
            access: { read: "member", write: "dev" },
          },
        ],
        git: { pullIntervalMinutes: 30, shallowClone: false, cloneDepth: 5 },
        sessions: { cleanupIntervalMinutes: 10 },
        claudeCode: { model: "opus" },
        changesWorkflow: { enabled: true, timeoutMinutes: 10 },
      },
      validate: (output) => {
        if (!("threadAutoRespondMaxAgeMinutes" in output))
          return "threadAutoRespondMaxAgeMinutes field missing";
        if (output.threadAutoRespondMaxAgeMinutes !== 60)
          return `Expected 60, got: ${output.threadAutoRespondMaxAgeMinutes}`;
        const reactions = output.reactions as { trigger?: string };
        if (reactions?.trigger !== "clack")
          return `reactions.trigger changed to ${reactions?.trigger}`;
        if (output.allowScheduledMessages !== true) return "allowScheduledMessages was modified";
        return null;
      },
    },
  ],
};
