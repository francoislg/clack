import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { SDKMessage, SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import type { UUID } from "node:crypto";
import { runClaude, type RunClaudeDeps } from "./execution.js";
import { getWorkerSettingsPath, type Config } from "../config.js";
import type { ClackSessionRun, ClackSessionParams } from "../claude/query.js";
import { createRunHandle } from "../claude/runHandle.js";

vi.mock("node:fs", async (importActual) => ({
  ...(await importActual<typeof import("node:fs")>()),
  existsSync: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    repositories: [],
    ...overrides,
  } as Config;
}

/**
 * Build a `ClackSessionRun` whose `messages` iterable hangs until the driver's internal
 * AbortController fires (via `run.stop()` or external bridge), then throws an AbortError —
 * simulating a real SDK abort. Returns the run plus its driver controller so callers can
 * inspect or assert.
 */
function makeHangingRun(): ClackSessionRun {
  const driver = createRunHandle({
    push: () => {},
    closeInput: () => {},
  });
  const messages: AsyncIterable<SDKMessage> = {
    [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
      return {
        next(): Promise<IteratorResult<SDKMessage>> {
          return new Promise((_resolve, reject) => {
            driver.abortController.signal.addEventListener("abort", () => {
              const err = new Error("aborted by user");
              err.name = "AbortError";
              reject(err);
            });
          });
        },
      };
    },
  };
  return Object.assign(driver, { messages });
}

/**
 * RunClaudeDeps that returns a hanging run whose iterator only resolves when the run's
 * internal AbortController fires. `runClaude` wires its own timeout and the external
 * `abortController` option to `run.stop()`, which aborts that internal controller.
 */
function makeHangingDeps(): RunClaudeDeps {
  return {
    getConfig: vi.fn(() => makeConfig()),
    clackSession: vi.fn((_params: ClackSessionParams): ClackSessionRun => makeHangingRun()),
  };
}

// ============================================================================
// runClaude — timeout abort path
// ============================================================================

describe("runClaude — timeout abort", () => {
  it("returns timeout error when execution exceeds the configured timeout", async () => {
    const deps = makeHangingDeps();

    const result = await runClaude({
      prompt: "do something",
      cwd: "/tmp",
      // 0 minutes → setTimeout fires with 0ms delay, run.stop("timeout") aborts the
      // driver's internal controller, which is what the hanging iterator listens on.
      timeout: 0,
      _deps: deps,
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("timed out"), `expected timeout error, got: ${result.error}`);
  });

  it("returns cancellation error when aborted without timeout", async () => {
    const ac = new AbortController();
    const deps = makeHangingDeps();

    // Abort externally before the (long) timeout fires; runClaude's bridge converts
    // ac.abort() → run.stop("aborted") → driver controller fires → iterator throws.
    const claudePromise = runClaude({
      prompt: "do something",
      cwd: "/tmp",
      timeout: 60,
      abortController: ac,
      _deps: deps,
    });
    queueMicrotask(() => ac.abort());
    const result = await claudePromise;

    assert.equal(result.success, false);
    assert.equal(result.error, "Execution cancelled");
  });

  it("returns early with empty prompt error without calling clackSession", async () => {
    let sessionCallCount = 0;
    const deps: RunClaudeDeps = {
      getConfig: vi.fn(() => makeConfig()),
      clackSession: (_params: ClackSessionParams): ClackSessionRun => {
        sessionCallCount++;
        throw new Error("clackSession should not be called");
      },
    };

    const result = await runClaude({ prompt: "", cwd: "/tmp", _deps: deps });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("empty prompt"));
    assert.equal(sessionCallCount, 0);
  });
});

// ============================================================================
// runClaude — usage capture
// ============================================================================

function makeRunFromMessages(messages: SDKMessage[]): ClackSessionRun {
  const driver = createRunHandle({ push: () => {}, closeInput: () => {} });
  const iterable: AsyncIterable<SDKMessage> = {
    async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
      for (const m of messages) yield m;
    },
  };
  return Object.assign(driver, { messages: iterable });
}

function resultSuccessWithUsage(text: string, usage: SDKResultSuccess["usage"]): SDKResultSuccess {
  return {
    type: "result",
    subtype: "success",
    result: text,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0.75,
    usage,
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-0000-0000-000000000000" as UUID,
    session_id: "test",
  };
}

describe("runClaude — usage capture", () => {
  it("surfaces usage from the result message", async () => {
    const resultMsg = resultSuccessWithUsage("done", {
      input_tokens: 50,
      output_tokens: 12,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 8,
    } as SDKResultSuccess["usage"]);
    const deps: RunClaudeDeps = {
      getConfig: vi.fn(() => makeConfig()),
      clackSession: vi.fn(() => makeRunFromMessages([resultMsg])),
    };

    const result = await runClaude({ prompt: "do something", cwd: "/tmp", _deps: deps });

    assert.equal(result.success, true);
    assert.deepEqual(result.usage, {
      inputTokens: 50,
      outputTokens: 12,
      cacheReadTokens: 200,
      cacheCreationTokens: 8,
      costUsd: 0.75,
    });
  });
});

// ============================================================================
// runClaude — worker settings forwarding
// ============================================================================

describe("runClaude — worker settings forwarding", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
  });

  function captureOptions(): {
    deps: RunClaudeDeps;
    getOptions: () => ClackSessionParams["options"];
  } {
    const clackSession = vi.fn((_params: ClackSessionParams) =>
      makeRunFromMessages([resultSuccessWithUsage("ok", {} as SDKResultSuccess["usage"])]),
    );
    return {
      deps: { getConfig: vi.fn(() => makeConfig()), clackSession },
      getOptions: () => clackSession.mock.calls[0]![0].options,
    };
  }

  it("forwards the absolute settings path when the file exists", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const { deps, getOptions } = captureOptions();

    await runClaude({ prompt: "go", cwd: "/some/worktree/path", _deps: deps });

    assert.equal(getOptions()?.settings, getWorkerSettingsPath());
    // Absolute + independent of the per-run worktree cwd.
    assert.ok(!String(getOptions()?.settings).startsWith("/some/worktree/path/"));
  });

  it("omits settings when the file is absent (isolation mode)", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const { deps, getOptions } = captureOptions();

    await runClaude({ prompt: "go", cwd: "/tmp", _deps: deps });

    assert.equal(getOptions()?.settings, undefined);
  });

  it("keeps the bash guard hook registered regardless of settings presence", async () => {
    for (const present of [true, false]) {
      vi.mocked(existsSync).mockReturnValue(present);
      const { deps, getOptions } = captureOptions();

      await runClaude({ prompt: "go", cwd: "/tmp", _deps: deps });

      assert.equal(getOptions()?.hooks?.PreToolUse?.length, 1);
    }
  });
});
