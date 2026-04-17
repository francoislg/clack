import type { AssistantConfig } from "@slack/bolt";

type ThreadContextStore = NonNullable<AssistantConfig["threadContextStore"]>;
type BoltPayload = Parameters<ThreadContextStore["get"]>[0]["payload"];
type ThreadContext = Awaited<ReturnType<ThreadContextStore["get"]>>;

export interface ContextStoreArgs {
  payload: BoltPayload;
}

interface ThreadInfo {
  channelId: string;
  threadTs: string;
  context: ThreadContext;
}

function extractThreadInfo(payload: BoltPayload): ThreadInfo | null {
  if ("assistant_thread" in payload && payload.assistant_thread) {
    const thread = payload.assistant_thread;
    if (typeof thread.channel_id === "string" && typeof thread.thread_ts === "string") {
      const context: ThreadContext =
        typeof thread.context === "object" && thread.context !== null ? thread.context : {};
      return {
        channelId: thread.channel_id,
        threadTs: thread.thread_ts,
        context,
      };
    }
  }

  if (
    "channel" in payload &&
    typeof payload.channel === "string" &&
    "thread_ts" in payload &&
    typeof payload.thread_ts === "string"
  ) {
    return {
      channelId: payload.channel,
      threadTs: payload.thread_ts,
      context: {},
    };
  }

  return null;
}

/**
 * In-memory Assistant thread context store keyed by (channelId, threadTs).
 *
 * Why: Bolt's `DefaultThreadContextStore` holds context in a single shared field,
 * so concurrent users overwrite each other's "currently viewing" channel.
 * Keying by thread gives per-user isolation (each DM thread belongs to one user).
 */
export class PerThreadContextStore {
  private contexts = new Map<string, ThreadContext>();

  async get(args: ContextStoreArgs): Promise<ThreadContext> {
    const info = extractThreadInfo(args.payload);
    if (!info) return {};
    return this.contexts.get(keyFor(info)) ?? {};
  }

  async save(args: ContextStoreArgs): Promise<void> {
    const info = extractThreadInfo(args.payload);
    if (!info) return;
    this.contexts.set(keyFor(info), info.context);
  }
}

function keyFor(info: ThreadInfo): string {
  return `${info.channelId}:${info.threadTs}`;
}
