import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { ProposeConfigUpdateDeps } from "./proposeConfigUpdate.js";
import { parseToolResult } from "../testHelpers.js";
import { callTool, makeDeps } from "./proposeConfigUpdate.testHelpers.js";

describe("proposeConfigUpdate tool — delete operation", () => {
  it("stages a delete intent for a path with a custom override", async () => {
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: "default content",
        custom_content: "custom override",
      })),
    });

    const { result, store } = callTool(
      {
        role: "user",
        file: "identity.md",
        operation: "delete",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal(staged.type, "config_update");
    assert.equal((staged as { operation: string }).operation, "delete");
    assert.equal((staged as { file: string }).file, "user/identity.md");
    assert.equal((staged as { content?: string }).content, undefined);
  });

  it("returns will_revert_to_default when default exists", async () => {
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: "default content",
        custom_content: "custom override",
      })),
    });

    const { result } = callTool(
      {
        role: "user",
        file: "identity.md",
        operation: "delete",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    assert.equal(parsed.status, "will_revert_to_default");
  });

  it("returns will_delete_custom_only when no default exists", async () => {
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: null,
        custom_content: "custom-only content",
      })),
    });

    const { result } = callTool(
      {
        role: "user",
        file: "company-context.md",
        operation: "delete",
      },
      deps,
    );

    const parsed = parseToolResult(await result);
    assert.equal(parsed.status, "will_delete_custom_only");
  });

  it("refuses delete when no custom override exists (default only)", async () => {
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: "default only",
        custom_content: null,
      })),
    });

    const { result, store } = callTool(
      {
        role: "user",
        file: "identity.md",
        operation: "delete",
      },
      deps,
    );

    const awaited = await result;
    assert.equal(awaited.isError, true);
    const parsed = parseToolResult(awaited);
    assert.match(parsed.error, /no custom override/i);
    assert.equal(store.getAll().size, 0);
  });

  it("refuses delete when file does not exist at any tier", async () => {
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: null,
        custom_content: null,
      })),
    });

    const { result, store } = callTool(
      {
        role: "user",
        file: "ghost.md",
        operation: "delete",
      },
      deps,
    );

    const awaited = await result;
    assert.equal(awaited.isError, true);
    assert.equal(store.getAll().size, 0);
  });

  it("refuses delete with a non-empty content field", async () => {
    const deps = makeDeps({
      readInstructionFile: vi.fn<ProposeConfigUpdateDeps["readInstructionFile"]>(() => ({
        default_content: null,
        custom_content: "something",
      })),
    });

    const { result, store } = callTool(
      {
        role: "user",
        file: "identity.md",
        operation: "delete",
        content: "should not be here",
      },
      deps,
    );

    const awaited = await result;
    assert.equal(awaited.isError, true);
    const parsed = parseToolResult(awaited);
    assert.match(parsed.error, /content.*must be omitted/i);
    assert.equal(store.getAll().size, 0);
  });
});
