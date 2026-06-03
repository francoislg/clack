import { vi } from "vitest";
import {
  createProposeConfigUpdateTool,
  type ProposeConfigUpdateDeps,
} from "./proposeConfigUpdate.js";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";

const fakeSession = {
  sessionId: "sess-1",
  channelId: "C1",
  messageTs: "1.0",
  threadTs: "1.0",
  userId: "U123",
  trigger: { type: "mentions", userId: "U123", messageTs: "1.0", messageText: "test" },
  messages: [],
  threadContext: [],
  errors: [],
  lastActivity: Date.now(),
  createdAt: Date.now(),
};
const fakeConfig = {};

export function makeDeps(overrides?: Partial<ProposeConfigUpdateDeps>): ProposeConfigUpdateDeps {
  return {
    readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
      default_content: null,
      custom_content: null,
    })),
    getConfiguredRepoNames: vi.fn<ProposeConfigUpdateDeps["getConfiguredRepoNames"]>(() => [
      "applauz-monorepo",
    ]),
    ...overrides,
  };
}

export function makeCtx(overrides?: Partial<QueryToolContext>): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "admin",
    session: fakeSession as QueryToolContext["session"],
    config: fakeConfig as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    ...overrides,
  };
}

export interface StagedRecord {
  type: string;
  operation?: string;
  file?: string;
  content?: string;
}

export function makeIntentStore(): IntentStore {
  const intents = new Map<string, StagedRecord>();
  let counter = 0;
  const store: IntentStore = {
    stage: (intent) => {
      const ref = `ref-${++counter}`;
      const record: StagedRecord = { type: intent.type };
      if ("operation" in intent) record.operation = intent.operation;
      if ("file" in intent) record.file = intent.file;
      if ("content" in intent) record.content = intent.content;
      intents.set(ref, record);
      return ref;
    },
    resolve: (ref: string) => {
      const record = intents.get(ref);
      return record as ReturnType<IntentStore["resolve"]>;
    },
    getAll: () => intents as ReturnType<IntentStore["getAll"]>,
  };
  return store;
}

export type ProposeArgs = {
  role?: "user" | "dev" | "admin" | "owner";
  topic?: string;
  repo?: string;
  file: string;
  content?: string;
  operation?: "append" | "replace" | "delete";
};

export function callTool(args: ProposeArgs, deps?: ProposeConfigUpdateDeps) {
  const ctx = makeCtx();
  const store = makeIntentStore();
  const toolDef = createProposeConfigUpdateTool(ctx, store, deps ?? makeDeps());
  const fullArgs = {
    role: args.role,
    topic: args.topic,
    repo: args.repo,
    file: args.file,
    content: args.content,
    operation: args.operation ?? "append",
  };
  return { result: toolDef.handler(fullArgs, { sessionId: "test" }), store };
}
