import type { ClaudeResponse } from "./index.js";

export type ClaudeRunStatus = "running" | "settled" | "stopped";

/** Error variant accepted by `ClaudeRunDriver.fail`. */
export type RunFailureError = Error | string;

/**
 * Public control surface for an in-progress multi-turn Claude run.
 *
 * Returned by `clackSession`. Consumers (Slack handlers, the active-runs registry) interact
 * with a run through this interface — they push follow-up messages with `sendUpdate`, stop
 * the run with `stop`, or wait for completion via `futureResponse`.
 */
export interface ClaudeRunHandle {
  /**
   * Push a follow-up user message into the live Query. Non-interrupting: the model sees it
   * after the current turn finishes (which, under first-result-wins semantics, means the
   * message lands only if it arrives before the first `result`).
   *
   * Resolves once the message is queued. Rejects if the run is no longer `running`.
   */
  sendUpdate(text: string): Promise<void>;

  /**
   * Stop the run. Aborts the underlying SDK Query and closes the input stream. Idempotent.
   * The reason is forwarded to consumers via the `cancelled` field on `futureResponse`.
   */
  stop(reason?: string): Promise<void>;

  /** Resolves with the run's final `ClaudeResponse`. */
  readonly futureResponse: Promise<ClaudeResponse>;

  /** Lifecycle state. Transitions running → settled (success/error) | stopped (aborted). */
  readonly status: ClaudeRunStatus;

  /**
   * True when at least one `sendUpdate` push is queued in the SDK input stream and has not
   * yet been consumed by the SDK. Used to gate `submit_response` so Claude is forced to
   * read queued user messages before finalizing its answer.
   */
  hasPendingInput(): boolean;
}

/**
 * Internal driver interface used by `clackSession` and its consumers (`askClaude`,
 * `executeChange`). Adds the settle/fail callbacks the consumer's for-await loop calls
 * when its run concludes.
 *
 * Slack handlers do NOT touch this interface — they only see `ClaudeRunHandle`.
 */
export interface ClaudeRunDriver extends ClaudeRunHandle {
  /**
   * Caller invokes this once its consumer loop has built the final ClaudeResponse.
   * Idempotent — only the first call has effect. Flips `status` to "settled" and resolves
   * `futureResponse`.
   */
  settle(response: ClaudeResponse): void;

  /**
   * Caller invokes this if its consumer loop threw. Maps the failure to a ClaudeResponse
   * (cancelled if the abort signal fired; otherwise a generic error). Idempotent.
   */
  fail(error: RunFailureError): void;

  /**
   * Internal AbortController. Forwarded to the SDK's `query()` options. `stop()` aborts it.
   */
  readonly abortController: AbortController;
}

export interface CreateRunHandleOptions {
  /**
   * Called by `sendUpdate` to deliver a new prompt. The wrapper that creates the handle is
   * responsible for serializing this into an `SDKUserMessage` and pushing it onto the
   * SDK's input stream (with any buffering/replay needed for resume fallback).
   */
  push: (text: string) => void;

  /**
   * Called when the run terminates (settle, stop, or fail) to close the SDK input stream.
   * The wrapper uses this to signal end-of-input to the underlying CLI subprocess.
   */
  closeInput: () => void;

  /**
   * Returns whether the SDK input stream still has unread items pushed via `sendUpdate`.
   * Backed by `PushableAsyncIterable.pendingCount` in production. Defaults to `false`.
   */
  isInputPending?: () => boolean;

  /**
   * Optional hook fired exactly once when the handle settles or stops. Used by callers that
   * need cleanup tied to lifecycle (e.g., active-runs registry deregistration).
   */
  onTerminal?: () => void;
}

/**
 * Construct a fresh `ClaudeRunDriver`. The driver's status starts as "running" and flips
 * to "settled" or "stopped" exactly once.
 */
export function createRunHandle(options: CreateRunHandleOptions): ClaudeRunDriver {
  const abortController = new AbortController();

  let status: ClaudeRunStatus = "running";
  let stopReason: string | undefined;
  let resolveFuture!: (value: ClaudeResponse) => void;

  const futureResponse = new Promise<ClaudeResponse>((resolve) => {
    resolveFuture = resolve;
  });

  let terminalFired = false;
  function fireTerminal(): void {
    if (terminalFired) return;
    terminalFired = true;
    try {
      options.onTerminal?.();
    } catch {
      // Swallow — caller's cleanup must not break the handle.
    }
  }

  async function sendUpdate(text: string): Promise<void> {
    if (status !== "running") {
      throw new Error(`Cannot sendUpdate: run is ${status}`);
    }
    options.push(text);
  }

  async function stop(reason?: string): Promise<void> {
    if (status !== "running") return;
    status = "stopped";
    stopReason = reason;
    options.closeInput();
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
    resolveFuture({
      success: false,
      cancelled: true,
      answer: "",
      error: reason,
    });
    fireTerminal();
  }

  function settle(response: ClaudeResponse): void {
    if (status !== "running") return;
    status = "settled";
    options.closeInput();
    resolveFuture(response);
    fireTerminal();
  }

  function fail(error: RunFailureError): void {
    if (status !== "running") return;
    const isAbortError = error instanceof Error && error.name === "AbortError";
    const isSignalAbort =
      abortController.signal.aborted && error instanceof Error && /aborted/i.test(error.message);
    const cancelled = isAbortError || isSignalAbort;
    status = "settled";
    options.closeInput();
    resolveFuture(
      cancelled
        ? { success: false, cancelled: true, answer: "", error: stopReason }
        : {
            success: false,
            answer: "",
            error: error instanceof Error ? error.message : error,
          },
    );
    fireTerminal();
  }

  return {
    abortController,
    futureResponse,
    get status() {
      return status;
    },
    sendUpdate,
    stop,
    settle,
    fail,
    hasPendingInput: () => options.isInputPending?.() ?? false,
  };
}
