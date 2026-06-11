import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 024: fold trivia's standalone users.json into the central
 * data/state/users.json registry, then drop the trivia file.
 */

const REGISTRY = "data/state/users.json";
const TRIVIA = "data/plugins/trivia/users.json";

interface TriviaNamespace {
  joinedAt?: number;
  cheatAttempts?: number;
}

interface RegistryRecord {
  userId: string;
  displayName: string;
  lastFetched: number;
  plugins?: { trivia?: TriviaNamespace; other?: { foo?: string } };
}

function parseRegistry(output: Record<string, string>): Record<string, RegistryRecord> | string {
  const raw = output[REGISTRY];
  if (!raw) return `${REGISTRY} missing from output`;
  const parsed: Record<string, RegistryRecord> = JSON.parse(raw);
  return parsed;
}

export const test: MigrationTest = {
  version: 24,
  fileCases: [
    {
      name: "folds trivia users into a fresh registry and removes the trivia file",
      inputFiles: {
        [TRIVIA]: JSON.stringify({
          U1: { userId: "U1", displayName: "Alice", joinedAt: 1000, cheatAttempts: 2 },
          U2: { userId: "U2", displayName: "Bob", joinedAt: 2000 },
        }),
      },
      additionalOutputPaths: [REGISTRY],
      validateFiles: (output) => {
        if (output[TRIVIA] !== undefined) return "trivia users.json should have been removed";
        const reg = parseRegistry(output);
        if (typeof reg === "string") return reg;
        if (reg.U1?.displayName !== "Alice") return "U1 identity not carried over";
        if (reg.U1?.lastFetched !== 0) return "U1 lastFetched should be 0";
        if (reg.U1?.plugins?.trivia?.joinedAt !== 1000)
          return "U1 joinedAt not in trivia namespace";
        if (reg.U1?.plugins?.trivia?.cheatAttempts !== 2) return "U1 cheatAttempts not carried";
        if (reg.U2?.plugins?.trivia?.joinedAt !== 2000) return "U2 joinedAt not carried";
        if ("cheatAttempts" in (reg.U2?.plugins?.trivia ?? {}))
          return "U2 should have no cheatAttempts";
        return null;
      },
    },
    {
      name: "merges into an existing registry, preserving identity, lastFetched, and other plugins",
      inputFiles: {
        [TRIVIA]: JSON.stringify({
          U1: { userId: "U1", displayName: "Stale", joinedAt: 1000, cheatAttempts: 1 },
        }),
        [REGISTRY]: JSON.stringify({
          U1: {
            userId: "U1",
            displayName: "Fresh",
            lastFetched: 555,
            plugins: { other: { foo: "bar" } },
          },
        }),
      },
      additionalOutputPaths: [REGISTRY],
      validateFiles: (output) => {
        if (output[TRIVIA] !== undefined) return "trivia users.json should have been removed";
        const reg = parseRegistry(output);
        if (typeof reg === "string") return reg;
        if (reg.U1?.displayName !== "Fresh") return "existing identity should win";
        if (reg.U1?.lastFetched !== 555) return "existing lastFetched should be preserved";
        if (reg.U1?.plugins?.other?.foo !== "bar") return "other plugin namespace dropped";
        if (reg.U1?.plugins?.trivia?.cheatAttempts !== 1) return "trivia namespace not merged in";
        return null;
      },
    },
    {
      name: "omits a zero cheatAttempts counter",
      inputFiles: {
        [TRIVIA]: JSON.stringify({
          U1: { userId: "U1", displayName: "Alice", joinedAt: 1000, cheatAttempts: 0 },
        }),
      },
      additionalOutputPaths: [REGISTRY],
      validateFiles: (output) => {
        const reg = parseRegistry(output);
        if (typeof reg === "string") return reg;
        if ("cheatAttempts" in (reg.U1?.plugins?.trivia ?? {}))
          return "zero cheatAttempts should be omitted";
        if (reg.U1?.plugins?.trivia?.joinedAt !== 1000) return "joinedAt should still carry";
        return null;
      },
    },
    {
      name: "no trivia file — no-op (idempotent re-run)",
      inputFiles: {},
      additionalOutputPaths: [REGISTRY],
      validateFiles: (output) => {
        if (output[REGISTRY] !== undefined)
          return "registry should not be created when nothing to migrate";
        return null;
      },
    },
    {
      name: "empty trivia users — leaves both files untouched",
      inputFiles: { [TRIVIA]: JSON.stringify({}) },
      additionalOutputPaths: [REGISTRY],
      validateFiles: (output) => {
        if (output[REGISTRY] !== undefined) return "registry should not be created for zero users";
        if (output[TRIVIA] === undefined) return "empty trivia file should be left in place";
        return null;
      },
    },
  ],
};
