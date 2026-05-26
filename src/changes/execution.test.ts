import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { runClaude, type RunClaudeDeps } from "./execution.js";
import type { Config } from "../config.js";
import type { ClackSessionRun, ClackSessionParams } from "../claude/query.js";
import { createRunHandle } from "../claude/runHandle.js";

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
