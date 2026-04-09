import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { runClaude, type RunClaudeDeps } from "./execution.js";
import type { Config } from "../config.js";

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
 * Builds a RunClaudeDeps where clackSession hangs until the AbortController
 * fires, then throws an AbortError — simulating a real SDK abort.
 */
function makeHangingDeps(abortController: AbortController): RunClaudeDeps {
  return {
    getConfig: mock.fn(() => makeConfig()),
    clackSession: mock.fn((): AsyncIterable<SDKMessage> => {
      return {
        [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
          return {
            next(): Promise<IteratorResult<SDKMessage>> {
              return new Promise((_resolve, reject) => {
                abortController.signal.addEventListener("abort", () => {
                  const err = new Error("aborted by user");
                  err.name = "AbortError";
                  reject(err);
                });
              });
            },
          };
        },
      };
    }),
  };
}

// ============================================================================
// runClaude — timeout abort path
// ============================================================================

describe("runClaude — timeout abort", () => {
  it("returns timeout error when execution exceeds the configured timeout", async () => {
    const ac = new AbortController();
    const deps = makeHangingDeps(ac);

    const result = await runClaude({
      prompt: "do something",
      cwd: "/tmp",
      // 0 minutes → setTimeout fires with 0ms delay, setting timedOut = true
      timeout: 0,
      abortController: ac,
      _deps: deps,
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("timed out"), `expected timeout error, got: ${result.error}`);
  });

  it("returns cancellation error when aborted without timeout", async () => {
    const ac = new AbortController();
    const deps = makeHangingDeps(ac);

    // Abort externally before the (long) timeout fires
    setTimeout(() => ac.abort(), 10);

    const result = await runClaude({
      prompt: "do something",
      cwd: "/tmp",
      timeout: 60,
      abortController: ac,
      _deps: deps,
    });

    assert.equal(result.success, false);
    assert.equal(result.error, "Execution cancelled");
  });

  it("returns early with empty prompt error without calling clackSession", async () => {
    let sessionCallCount = 0;
    const deps: RunClaudeDeps = {
      getConfig: mock.fn(() => makeConfig()),
      clackSession: (): AsyncIterable<SDKMessage> => {
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
