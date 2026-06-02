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
   * True when at least one `sendUpdate` push is queued and has not yet been observed by
   * Claude. Used to gate `submit_response` so Claude is forced to read queued user
   * messages before finalizing its answer.
   */
  hasPendingInput(): boolean;

  /**
   * Return AND clear the texts of every queued `sendUpdate` push that Claude has not yet
   * observed. After this call, `hasPendingInput()` returns false until a fresh `sendUpdate`
   * lands. Called by `submit_response`'s pending-input gate to inline the queued texts into
   * its error result — that's how Claude actually sees mid-turn user follow-ups (the SDK
   * input stream only surfaces messages at turn boundaries, which never arrive while
   * `submit_response` keeps the assistant in `tool_use`).
   */
  consumePendingPushedTexts(): string[];

  /**
   * True once this run has delivered a user-facing response (a successful primary
   * `submit_response` delivery). After this flips true, `sendUpdate` rejects — a follow-up
   * arriving after the response was already delivered must spawn a FRESH run (new streamer,
   * new delivery context) rather than be absorbed here, where the per-run delivery latch
   * would silently swallow it. The Slack handler treats the `sendUpdate` rejection as its
   * cue to spawn fresh.
   */
  hasDelivered(): boolean;
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

  /**
   * Mark that this run has delivered a user-facing response. Called by the delivery wrapper
   * in `askClaude` when a primary `submit_response` delivery succeeds. Idempotent — only the
   * first call has effect. Once set, `sendUpdate` rejects so later follow-ups spawn fresh runs.
   */
  markDelivered(): void;
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
   * Returns whether there are unread `sendUpdate` pushes Claude hasn't observed. Defaults
   * to `false`.
   */
  isInputPending?: () => boolean;

  /**
   * Returns AND clears the texts of every unobserved push. Defaults to returning `[]`. The
   * production wrapper backs this with the same array that `isInputPending` measures, so
   * the two stay in sync.
   */
  consumePendingPushedTexts?: () => string[];

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
  let delivered = false;
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
    // A response already reached the user in this run. Absorbing the follow-up here would
    // route it into a delivery context whose one-shot latch is already spent (and whose
    // streamer is already stopped), so it would never surface. Reject so the caller spawns
    // a fresh run instead.
    if (delivered) {
      throw new Error("Cannot sendUpdate: run already delivered a response");
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
    markDelivered: () => {
      delivered = true;
    },
    hasDelivered: () => delivered,
    hasPendingInput: () => options.isInputPending?.() ?? false,
    consumePendingPushedTexts: () => options.consumePendingPushedTexts?.() ?? [],
  };
}
