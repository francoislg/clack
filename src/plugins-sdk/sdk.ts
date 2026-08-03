// The plugin-facing half of the SDK: the `ClackSdk` contract, its supporting
// types, and the single import surface for plugin code. Import-time LIGHT by
// design — every import here is `import type` (erased) or a pure leaf/light
// module, so plugin code can value-import `sdk.js` without evaluating the
// bot-core module graph (the sdk → cronScheduler → handlers/core →
// tools/server → lifecycle → registry → plugin cycle). The implementation
// lives in `internal/factory.ts`.
import type { FSWatcher } from "node:fs";
import type {
  SdkMcpToolDefinition,
  AnyZodRawShape,
  McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { z } from "zod";
import type { loadRoles, UserRole } from "../roles.js";
import type {
  MemoryEntry,
  MemorySearchResult,
  SearchMemoryArgs,
  RememberInput,
  BeforeExpireHook,
} from "../memoryRegistry.js";

export type {
  MemoryEntry,
  MemoryReference,
  StaleAfter,
  RememberInput,
  SearchMemoryArgs,
  MemorySearchResult,
  BeforeExpireResult,
  BeforeExpireHook,
} from "../memoryRegistry.js";
import type { RoleDir } from "../cascadingConfigResolver.js";
import type { ToolEntryObject } from "../streaming/toolMappingLoader.js";
import type { openDmChannel } from "../slack/channelResolver.js";
import type { PluginActionHandler, PluginViewHandler } from "../slack/pluginActionRegistry.js";
export type { PluginActionHandler, PluginViewHandler };
import type {
  findByPluginOwner,
  createJob,
  updateJob,
  deleteJob,
  CronJob,
  SkipDate,
} from "../cronJobs.js";
import type { registerDelayedBootHandler, computeMissedRuns } from "../cronCatchUp.js";
import type { registerThreadSession } from "../sessions.js";
import type {
  SettableAttentionLevel,
  AttentionLevel,
  ThreadEngagementOrigin,
} from "../sessions.js";
export type { SettableAttentionLevel, AttentionLevel, ThreadEngagementOrigin };
import type { clackQuery as defaultClackQuery } from "../claude/query.js";

// ============================================================================
// Types
// ============================================================================

/** Tool mapping entry — same format as tool_mapping JSON config entries. */
export type ToolMapping = string | ToolEntryObject;

/**
 * Translation table a plugin registers with the SDK. `en` is authoritative; other
 * supported languages MAY be partial — absent keys fall back to the EN value at
 * lookup time. Adding a new supported language to Clack's core widens this shape.
 */
export interface PluginDictionary {
  en: Record<string, string>;
  fr?: Record<string, string>;
}

/** Variable map for `sdk.t(key, vars)` — `{name}` placeholders are stringified. */
export type PluginVars = Record<string, string | number>;

/**
 * Handle returned by `sdk.registerMcpServer` (and exposed for the always-on default at
 * `sdk.mcpServer`). Binds tools and topic instructions to the named server so the
 * three-way coupling (server + tools + topic instructions) is structural rather than
 * string-keyed.
 */
export interface RegisteredMcpServer {
  /**
   * Full public name of the server: the plugin name for the default (`trivia`), or
   * `<pluginName>:<key>` for on-demand servers (`trivia:management`). Stable across
   * the SDK instance's lifetime.
   */
  readonly fullName: string;
  /**
   * Bind a tool to this server. Same signature as `sdk.registerTool` minus the integration
   * option (membership is decided by which server's handle you call this on).
   */
  registerTool<T extends AnyZodRawShape>(
    minRole: UserRole,
    tool: SdkMcpToolDefinition<T>,
    mapping: ToolMapping,
  ): void;
  /**
   * Add a topic instruction whose topic name is this server's full public name. For the
   * default server (`sdk.mcpServer`), the topic name equals the plugin name; for an on-demand
   * server, it equals `<pluginName>:<key>`.
   */
  addTopicInstruction(role: RoleDir, filename: string, content: string): void;
}

/**
 * What `sdk.registerMcpServer` records on the plugin's load result. Consumed by the
 * effective-MCP-registry merge at boot and by `buildClackTools` when assembling the
 * per-server SDK config.
 */
export interface PluginMcpServerSpec {
  /** Suffix passed to `registerMcpServer("management", ...)` — `"management"`. */
  key: string;
  /** Full public name, `<pluginName>:<key>` — `"trivia:management"`. */
  fullName: string;
  /** When `true`, the server is part of the session-start baseline. Default `false`. */
  autoload: boolean;
  /** Description shown in the AVAILABLE INTEGRATIONS catalog. */
  description: string;
}

/**
 * Single-turn Claude call routed through `clackQuery` — inherits the
 * deployment's auth (OAuth or API key) the same way every other lightweight
 * Haiku call in Clack does.
 */
export interface AskClaudeOptions {
  model: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** No-op; the Agent SDK doesn't expose a per-call output cap. */
  max_tokens?: number;
  /** No-op; the Agent SDK doesn't expose temperature on `query`. */
  temperature?: number;
}

export interface AskClaudeResult {
  text: string;
  /** `"end_turn"` on success; otherwise the result subtype (e.g. `"error_max_turns"`). */
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Options for {@link ClackSdk.sendMessage}. Supports exactly two delivery shapes:
 * a top-level channel message (omit `threadTs`) or a threaded reply (set `threadTs`).
 * At least one of `text` / `blocks` is required.
 */
export interface SendMessageOptions {
  /** Target Slack channel ID (e.g. `C123ABC`). */
  channel: string;
  /**
   * Message text. Required when `blocks` is omitted; also serves as the
   * notification/accessibility fallback when `blocks` is set.
   */
  text?: string;
  /** Optional Block Kit blocks. */
  blocks?: KnownBlock[];
  /** When set, the message is posted as a reply under this message `ts`. Omit for a top-level channel message. */
  threadTs?: string;
  /** Disable Slack link/media unfurling on the posted message. */
  suppressUnfurls?: boolean;
}

export type SendMessageResult =
  | { ok: true; ts: string; channel: string }
  | { ok: false; error: string };

/**
 * Options for {@link ClackSdk.startThreadConversation}. Starts a full Claude Q&A
 * turn (not the single-turn {@link ClackSdk.askClaude}) in a channel/thread,
 * creating a real session so the thread auto-follows subsequent replies.
 */
export interface StartThreadConversationOptions {
  /** Channel the conversation lives in. */
  channel: string;
  /** Message `ts` the conversation threads under (the conversation's anchor). */
  threadTs: string;
  /** User on whose behalf the turn runs — drives role resolution and session provenance. */
  userId: string;
  /** The user-turn text handed to Claude. */
  prompt: string;
  /** Extra system-prompt context (e.g. the trivia question + answer). */
  additionalSystemPrompt?: string;
  /**
   * Attention level seeded onto the conversation's session — how eagerly Clack auto-follows
   * subsequent replies. One of `always | high | medium | low`. Omit for the `"medium"` default.
   */
  attentionLevel?: SettableAttentionLevel;
}

/**
 * Declarative shape of a cron job a plugin wants to own. Passed to {@link ClackSdk.reconcileCronJobs}.
 * `specKey` is a stable identity within the plugin owner — reconcile updates existing jobs in place
 * when (plugin === ownerKey, specKey === spec.specKey) matches.
 */
export interface CronJobSpec {
  specKey: string;
  cronExpression: string;
  /**
   * Slack channel ID. Optional: omit to declare a channelless job whose delivery
   * destination is decided at fire time by Claude (via `post_to` actions). When the
   * cron job fires with no `channel`, the `submit_response` schema is mechanically
   * forced into the `"skipped"` shape — text delivery is unrepresentable; only
   * `post_to` can deliver. Requires the `channelless-cron-jobs` capability.
   */
  channel?: string;
  prompt: string;
  timezone: string;
  /**
   * Optional 1-80 character human-readable label for the schedule. Surfaced in the Home Tab
   * row and in tool-call task cards via `{name|id}` interpolation. Purely decorative — never
   * used as a lookup key. When present and valid, threaded through to the persisted
   * `CronJob.name` field on both new entries and in-place updates. When absent, the existing
   * persisted value is left untouched on updates and absent on new entries.
   */
  name?: string;
  /**
   * Fully-qualified MCP tool names the run MUST call before `submit_response` is accepted. The
   * gate force-calls every entry (its rejection tells Claude to call any missing one), so list
   * ONLY tools invoked on 100% of valid runs of this spec — the deliverable or an always-run
   * step. NEVER a conditional or mutating tool (one the prompt skips in some run shapes): forcing
   * it makes the model fabricate arguments or state on the runs where it doesn't apply.
   */
  requiredTools?: string[];
  skipConditions?: string;
  /**
   * Declarative override of the `submit_response` schema/gating behavior. See
   * `CronJob.submitResponseMode` for the full contract. Omit to leave the resulting
   * `CronJob.submitResponseMode` unset (today's auto-derivation rules apply).
   */
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /**
   * When true, the fire produces NO Slack output: the primary `submit_response` delivery, the
   * worker `report_status` posts, and change-lifecycle status posts are all suppressed. The job
   * still runs against its real `channel` (so change auto-execution is not treated as a
   * channelless dispatch) and GitHub-side effects (commits, PRs, PR/review comments) are
   * unaffected — "silent" means Slack-silent only. Propagated to the resulting `CronJob.silent`.
   */
  silent?: boolean;
  /**
   * Structured calendar-date skip list. Propagated as-is into the resulting `CronJob.skipDates`.
   * Omit (or pass an empty array) to leave the job's `skipDates` unset.
   */
  skipDates?: SkipDate[];
  /**
   * Topic names that SHALL be pre-attached to the Claude session when this job fires.
   * Pre-attached topics surface their `topics/<topic>/*.md` instruction files (including
   * plugin virtual defaults registered via `addTopicInstruction`) in the system prompt
   * from the first turn — Claude does not need to call `attach_integration`. Omit (or
   * pass an empty array) to leave the resulting `CronJob.attachedTopics` unset.
   * See the `plugin-topic-instructions` capability.
   */
  attachedTopics?: string[];
  /**
   * Attention level seeded onto the session this job's fire creates — governs how eagerly
   * Clack follows up on replies in the resulting thread. One of `always | high | medium | low`
   * (a job cannot seed a disengaged `off` thread). Omit to leave the resulting
   * `CronJob.attentionLevel` unset (the session defaults to `"medium"`).
   */
  attentionLevel?: SettableAttentionLevel;
  /**
   * Maximum minutes the effective fire may be delayed past the canonical cron slot. When set
   * (a positive integer, capped at 30), the scheduler shifts the 60-second match window forward
   * by a deterministic per-occurrence offset so the cadence reads as organic instead of always
   * landing on the exact slot. The `cronExpression` is never modified. Must stay below the
   * cron's inter-fire gap (an every-15-minute cron must use jitter < 15) or adjacent
   * occurrences can overlap. Declarative: omit to clear the resulting `CronJob.jitterMinutes`.
   */
  jitterMinutes?: number;
}

/**
 * Plugin-scoped structured logger. Each level prefixes log lines with the plugin name
 * (e.g. `[trivia]`) so cross-plugin logs are easy to filter. Plugins MUST use this
 * rather than importing the core logger module directly — the plugin SDK is the
 * one-and-only allowed import surface for plugin code.
 */
export interface PluginLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Static-at-load-time facts about the host runtime that a plugin can use to decide
 * whether it can run. The initial set carries only `crons` (mirrors `config.cron.enabled`);
 * future capabilities live alongside as flat boolean fields.
 */
export interface ClackSdkCapabilities {
  /** True when the cron scheduler tick loop is enabled (`config.cron.enabled !== false`). */
  crons: boolean;
}

/** Plugin-facing user identity — core fields only; never carries `lastFetched` or namespaces. */
export interface ClackUser {
  userId: string;
  displayName: string;
}

/**
 * Read/merge access to the calling plugin's own per-user namespace, validated by the
 * plugin-supplied zod schema. Auto-scoped to the plugin (same convention as `readFile`).
 *
 * The namespace is persisted as JSON, so `T` MUST be JSON-serializable — use plain
 * primitives/arrays/objects in the schema, not `z.date()`, `z.map()`, `z.set()`, etc.
 */
export interface ClackSdkUserData<T> {
  get(userId: string): Promise<T | null>;
  merge(userId: string, partial: Partial<T>): Promise<void>;
}

/**
 * Centralized user registry surface. `get`/`list` expose core identity (population,
 * persistence, and freshness are handled invisibly by core); `data(schema)` reaches the
 * plugin's own namespace bag.
 */
export interface ClackSdkUsers {
  get(userId: string): Promise<ClackUser | null>;
  list(): Promise<ClackUser[]>;
  data<T>(schema: z.ZodType<T>): ClackSdkUserData<T>;
}

/**
 * Read/merge access to the calling plugin's own namespace slice on a memory entry, validated by
 * the plugin-supplied zod schema. Auto-scoped to the plugin. `merge` rejects when no core entry
 * exists for `id` (memory is core-first — remember the entry before attaching a slice). The
 * namespace is persisted as JSON, so `T` MUST be JSON-serializable.
 */
export interface ClackSdkMemoryData<T> {
  get(id: string): Promise<T | null>;
  /**
   * Merge `partial` into the slice. Defaults to bumping the entry's `updatedAt`; pass
   * `{ touch: false }` for a bookkeeping write that preserves it (so the plugin can snapshot
   * `updatedAt` in the slice and detect later content changes against the snapshot).
   */
  merge(id: string, partial: Partial<T>, opts?: { touch?: boolean }): Promise<void>;
}

/**
 * Core memory faculty surface — Clack's plugin-agnostic notebook. `get`/`list`/`recall` expose
 * whole entries (incl. every plugin's namespace data); `data(schema)` reaches the plugin's own
 * slice; `onBeforeExpire` registers a pre-expire hook so the daily review won't prune an entry
 * whose slice the plugin still has live work on.
 */
export interface ClackSdkMemory {
  get(id: string): Promise<MemoryEntry | null>;
  list(): Promise<MemoryEntry[]>;
  recall(args: SearchMemoryArgs): Promise<MemorySearchResult>;
  /**
   * Create or update a core entry. Preserves existing plugin namespaces and `createdAt`. This is
   * also how a plugin signals "this can go soon" — set a short `staleAfter.date` (a grace window)
   * rather than deleting, so the entry survives long enough to be resurrected if work resumes.
   * Plugins intentionally CANNOT delete; only the core daily review prunes (after the grace
   * passes, honoring the pre-expire hook).
   */
  remember(input: RememberInput): Promise<MemoryEntry>;
  data<T>(schema: z.ZodType<T>): ClackSdkMemoryData<T>;
  onBeforeExpire(fn: BeforeExpireHook): void;
}

export interface ClackSdk {
  /**
   * Plugin-scoped logger. Prefixes every line with `[<pluginName>]` for filterability.
   * Use this instead of importing the core `logger` module from `src/logger.ts` —
   * direct imports from outside the SDK are not allowed in plugin code.
   */
  logger: PluginLogger;
  /**
   * Static-at-load-time capability flags. Plugins read these to decide whether they can
   * run. When a required capability is false, the plugin SHOULD call {@link error} with
   * a human-readable reason and `return` from its init.
   */
  capabilities: ClackSdkCapabilities;
  /**
   * Record a load-time problem on the plugin's `PluginLoadResult.errors`. Non-fatal:
   * the call returns and the plugin decides whether to also `return` (e.g. when the
   * problem makes the plugin non-functional) or continue (for partial degradation).
   * MAY be called multiple times to record independent problems. Errors accumulate in
   * call order and surface on the Home Tab's `Status > Plugins` section.
   */
  error(reason: string): void;
  addInstruction(role: RoleDir, filename: string, content: string): void;
  /**
   * Register topic-scoped instruction content. The file is stored as a virtual default at
   * `topics/<topic>/<pluginName>__<filename>.md` and is loaded only when the named topic is
   * active for a session — either pre-attached via `CronJobSpec.attachedTopics` or runtime-
   * attached via `attach_integration`. Admins override by placing a file at
   * `data/configuration/<role>/topics/<topic>/<pluginName>__<filename>.md` (same precedence
   * rule as baseline plugin instruction overrides). See the `plugin-topic-instructions`
   * capability for full semantics.
   */
  addTopicInstruction(role: RoleDir, topic: string, filename: string, content: string): void;
  /**
   * Register an MCP tool with a minimum role requirement and a Slack task card mapping.
   * Shorthand for `sdk.mcpServer.registerTool(...)` — the tool is bound to the plugin's
   * always-on default server (`mcp__<plugin>__*`). For on-demand tools, capture a handle
   * from `sdk.registerMcpServer(...)` and call `handle.registerTool(...)` instead.
   * @param mapping — Display label for Slack task cards. Either a template string with `{argName}` interpolation,
   *   or an object with `label`, optional `group`, and optional `itemDetail`.
   */
  registerTool<T extends AnyZodRawShape>(
    minRole: UserRole,
    tool: SdkMcpToolDefinition<T>,
    mapping: ToolMapping,
  ): void;
  /**
   * Always-on default MCP server for this plugin. Tools registered via the SDK shorthand
   * `sdk.registerTool(...)` are equivalent to `sdk.mcpServer.registerTool(...)`. The full
   * name is the plugin name (`trivia`), and tools land at `mcp__<plugin>__<tool>`.
   */
  readonly mcpServer: RegisteredMcpServer;
  /**
   * Declare an on-demand named MCP server scoped to this plugin. Tools bound to the
   * returned handle become available only after `attach_integration("<plugin>:<name>")`
   * (or when the session resumes with the integration already attached).
   *
   * `name` SHALL NOT contain `:` (the SDK auto-prefixes with the plugin name to produce
   * the full public name `<plugin>:<name>`). `name` SHALL be non-empty and SHALL NOT
   * collide with a previously-registered on-demand server.
   *
   * `autoload` defaults to `false` (on-demand). Set to `true` to make the server part
   * of the session-start baseline alongside `mcp__<plugin>__*`.
   */
  registerMcpServer(
    name: string,
    options: { autoload?: boolean; description: string },
  ): RegisteredMcpServer;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Read `path`; if it does not exist, seed it with `defaultContent` and return that. The seed
   * write is best-effort: if it fails (e.g. `EACCES` on a data dir not owned by the bot user),
   * the failure is logged as a warning and `defaultContent` is returned anyway, so the plugin
   * runs read-only on its defaults instead of dying during init. Use this for the
   * "materialize a default so admins can edit it" pattern — never let seeding be fatal.
   */
  readFileOrSeed(path: string, defaultContent: string): Promise<string>;
  /**
   * Watch a file under this plugin's data directory. The callback fires (debounced 500ms)
   * whenever the file changes. The returned watcher is tracked on the plugin's load result
   * and closed automatically when the plugin is reloaded by `restartAll`.
   */
  watchFile(relativePath: string, callback: () => void): FSWatcher;
  /**
   * Declaratively reconcile this plugin's owned cron jobs against `specs`. Diffs against
   * existing jobs matching `(plugin === ownerKey, pluginManaged === true)`: upserts entries
   * matched by `specKey` (preserving `id`/`runs[]`/`enabled`/`lastRunAt`/`lastRunStatus`),
   * creates new specs, and deletes owner-jobs whose `specKey` is not in `specs`.
   * Invalid specs (unparseable cron, malformed channel) are skipped with a logged warning;
   * valid neighbors still apply.
   */
  reconcileCronJobs(ownerKey: string, specs: CronJobSpec[]): Promise<void>;
  /**
   * List the cron jobs owned by this plugin — entries where `plugin === <this plugin's name>`
   * and `pluginManaged === true`. Returns a narrow `{id, specKey}` projection sufficient for
   * surfacing job UUIDs in plugin tools (e.g. trivia's `list_games` exposing `prepJobId` so
   * admins can call `run_scheduled_message_now({id})` without a separate `list_scheduled_messages`
   * lookup). The SDK enforces the boundary — plugins MUST NOT import `src/cronJobs.ts` directly.
   */
  findOwnedCronJobs(): Promise<Array<{ id: string; specKey: string }>>;
  /**
   * Register a handler invoked once per boot, `cron.catchUp.delayMinutes` after the cron
   * scheduler starts (default 3 min) — on EVERY boot, whether or not any fires were missed.
   * Handlers across plugins run sequentially in registration order; a throwing handler is
   * logged and does not block later handlers. Registrations are cleared and re-collected
   * on soft restart. Typical use: query {@link missedRuns} for the plugin's own jobs and
   * decide in code what (if anything) to catch up via {@link runCronJobNow}.
   */
  onDelayedBoot(handler: () => void | Promise<void>): void;
  /**
   * Cron occurrences of one of this plugin's own jobs that were expected but never
   * started: canonical slot times strictly after `max(lastRunAt ?? createdAt, now − 14d)`
   * and at or before now, capped at 100 entries. Disabled jobs report none. Owner-scoped:
   * `specKey` resolves only within this plugin's reconciled jobs; an unknown or foreign
   * specKey rejects.
   */
  missedRuns(specKey: string): Promise<{ lastExpectedRuns: Date[] }>;
  /**
   * Fire one of this plugin's own jobs immediately as a plain run — NO `asOf` replay
   * semantics. Routed through the scheduler's `executeJob`, so the `skipDates` gate
   * (against today), the running-jobs guard, `markJobStarted` double-fire protection,
   * and run-history recording all apply; the tick will not re-fire the caught-up slot.
   * Awaits run completion. Rejects on unknown/foreign specKey or when no Slack client
   * is available yet.
   */
  runCronJobNow(specKey: string): Promise<void>;
  /**
   * Send a DM to the deployment owner (the user with the `owner` role).
   *
   * Resolved server-side: the owner ID is read from roles, the DM channel is opened
   * via `conversations.open`, and the message is posted via `chat.postMessage`. The
   * recipient is decided here (not by Claude) — this is the safe path for plugins
   * that need to notify the owner without exposing user-targeted DMing as a tool
   * surface to Claude.
   *
   * Pass `{ suppressUnfurls: true }` to disable Slack's link/media unfurling on
   * the resulting message (sets both `unfurl_links: false` and `unfurl_media: false`).
   */
  dmOwner(
    text: string,
    options?: { suppressUnfurls?: boolean },
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Post a single Slack message — top-level in `channel`, or a threaded reply when
   * `threadTs` is given. The narrow, fail-soft alternative to reaching for the raw
   * client via {@link getSlackClient}: returns a `Result` (never throws) and applies
   * unfurl options. Use this for plain text/block posts; `getSlackClient` remains for
   * richer needs (`chat.update`, `views.open`, `files.uploadV2`).
   */
  sendMessage(opts: SendMessageOptions): Promise<SendMessageResult>;
  /**
   * Make the thread a message was posted into "engaged": seed a discoverable session for
   * `(channel, threadTs)` so human replies there are picked up by the thread auto-respond path,
   * with `creationContext` surfaced to both the auto-respond judge and the reply turn.
   * `attentionLevel: "off"` (or omitted) is a no-op. This is the ONLY engagement path for
   * plugins — never import core session modules.
   *
   * `origin` says whether the thread is one the plugin opened (its own posted message is the
   * root) or a pre-existing conversation it joined; a joined thread is clamped to `"low"`.
   */
  engageThread(
    channel: string,
    threadTs: string,
    opts: {
      attentionLevel?: AttentionLevel;
      origin: ThreadEngagementOrigin;
      creationContext?: string;
    },
  ): Promise<void>;
  /**
   * Lazily resolves the Slack WebClient at call time. Returns `null` when Slack
   * hasn't connected yet (e.g. plugin tools created at plugin-load time, before
   * the bot's socket session is up). Plugin authors needing direct Slack API access
   * (e.g. `conversations.history` to read message reactions) should call this from
   * inside their tool handler — never close over the result at module top-level.
   */
  getSlackClient(): App["client"] | null;
  /**
   * Centralized user registry. `get`/`list` return core identity sourced from the shared
   * registry (the plugin never fetches or caches display names itself); `data(schema)` reads
   * and merges the plugin's own per-user namespace. See {@link ClackSdkUsers}.
   */
  users: ClackSdkUsers;
  /**
   * Core memory faculty — Clack's notebook for any worth-remembering information. `get`/`list`/
   * `recall` read whole entries; `data(schema)` reaches the plugin's own namespace slice;
   * `onBeforeExpire` registers a pre-expire veto hook. See {@link ClackSdkMemory}.
   */
  memory: ClackSdkMemory;
  /**
   * Register a Slack action handler scoped to this plugin. The `key` is the
   * suffix the plugin owns; the SDK prefixes it as `plugin:<pluginName>:<key>`
   * before recording the handler. Pass a string for an exact-match suffix or a
   * RegExp for a pattern (whose `^` is stripped before splicing the prefix).
   *
   * @example
   * sdk.registerAction("answer", async ({ ack, body, client }) => {
   *   await ack();
   *   // open a modal etc.
   * });
   * // → Slack action_id `plugin:trivia:answer` is now routed to this handler
   */
  registerAction(key: string | RegExp, handler: PluginActionHandler): void;
  /**
   * Register a Slack view-submission handler scoped to this plugin. The `key`
   * is the suffix; the SDK prefixes it as `plugin:<pluginName>:<key>` to form
   * the modal's `callback_id`.
   *
   * @example
   * sdk.registerView("freeform-modal", async ({ ack, view, body }) => {
   *   await ack();
   *   // process modal submission
   * });
   */
  registerView(key: string | RegExp, handler: PluginViewHandler): void;
  /**
   * Returns the full prefixed Slack action_id for a plugin-owned key, e.g.
   * `plugin:trivia:answer`. Use this when building Block Kit payloads so the
   * `action_id` matches the matcher the wildcard dispatcher routes on.
   */
  actionId(key: string): string;
  /**
   * Returns the full prefixed Slack modal `callback_id` for a plugin-owned key,
   * e.g. `plugin:trivia:freeform-modal`. Use this when calling `views.open`.
   */
  viewCallbackId(key: string): string;
  /** Single-turn Claude call routed through the Agent SDK's `query`. */
  askClaude(opts: AskClaudeOptions): Promise<AskClaudeResult>;
  /**
   * Start a full Claude Q&A turn in a channel/thread via the bot's normal message
   * pipeline (`processMessage`) — unlike {@link askClaude}, this creates a real
   * session, runs with the full query toolset, uses the common chat streamer
   * (thinking-card UX), and leaves the thread auto-following. Fire-and-forget:
   * resolves once the turn is dispatched. A no-op (logged) when the capability
   * was not wired into the SDK.
   */
  startThreadConversation(opts: StartThreadConversationOptions): Promise<void>;
  /**
   * Request a soft application restart. Fire-and-forget — the call returns
   * immediately and the restart runs asynchronously, guarded by a shared
   * in-flight flag so simultaneous requests collapse into one. Use this when
   * a plugin observes a state change (e.g. its own config file mutating) that
   * cannot be applied without re-running plugin init / re-reconciling cron
   * jobs / re-registering tools. `reason` is logged for traceability.
   */
  requestSoftRestart(reason: string): void;
  /**
   * Register this plugin's translation table. `en` is required and authoritative.
   * Calling twice replaces the prior registration (last-write-wins; useful for
   * hot-reload). The dictionary is scoped implicitly to this plugin — plugin A
   * cannot read plugin B's strings.
   */
  registerDictionary(dictionaries: PluginDictionary): void;
  /**
   * Look up `key` in this plugin's registered dictionary using the workspace's
   * configured language (`config.json` `language`, defaulting to `"en"`). When
   * `vars` is supplied, every `{name}` placeholder in the resolved template is
   * replaced with `String(vars.name)`.
   *
   * Throws when `registerDictionary` has not been called or when `key` is missing
   * from the EN table. Missing in a non-EN table falls back to EN with a one-time
   * warn through `sdk.logger`.
   */
  t(key: string, vars?: PluginVars): string;
}

export type ClackPlugin = (sdk: ClackSdk) => Promise<void>;

export interface RegisteredInstruction {
  role: RoleDir;
  filename: string;
  content: string;
}

/**
 * A registered tool with its minimum role requirement.
 * The `name` field is extracted for duplicate detection.
 * `pushTo` appends the tool to a heterogeneous array (handles the generic cast internally).
 */
export interface RegisteredTool {
  name: string;
  minRole: UserRole;
  /**
   * Which SDK server hosts this tool. `undefined` = the plugin's always-on default server
   * (`mcp__<plugin>__*`). Otherwise the suffix of an on-demand server registered via
   * `sdk.registerMcpServer(serverKey, ...)` — tool ends up at `mcp__<plugin>_<serverKey>__*`.
   */
  serverKey?: string;
  pushTo: (target: SdkMcpToolDefinition<AnyZodRawShape>[]) => void;
}

/**
 * Captured Slack interactivity registrations. Persisted on the load result so the
 * lifecycle layer can clear them from the central registry on plugin reload before
 * the new init re-registers fresh entries.
 */
export interface RegisteredActionEntry {
  key: string | RegExp;
  handler: PluginActionHandler;
}

export interface RegisteredViewEntry {
  key: string | RegExp;
  handler: PluginViewHandler;
}

export interface PluginLoadResult {
  name: string;
  instructions: RegisteredInstruction[];
  tools: RegisteredTool[];
  /**
   * On-demand SDK servers declared via `sdk.registerMcpServer(...)`. Each entry becomes
   * an entry in the effective MCP registry and (via `buildClackTools`) a separate SDK
   * server that `attach_integration` can load on demand. The plugin's always-on default
   * server (`mcp__<plugin>__*`) is implicit and NOT listed here — it's assembled from
   * tools with `serverKey === undefined`.
   */
  mcpServers: PluginMcpServerSpec[];
  /** Tool name → mapping entry for Slack task cards. */
  toolMappings: Map<string, ToolMapping>;
  /** Dedicated MCP server hosting this plugin's tools, namespaced under the plugin's name. */
  mcpServer: McpSdkServerConfigWithInstance;
  /**
   * Load-time errors recorded by `sdk.error(reason)` calls during plugin init, in call
   * order. When init throws an unhandled exception, the loader synthesizes a result with
   * `errors: [<thrown message>]` and otherwise-empty registrations. An empty array means
   * the plugin loaded cleanly.
   */
  errors: string[];
  /**
   * Filesystem watchers registered via `sdk.watchFile`. Closed by the plugin reload
   * pipeline (in `lifecycle.ts`) before the plugin's init is re-run, to prevent
   * cross-generation double-fires. Optional — absent in fixture-style load results that
   * do not exercise the watch API.
   */
  watchers?: FSWatcher[];
  /**
   * Slack action handlers registered via `sdk.registerAction`. The lifecycle layer
   * passes each entry into the plugin action registry on load, and clears every
   * entry owned by this plugin on reload before re-running its init.
   */
  actionHandlers: RegisteredActionEntry[];
  /** Slack view-submission handlers registered via `sdk.registerView`. */
  viewHandlers: RegisteredViewEntry[];
}

// ============================================================================
// SDK dependency contract
// ============================================================================

export interface ClackSdkDeps {
  /** Lazy getter — plugins load before the Slack client is connected, so this is called at tool-invocation time. */
  getSlackClient: () => App["client"] | null;
  loadRoles: typeof loadRoles;
  openDmChannel: typeof openDmChannel;
  /** Backs `sdk.engageThread`. Optional so tests that don't exercise engagement can omit it. */
  registerThreadSession?: typeof registerThreadSession;
  /** Cron job persistence — optional in tests that don't exercise reconcile. */
  findByPluginOwner?: typeof findByPluginOwner;
  createJob?: typeof createJob;
  updateJob?: typeof updateJob;
  deleteJob?: typeof deleteJob;
  /** Backs `sdk.onDelayedBoot` — optional in tests that don't exercise catch-up. */
  registerDelayedBootHandler?: typeof registerDelayedBootHandler;
  /** Backs `sdk.missedRuns` — optional in tests that don't exercise catch-up. */
  computeMissedRuns?: typeof computeMissedRuns;
  /**
   * Backs `sdk.runCronJobNow`. Bound at the `loadAndInstallPlugins` call sites to the
   * scheduler's `executeJob` (which isn't importable here — a static import would close
   * the module cycle sdk → cronScheduler → handlers/core → tools/server → lifecycle →
   * registry → sdk). Absent → `runCronJobNow` rejects, mirroring `startThreadConversation`.
   */
  executeCronJob?: (job: CronJob, client: App["client"]) => Promise<void>;
  clackQuery: typeof defaultClackQuery;
  /**
   * Backs `sdk.startThreadConversation`. Bound at the `loadAndInstallPlugins` call
   * sites to a closure over core's `processMessage` (which isn't reachable at SDK
   * module-eval time without an import cycle). Absent → `startThreadConversation`
   * is a logged no-op, mirroring `requestSoftRestart`.
   */
  startThreadConversation?: (params: {
    client: App["client"];
    channel: string;
    threadTs: string;
    userId: string;
    prompt: string;
    additionalSystemPrompt?: string;
    attentionLevel?: SettableAttentionLevel;
  }) => Promise<void>;
  /**
   * Soft-restart trigger surfaced as `sdk.requestSoftRestart`. Defaults to a
   * logged no-op so the SDK can be constructed before the lifecycle layer has
   * wired the real implementation (and for tests that don't exercise restart).
   * Production callers MUST pass the real `requestSoftRestart` from `lifecycle.ts`.
   */
  requestSoftRestart?: (reason: string) => void;
  /**
   * Capability flags exposed to the plugin via `sdk.capabilities`. Optional in tests
   * that don't exercise capability gating; defaults to `{ crons: true }` (the same
   * default behavior as the boot-time scheduler gate).
   */
  capabilities?: ClackSdkCapabilities;
}
// ============================================================================
// Façade surface — everything plugin code may import (src/plugins/CLAUDE.md).
// Pure values and erased types only, so this module stays import-time light.
// ============================================================================

export { textResult, errorResult, MAX_TOOL_OUTPUT_CHARS } from "./toolResults.js";
export { zodErrorToResult } from "./zodResult.js";
export type { Result } from "./zodResult.js";
export {
  imageAndTextResult,
  sourceErrorResult,
  validateQuery,
  MAX_QUERY_LENGTH,
} from "./imageSearchResult.js";
export type { ImageSourceError } from "./imageSearchResult.js";
export { BlockSchema, ALLOWED_BLOCK_TYPES } from "../slack/blockSchema.js";
export type { Block } from "../slack/blockSchema.js";
export { validateBlocks } from "../slack/blockValidate.js";
export type { BlockValidationError } from "../slack/blockValidate.js";
export { postStructuredMessage, notificationText } from "../slack/messagePoster.js";
export type {
  MessagePostingClient,
  PostStructuredMessageOpts,
  PostStructuredMessageResult,
} from "../slack/messagePoster.js";
export type { SlackBlocks } from "../slack/blocks.js";
export type { CronJob, SkipDate, CreateCronJobParams, UpdateCronJobParams } from "../cronJobs.js";
