import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { ProposeConfigUpdateDeps } from "./proposeConfigUpdate.js";
import { parseToolResult } from "../testHelpers.js";
import { callTool, makeDeps } from "./proposeConfigUpdate.testHelpers.js";

describe("proposeConfigUpdate tool — write paths (append/replace)", () => {
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
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
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
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
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
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
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
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
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
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
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
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
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
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
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

  // --- Intent staging (write) ---

  it("stages write intent with operation=write and file path on append/replace", async () => {
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
    assert.equal((staged as { operation: string }).operation, "write");
    assert.equal((staged as { file: string }).file, "dev/changes.md");
    assert.equal((staged as { content: string }).content, "my content");
  });

  // --- Content-presence validation ---

  it("refuses append with missing content", async () => {
    const { result, store } = callTool({
      role: "user",
      file: "identity.md",
      operation: "append",
    });

    const awaited = await result;
    assert.equal(awaited.isError, true);
    const parsed = parseToolResult(awaited);
    assert.match(parsed.error, /content.*required/i);
    assert.equal(store.getAll().size, 0);
  });

  it("refuses replace with missing content", async () => {
    const { result, store } = callTool({
      role: "user",
      file: "identity.md",
      operation: "replace",
    });

    const awaited = await result;
    assert.equal(awaited.isError, true);
    assert.equal(store.getAll().size, 0);
  });
});

describe("proposeConfigUpdate tool — repo-scoped paths", () => {
  it("composes a repo path from repo + file and stages a write intent", async () => {
    const { result, store } = callTool({
      repo: "applauz-monorepo",
      file: "changes_instructions.md",
      content: "do the thing",
      operation: "replace",
    });

    const parsed = parseToolResult(await result);
    assert.equal(parsed.file, "applauz-monorepo/changes_instructions.md");
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal((staged as { operation: string }).operation, "write");
    assert.equal((staged as { file: string }).file, "applauz-monorepo/changes_instructions.md");
    assert.equal((staged as { content: string }).content, "do the thing");
  });

  it("appends to existing repo file content", async () => {
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: null,
        custom_content: "existing setup",
      })),
    });

    const { result, store } = callTool(
      {
        repo: "applauz-monorepo",
        file: "worktree_setup_instructions.md",
        content: "more setup",
        operation: "append",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.equal((staged as { content: string }).content, "existing setup\n\nmore setup");
  });

  it("stages a delete intent for a repo override", async () => {
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: null,
        custom_content: "custom repo instructions",
      })),
    });

    const { result, store } = callTool(
      {
        repo: "applauz-monorepo",
        file: "changes_instructions.md",
        operation: "delete",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal((staged as { operation: string }).operation, "delete");
    assert.equal((staged as { file: string }).file, "applauz-monorepo/changes_instructions.md");
  });

  it("errors for an unknown repo without staging", async () => {
    const { result, store } = callTool({
      repo: "ghost-repo",
      file: "changes_instructions.md",
      content: "x",
      operation: "replace",
    });

    const awaited = await result;
    assert.equal(awaited.isError, true);
    const parsed = parseToolResult(awaited);
    assert.ok(parsed.error.includes("ghost-repo"));
    assert.ok(parsed.error.includes("applauz-monorepo"));
    assert.equal(store.getAll().size, 0);
  });

  it("errors when repo file is outside the editable set without staging", async () => {
    const { result, store } = callTool({
      repo: "applauz-monorepo",
      file: "secrets.md",
      content: "x",
      operation: "replace",
    });

    const awaited = await result;
    assert.equal(awaited.isError, true);
    const parsed = parseToolResult(awaited);
    assert.ok(parsed.error.includes("changes_instructions.md"));
    assert.equal(store.getAll().size, 0);
  });

  it("errors when both role and repo are provided without staging", async () => {
    const { result, store } = callTool({
      role: "admin",
      repo: "applauz-monorepo",
      file: "changes_instructions.md",
      content: "x",
      operation: "replace",
    });

    const awaited = await result;
    assert.equal(awaited.isError, true);
    const parsed = parseToolResult(awaited);
    assert.ok(parsed.error.includes("exactly one"));
    assert.equal(store.getAll().size, 0);
  });
});
