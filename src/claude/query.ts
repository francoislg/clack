/**
 * Wrappers around the Claude Agent SDK `query()` function.
 *
 * All call sites MUST use `clackQuery` or `clackSession` — never import
 * `query` directly from `@anthropic-ai/claude-agent-sdk`.
 *
 * - `clackQuery`   — fire-and-forget, no session persistence
 * - `clackSession` — persisted & resumable multi-turn conversations
 */
import {
  query as _query,
  type Options,
  type Query,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { isResumeMissingError } from "./messageParser.js";

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
/*  clackSession — persisted & resumable                                      */
/* -------------------------------------------------------------------------- */

export interface ClackSessionParams {
  prompt: string;
  options?: Omit<Options, "persistSession" | "resume" | "continue">;
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
}

/**
 * Start or resume a persisted SDK session.
 *
 * Returns an async iterable of SDK messages — identical to the SDK `query()`.
 * The `onSessionId` callback fires once the `init` message is received.
 *
 * If `resumeSessionId` is provided but the session file is missing/corrupt,
 * the wrapper catches the error (before any messages are streamed) and falls
 * back to a fresh session.
 */
export function clackSession(
  params: ClackSessionParams,
  deps: QueryDeps = defaultQueryDeps,
): AsyncIterable<SDKMessage> {
  const { prompt, options, resumeSessionId, onSessionId, onQuery } = params;

  // Wrap in an async generator so we can intercept the init message
  // and handle resume failures gracefully.
  async function* sessionGenerator(): AsyncGenerator<SDKMessage, void> {
    let stream: Query;
    let resumeMissing = false;

    try {
      stream = deps.query({
        prompt,
        options: {
          ...options,
          persistSession: true,
          ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        },
      });
      await onQuery?.(stream);

      // Resume failures surface two ways:
      //   - thrown (caught below) — rare, e.g., missing local session file
      //   - yielded as a non-success `result` message with errors containing
      //     "No conversation found with session ID" — what the CLI actually
      //     emits when the backend no longer has the conversation
      // Handle both by breaking into the same fresh-session fallback below.
      for await (const message of stream) {
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
        captureSessionId(message, onSessionId);
        yield message;
      }

      if (!resumeMissing) {
        // Completed successfully (or failed for unrelated reasons) — skip the fallback
        return;
      }
    } catch (error) {
      if (!resumeSessionId) throw error;

      // Resume failed — fall back to fresh session
      logger.warn(
        `SDK session resume failed for ${resumeSessionId}: ${error instanceof Error ? error.message : String(error)}. Falling back to fresh session.`,
      );
    }

    // Fallback: start a fresh session (no resume)
    stream = deps.query({
      prompt,
      options: {
        ...options,
        persistSession: true,
      },
    });
    await onQuery?.(stream);

    for await (const message of stream) {
      captureSessionId(message, onSessionId);
      yield message;
    }
  }

  return sessionGenerator();
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
