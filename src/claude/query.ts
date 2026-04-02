/**
 * Wrappers around the Claude Agent SDK `query()` function.
 *
 * All call sites MUST use `clackQuery` or `clackSession` — never import
 * `query` directly from `@anthropic-ai/claude-agent-sdk`.
 *
 * - `clackQuery`   — fire-and-forget, no session persistence
 * - `clackSession` — persisted & resumable multi-turn conversations
 */
import { query, type Options, type SDKMessage, type Query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";

/* -------------------------------------------------------------------------- */
/*  clackQuery — ephemeral, no persistence                                    */
/* -------------------------------------------------------------------------- */

export function clackQuery(params: {
  prompt: string;
  options?: Omit<Options, "persistSession" | "resume" | "continue">;
}): Query {
  return query({
    prompt: params.prompt,
    options: {
      ...params.options,
      persistSession: false,
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
export function clackSession(params: ClackSessionParams): AsyncIterable<SDKMessage> {
  const { prompt, options, resumeSessionId, onSessionId } = params;

  // Wrap in an async generator so we can intercept the init message
  // and handle resume failures gracefully.
  async function* sessionGenerator(): AsyncGenerator<SDKMessage, void> {
    let stream: Query;

    try {
      stream = query({
        prompt,
        options: {
          ...options,
          persistSession: true,
          ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        },
      });

      // Attempt to pull the first message — this is where resume failures surface
      const first = await stream.next();
      if (first.done) return;

      // Intercept init message for session ID capture
      captureSessionId(first.value, onSessionId);
      yield first.value;
    } catch (error) {
      if (!resumeSessionId) throw error;

      // Resume failed — fall back to fresh session
      logger.warn(
        `SDK session resume failed for ${resumeSessionId}: ${error instanceof Error ? error.message : String(error)}. Falling back to fresh session.`,
      );

      stream = query({
        prompt,
        options: {
          ...options,
          persistSession: true,
          // No resume — start fresh
        },
      });

      const first = await stream.next();
      if (first.done) return;

      captureSessionId(first.value, onSessionId);
      yield first.value;
    }

    // Stream remaining messages
    for await (const message of stream) {
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
