import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createProposeConfigUpdateTool,
  type ProposeConfigUpdateDeps,
} from "./proposeConfigUpdate.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeDeps(overrides?: Partial<ProposeConfigUpdateDeps>): ProposeConfigUpdateDeps {
  return {
    readInstructionFile: mock.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
      default_content: null,
      custom_content: null,
    })),
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<QueryToolContext>): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "admin",
    session: fakeSession as QueryToolContext["session"],
    config: fakeConfig as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    ...overrides,
  };
}

interface StagedRecord {
  type: string;
  file?: string;
  content?: string;
}

function makeIntentStore(): IntentStore {
  const intents = new Map<string, StagedRecord>();
  let counter = 0;
  const store: IntentStore = {
    stage: (intent) => {
      const ref = `ref-${++counter}`;
      const record: StagedRecord = { type: intent.type };
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

type ProposeArgs = {
  role: "user" | "dev" | "admin" | "owner";
  topic?: string;
  file: string;
  content: string;
  operation?: "append" | "replace";
};

function callTool(args: ProposeArgs, deps?: ProposeConfigUpdateDeps) {
  const ctx = makeCtx();
  const store = makeIntentStore();
  const toolDef = createProposeConfigUpdateTool(ctx, store, deps ?? makeDeps());
  const fullArgs = {
    role: args.role,
    topic: args.topic,
    file: args.file,
    content: args.content,
    operation: args.operation ?? "append",
  };
  return { result: toolDef.handler(fullArgs, { sessionId: "test" }), store };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proposeConfigUpdate tool", () => {
  let deps: ProposeConfigUpdateDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  // --- Path composition ---

  it("composes a baseline path from role + file", async () => {
    const { result, store } = callTool({
      role: "user",
      file: "identity.md",
      content: "content",
      operation: "replace",
    });

    const parsed = parseToolResult(await result);
    assert.equal(parsed.file, "user/identity.md");
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal((staged as { file: string }).file, "user/identity.md");
  });

  it("composes a topic-scoped path from role + topic + file", async () => {
    const { result, store } = callTool({
      role: "dev",
      topic: "metabase",
      file: "rules.md",
      content: "content",
      operation: "replace",
    });

    const parsed = parseToolResult(await result);
    assert.equal(parsed.file, "dev/topics/metabase/rules.md");
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal((staged as { file: string }).file, "dev/topics/metabase/rules.md");
  });

  // --- Append operation ---

  it("appends to existing custom content when file has content (baseline)", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: "default stuff",
        custom_content: "existing line 1\nexisting line 2",
      })),
    });

    const { result, store } = callTool(
      {
        role: "user",
        file: "identity.md",
        content: "new content",
        operation: "append",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.equal(
      (staged as { content: string }).content,
      "existing line 1\nexisting line 2\n\nnew content",
    );
  });

  it("appends to existing topic file content", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: null,
        custom_content: "existing topic rules",
      })),
    });

    const { result, store } = callTool(
      {
        role: "dev",
        topic: "metabase",
        file: "rules.md",
        content: "more rules",
        operation: "append",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.equal((staged as { content: string }).content, "existing topic rules\n\nmore rules");
  });

  it("appends to default content when no custom exists", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: "default content",
        custom_content: null,
      })),
    });

    const { result, store } = callTool(
      {
        role: "user",
        file: "identity.md",
        content: "appended",
        operation: "append",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.equal((staged as { content: string }).content, "default content\n\nappended");
  });

  it("uses content as-is when file has no existing content (append, new topic)", async () => {
    const { result, store } = callTool({
      role: "user",
      topic: "newtopic",
      file: "rules.md",
      content: "brand new content",
      operation: "append",
    });

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.equal((staged as { content: string }).content, "brand new content");
  });

  it("treats omitted operation as append (zod default)", async () => {
    // The handler's signature has operation defaulted via zod `.default("append")`.
    // The SDK still passes `operation` through to the handler, but if a test omits
    // it the default kicks in. Here we explicitly pass "append" via the helper to
    // mirror the runtime shape; the schema-level default is covered by the
    // configFieldSchemas tests (no separate parsing needed here).
    deps = makeDeps({
      readInstructionFile: mock.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: null,
        custom_content: "first line",
      })),
    });

    const { result, store } = callTool(
      {
        role: "user",
        file: "identity.md",
        content: "second line",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.equal((staged as { content: string }).content, "first line\n\nsecond line");
  });

  // --- Replace operation ---

  it("replaces content completely when operation is replace", async () => {
    const { result, store } = callTool({
      role: "user",
      file: "identity.md",
      content: "completely new content",
      operation: "replace",
    });

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.equal((staged as { content: string }).content, "completely new content");
  });

  it("replace on a topic file stages the provided content byte-for-byte", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: "old default",
        custom_content: "old custom",
      })),
    });

    const { result, store } = callTool(
      {
        role: "dev",
        topic: "metabase",
        file: "rules.md",
        content: "fresh content",
        operation: "replace",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.equal((staged as { content: string }).content, "fresh content");
  });

  // --- Status field ---

  it("returns will_overwrite_custom when file has custom content", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: "default",
        custom_content: "custom",
      })),
    });

    const { result } = callTool(
      {
        role: "user",
        file: "identity.md",
        content: "content",
        operation: "replace",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    assert.equal(parsed.status, "will_overwrite_custom");
  });

  it("returns will_override_default when file has default but no custom", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: "default",
        custom_content: null,
      })),
    });

    const { result } = callTool(
      {
        role: "user",
        file: "identity.md",
        content: "content",
        operation: "replace",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    assert.equal(parsed.status, "will_override_default");
  });

  it("returns will_create_new when file has no content (new topic)", async () => {
    const { result } = callTool({
      role: "user",
      topic: "newtopic",
      file: "rules.md",
      content: "content",
      operation: "replace",
    });

    const parsed = parseToolResult(await result);
    assert.equal(parsed.status, "will_create_new");
  });

  // --- Intent staging ---

  it("stages intent with type=config_update and the composed file path", async () => {
    const { result, store } = callTool({
      role: "dev",
      file: "changes.md",
      content: "my content",
      operation: "replace",
    });

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal(staged.type, "config_update");
    assert.equal((staged as { file: string }).file, "dev/changes.md");
    assert.equal((staged as { content: string }).content, "my content");
  });
});
