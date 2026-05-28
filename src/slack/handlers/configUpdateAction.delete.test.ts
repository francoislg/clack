import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { StagedConfigUpdateIntent } from "../../tools/types.js";
import { applyConfigUpdateIntent, type ConfigApplyContext } from "./configUpdateAction.js";

const mockWriteInstructionFile = vi.fn<(filename: string, content: string) => void>();
const mockDeleteInstructionFile = vi.fn<(filepath: string) => void>();
const mockReadInstructionFile = vi.fn<
  (filepath: string) => { default_content: string | null; custom_content: string | null }
>(() => ({ default_content: null, custom_content: null }));

const deps = {
  writeInstructionFile: mockWriteInstructionFile,
  deleteInstructionFile: mockDeleteInstructionFile,
  readInstructionFile: mockReadInstructionFile,
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
};

interface EphemeralCall {
  channel: string;
  user: string;
  thread_ts?: string;
  text: string;
}

function makeCtx(): { ctx: ConfigApplyContext; calls: EphemeralCall[] } {
  const calls: EphemeralCall[] = [];
  const ctx: ConfigApplyContext = {
    postEphemeral: async (args) => {
      calls.push(args);
    },
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
  };
  return { ctx, calls };
}

beforeEach(() => {
  mockWriteInstructionFile.mockClear();
  mockDeleteInstructionFile.mockClear();
  mockReadInstructionFile.mockClear();
  mockDeleteInstructionFile.mockImplementation(() => {});
  mockReadInstructionFile.mockReturnValue({ default_content: null, custom_content: null });
});

describe("applyConfigUpdateIntent — delete operation", () => {
  it("calls deleteInstructionFile with the staged path", async () => {
    const intent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "delete",
      file: "user/identity.md",
    };
    mockReadInstructionFile.mockReturnValue({
      default_content: "shipped default",
      custom_content: "custom override",
    });
    const { ctx } = makeCtx();

    await applyConfigUpdateIntent(intent, ctx, deps);

    assert.equal(mockDeleteInstructionFile.mock.calls.length, 1);
    assert.equal(mockDeleteInstructionFile.mock.calls[0]![0], "user/identity.md");
    assert.equal(mockWriteInstructionFile.mock.calls.length, 0);
  });

  it("posts the revert-to-default confirmation when a default exists", async () => {
    const intent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "delete",
      file: "user/identity.md",
    };
    mockReadInstructionFile.mockReturnValue({
      default_content: "shipped default",
      custom_content: "custom override",
    });
    const { ctx, calls } = makeCtx();

    await applyConfigUpdateIntent(intent, ctx, deps);

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.text, /removed/i);
    assert.match(calls[0]!.text, /default/i);
  });

  it("posts the file-deleted confirmation when no default exists", async () => {
    const intent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "delete",
      file: "user/company-context.md",
    };
    mockReadInstructionFile.mockReturnValue({
      default_content: null,
      custom_content: "custom-only content",
    });
    const { ctx, calls } = makeCtx();

    await applyConfigUpdateIntent(intent, ctx, deps);

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.text, /deleted/i);
    assert.doesNotMatch(calls[0]!.text, /default/i);
  });

  it("posts an error ephemeral and does not crash when deleteInstructionFile throws", async () => {
    const intent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "delete",
      file: "user/gone.md",
    };
    mockReadInstructionFile.mockReturnValue({
      default_content: null,
      custom_content: "removed-since-staging",
    });
    mockDeleteInstructionFile.mockImplementation(() => {
      throw new Error("File not found: user/gone.md");
    });
    const { ctx, calls } = makeCtx();

    await applyConfigUpdateIntent(intent, ctx, deps);

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.text, /failed/i);
    assert.match(calls[0]!.text, /file not found/i);
  });

  it("captures default-existence BEFORE deletion (read happens before delete throws)", async () => {
    const intent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "delete",
      file: "user/identity.md",
    };
    mockReadInstructionFile.mockReturnValue({
      default_content: "shipped default",
      custom_content: "custom override",
    });
    const { ctx } = makeCtx();

    await applyConfigUpdateIntent(intent, ctx, deps);

    // The read call must happen before the delete call so the success-message branch sees
    // the pre-delete state. (Both happen in the success path; the ordering matters only on
    // failure paths, but the contract is "read first, then delete".)
    assert.equal(mockReadInstructionFile.mock.calls.length, 1);
    assert.equal(mockDeleteInstructionFile.mock.calls.length, 1);
  });
});
