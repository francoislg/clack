/**
 * Wrappers around the Claude Agent SDK `query()` function.
 *
 * All call sites MUST use `clackQuery` or `clackSession` — never import
 * `query` directly from `@anthropic-ai/claude-agent-sdk`.
 *
 * - `clackQuery`   — fire-and-forget, no session persistence, string-prompt mode
 * - `clackSession` — persisted, resumable, streaming-input mode; returns a
 *                    `ClaudeRunDriver` so callers can `sendUpdate`/`stop` mid-run.
 */
import {
  query as _query,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { isResumeMissingError } from "./messageParser.js";
import { createPushableAsyncIterable, type PushableAsyncIterable } from "./pushableIterable.js";
import { createRunHandle, type ClaudeRunDriver } from "./runHandle.js";

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface QueryDeps {
  /**
   * The SDK's `query()` returns a `Query` (which extends `AsyncGenerator<SDKMessage>`).
   * We type the return as `Query` rather than `AsyncIterable<SDKMessage>` so wrappers
   * can access control methods like `setMcpServers()` — needed by `attach_integration`
   * for mid-session MCP attachment.
   */
  query: (...args: Parameters<typeof _query>) => Query;
}

export const defaultQueryDeps: QueryDeps = {
  query: _query,
};

/* -------------------------------------------------------------------------- */
/*  clackQuery — ephemeral, no persistence                                    */
/* -------------------------------------------------------------------------- */

export function clackQuery(
  params: {
    prompt: string;
    options?: Omit<Options, "persistSession" | "resume" | "continue">;
  },
  deps: QueryDeps = defaultQueryDeps,
): AsyncIterable<SDKMessage> {
  return deps.query({
    prompt: params.prompt,
    options: {
      ...params.options,
      persistSession: false,
      stderr: (data) => logger.warn(`[claude-stderr] ${data.trimEnd()}`),
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  clackSession — persisted & resumable, streaming-input mode                */
/* -------------------------------------------------------------------------- */

export interface ClackSessionParams {
  prompt: string;
  options?: Omit<Options, "persistSession" | "resume" | "continue" | "abortController">;
  /** SDK session ID from a previous turn — passed as `resume` */
  resumeSessionId?: string;
  /** Called once the SDK emits the init message with the session ID */
  onSessionId?: (sessionId: string) => void;
  /**
   * Called with the SDK `Query` handle as soon as `deps.query(...)` returns, before any
   * message is yielded. Tools that need mid-session control (e.g. `attach_integration`
   * calling `setMcpServers`) read the Query via a holder populated by this callback.
   * Fires again on the resume-fallback path with the fresh Query.
   */
  onQuery?: (query: Query) => void | Promise<void>;
  /**
   * Optional terminal hook — fires exactly once when the run settles or stops. The
   * active-runs registry uses this to deregister the handle.
   */
  onTerminal?: () => void;
  /**
   * Fires when a `resumeSessionId` run falls back to a fresh session (the backend has no
   * record of the session, or the resume attempt threw). The fresh session replays the
   * prompt WITHOUT the original conversation context — callers whose prompt only makes
   * sense against that context use this to abort rather than let it run. Must be
   * synchronous — it is not awaited, and a rejected promise would go unobserved.
   */
  onResumeFallback?: () => void;
}

/**
 * What `clackSession` returns: a `ClaudeRunDriver` (control surface + settle/fail) plus
 * an SDK message stream the consumer iterates. Callers that only need the public handle
 * (Slack handlers) upcast to `ClaudeRunHandle`.
 */
export interface ClackSessionRun extends ClaudeRunDriver {
  /** SDK message stream — the consumer's for-await loop drives this. */
  readonly messages: AsyncIterable<SDKMessage>;
}

function makeUserMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

function captureSessionId(message: SDKMessage, onSessionId?: (sessionId: string) => void): void {
  if (
    message.type === "system" &&
    "subtype" in message &&
    message.subtype === "init" &&
    "session_id" in message &&
    typeof message.session_id === "string"
  ) {
    onSessionId?.(message.session_id);
  }
}

/**
 * Start or resume a persisted SDK session in streaming-input mode.
 *
 * Returns a `ClackSessionRun` synchronously. Callers iterate `run.messages` to drive the
 * SDK stream, and call `run.settle(response)` / `run.fail(error)` when their consumer
 * loop concludes. Slack handlers that only need to push follow-up messages or stop the
 * run upcast to `ClaudeRunHandle` and use `sendUpdate` / `stop`.
 *
 * Resume-fallback: if `resumeSessionId` refers to a missing session, the wrapper closes
 * the current SDK query, creates a fresh input stream, replays the initial prompt and any
 * `sendUpdate`-pushed messages, and restarts on a fresh session. Errors thrown after
 * streaming has progressed past the failure window are NOT caught here — they surface
 * through the consumer's iteration of `messages` and are handled by `fail()`.
 */
export function clackSession(
  params: ClackSessionParams,
  deps: QueryDeps = defaultQueryDeps,
): ClackSessionRun {
  const { prompt, options, resumeSessionId, onSessionId, onQuery, onTerminal, onResumeFallback } =
    params;

  // Replay buffer — every SDKUserMessage pushed via the driver is appended here so the
  // resume-fallback path can replay them onto a fresh input stream.
  const replayBuffer: SDKUserMessage[] = [];
  let currentInputStream: PushableAsyncIterable<SDKUserMessage> = createPushableAsyncIterable();

  function pushUserMessage(msg: SDKUserMessage): void {
    replayBuffer.push(msg);
    if (!currentInputStream.ended) {
      currentInputStream.push(msg);
    }
  }

  // Seed the input with the initial prompt before the SDK is even started.
  const initialMessage = makeUserMessage(prompt);
  pushUserMessage(initialMessage);

  // Texts of every `sendUpdate`-pushed user message Claude has not yet observed. Each push
  // appends; messages get consumed either when the SDK delivers them as a new turn (turn-
  // boundary shift below) OR when `submit_response`'s gate surfaces them in its error
  // result. While non-empty, `submit_response` is gated so Claude is forced to address
  // queued input before finalizing.
  //
  // Turn-boundary detection: an assistant message with `stop_reason: end_turn` (or any
  // non-`tool_use` terminal reason) marks the END of the current turn — the SDK will
  // pull the next queued user message next. We flip `awaitingNextTurnStart = true`. The
  // FIRST assistant message after that flag is set is the START of a new turn (Claude
  // is now responding to the dequeued user message). At that point we shift the front.
  //
  // Why both consumption paths exist: turn-boundary delivery only happens when the
  // assistant emits a non-`tool_use` stop_reason, but `submit_response` is itself a tool
  // call, so a gated `submit_response` cycle never produces a turn boundary. Without the
  // gate-side consumption, Claude could never see mid-turn user input and would loop on
  // the gate forever. See `src/tools/presentation/submitResponse.ts` for the gate.
  const pendingPushedTexts: string[] = [];
  let awaitingNextTurnStart = false;

  const driver = createRunHandle({
    push: (text) => {
      pendingPushedTexts.push(text);
      pushUserMessage(makeUserMessage(text));
    },
    closeInput: () => {
      if (!currentInputStream.ended) currentInputStream.end();
    },
    isInputPending: () => pendingPushedTexts.length > 0,
    consumePendingPushedTexts: () => pendingPushedTexts.splice(0, pendingPushedTexts.length),
    ...(onTerminal && { onTerminal }),
  });

  /** Returns the assistant message's `stop_reason`, or null if not present/parseable. */
  function getAssistantStopReason(message: SDKMessage): string | null {
    if (message.type !== "assistant") return null;
    const inner = message.message as { stop_reason?: string | null } | undefined;
    return inner?.stop_reason ?? null;
  }

  /**
   * Observe a yielded SDK message and update turn-boundary tracking. Called once per
   * yielded message in both the resume-attempt and fallback message loops.
   */
  function observeTurnBoundary(message: SDKMessage): void {
    if (message.type !== "assistant") return;

    // First assistant message after an end-of-turn signal = start of a new turn = the
    // SDK has dequeued the next user message and Claude is responding to it. Shift the
    // queue front (no-op if empty, e.g. the initial-prompt turn ending without any
    // outstanding push).
    if (awaitingNextTurnStart) {
      awaitingNextTurnStart = false;
      if (pendingPushedTexts.length > 0) pendingPushedTexts.shift();
    }

    // `tool_use` means the assistant turn continues (Claude wants the tool result before
    // finishing). Anything else (`end_turn`, `stop_sequence`, `max_tokens`, etc.) ends
    // the turn — the SDK will pull the next queued user message before any further
    // assistant output.
    const stopReason = getAssistantStopReason(message);
    if (stopReason && stopReason !== "tool_use") {
      awaitingNextTurnStart = true;
    }
  }

  function startSdkQuery(useResume: boolean): Query {
    return deps.query({
      prompt: currentInputStream,
      options: {
        ...options,
        persistSession: true,
        ...(useResume && resumeSessionId ? { resume: resumeSessionId } : {}),
        abortController: driver.abortController,
      },
    });
  }

  async function* messagesGenerator(): AsyncGenerator<SDKMessage, void> {
    let stream: Query;
    let resumeMissing = false;

    try {
      stream = startSdkQuery(true);
      await onQuery?.(stream);

      for await (const message of stream) {
        // Detect resume-missing error reported as a yielded result message
        // (the CLI's "No conversation found with session ID" surface).
        if (
          resumeSessionId &&
          message.type === "result" &&
          message.subtype !== "success" &&
          Array.isArray(message.errors) &&
          message.errors.some(isResumeMissingError)
        ) {
          logger.warn(
            `SDK session resume failed for ${resumeSessionId}: backend has no record. Falling back to fresh session.`,
          );
          resumeMissing = true;
          break;
        }
        observeTurnBoundary(message);
        captureSessionId(message, onSessionId);
        yield message;
      }

      if (!resumeMissing) {
        return;
      }
    } catch (error) {
      if (!resumeSessionId) throw error;

      logger.warn(
        `SDK session resume failed for ${resumeSessionId}: ${
          error instanceof Error ? error.message : String(error)
        }. Falling back to fresh session.`,
      );
    }

    // Fallback: tear down the resume input stream, build a fresh one, and replay
    // every buffered message (initial prompt + any sendUpdate calls so far).
    // A throwing consumer callback must not break the recovery itself.
    try {
      onResumeFallback?.();
    } catch (callbackError) {
      logger.warn(`onResumeFallback callback threw: ${callbackError}`);
    }
    if (!currentInputStream.ended) currentInputStream.end();
    currentInputStream = createPushableAsyncIterable();
    for (const msg of replayBuffer) {
      currentInputStream.push(msg);
    }

    stream = startSdkQuery(false);
    await onQuery?.(stream);

    for await (const message of stream) {
      observeTurnBoundary(message);
      captureSessionId(message, onSessionId);
      yield message;
    }
  }

  const messages = messagesGenerator();

  // Object.assign preserves the driver's `status` getter (no `status` on the source side
  // means it isn't overwritten with a snapshot value). Spread would capture `status` once.
  return Object.assign(driver, { messages });
}
