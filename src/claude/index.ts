import { type McpServerConfig, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { clackSession } from "./query.js";
import type { ClaudeRunDriver, ClaudeRunHandle } from "./runHandle.js";
import {
  register as registerActiveRun,
  unregister as unregisterActiveRun,
} from "../slack/activeRuns.js";
import { getConfig, getRepositoriesDir } from "../config.js";
import { ClaudeMessageParser, detectPlatformError, isResumeMissingError } from "./messageParser.js";
import { buildSystemPrompt, buildPrompt } from "./promptBuilder.js";
import { trackedMemoryKindsForRole } from "../memory/trackedKinds.js";
import { detectRuntime } from "./utilities.js";
import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";
import type { UserRole } from "../roles.js";
import type { SessionContext, AttentionLevel, DeliveryMode } from "../sessions.js";
import { updateSession, addSessionUsage } from "../sessions.js";
import type {
  SubmitResponsePayload,
  ToolCallRecord,
  StagedIntent,
  DeliverFn,
  DeliveryControl,
  ClackToolsResult,
} from "../tools/types.js";
import { McpServerManager, prepareMcpSession, completeSessionStart } from "./mcpServerManager.js";
import type { StreamEvent } from "../streaming/types.js";
import type { SlackImageFile, SlackFile } from "../slack/slackFileBase.js";
import type { SlackBlocks } from "../slack/blocks.js";
import { extractDisplayText } from "../slack/blockText.js";
import { buildQueryContext } from "../tools/context.js";
import { buildClackTools } from "../tools/server.js";
import { discoverEagerSkillPlugins, discoverSkillPluginInfo } from "../skillPlugins.js";
import { prepareSkillsSession } from "./skillsManager.js";
import { discoverUserSkills } from "../userSkills.js";

export interface ConversationMessage {
  type: string;
  subtype?: string;
  content: string;
  timestamp: number;
  /** Typed tool call record (for clack tool calls) */
  toolCall?: { tool: string; args: Record<string, unknown>; result: Record<string, unknown> };
}

export interface ErrorRecord {
  timestamp: number;
  errorMessage: string;
  conversationTrace: ConversationMessage[];
}

export interface ClaudeResponse {
  success: boolean;
  answer: string;
  error?: string;
  /** True when the request was aborted via AbortController (not a real error) */
  cancelled?: boolean;
  /** True when Claude chose to skip the response via submit_response skip_response flag */
  skipped?: boolean;
  /** Attention level Claude set via submit_response.attention_level this turn, if any.
   *  `"off"` means disengage. Absent when Claude left the level unchanged. */
  attentionLevel?: AttentionLevel;
  /** Delivery mode Claude set via submit_response.default_delivery_mode this turn, if any.
   *  Absent when Claude left the mode unchanged. Takes effect on the thread's next turn. */
  deliveryMode?: DeliveryMode;
  /** True when submit_response was invoked with post_top_level: true */
  postedTopLevel?: boolean;
  /** Operator-facing diagnostic Claude set via submit_response.escalate_to_owner this turn, if any.
   *  When present, the delivery layer DMs the owner and writes an error report. Absent when unset. */
  escalateToOwner?: string;
  conversationTrace?: ConversationMessage[];
  /** Captured stderr output from the Claude Code process */
  stderrOutput?: string;
  /** Structured response from submit_response tool */
  response?: SubmitResponsePayload;
  /** Pre-rendered and validated Slack blocks from submit_response */
  renderedBlocks?: SlackBlocks;
  /** Staged intents from action tools (serializable for session persistence) */
  stagedIntents?: Record<string, StagedIntent>;
  /** Tool call history from this query */
  toolCallHistory?: ToolCallRecord[];
}

export interface AskClaudeOptions {
  role?: UserRole;
  changesWorkflowEnabled?: boolean;
  /** When true, hints Claude to propose a change with auto-execute */
  workMode?: boolean;
  /** Slack WebClient for tools that need Slack API access (e.g., find_user) */
  slackClient?: import("@slack/bolt").App["client"];
  /** AbortController for cancelling in-flight queries */
  abortController?: AbortController;
  /** Callback for real-time streaming events (tool calls, text) */
  onEvent?: (event: StreamEvent) => void | Promise<void>;
  /** Delivery callback — when provided, submit_response delivers to Slack directly */
  deliver?: DeliverFn;
  /** Mid-run delivery-mode switch handle — when provided, the `switch_delivery_context` tool
   *  becomes available (interactive turns only). Absent in channelless cron / worker contexts. */
  deliveryControl?: DeliveryControl;
  /** Available Slack images keyed by file ID */
  availableImages?: Map<string, SlackImageFile>;
  /** Available non-image Slack files keyed by file ID */
  availableFiles?: Map<string, SlackFile>;
  /** User's IANA timezone (e.g., "America/New_York") for time-aware prompts */
  userTimezone?: string;
  /**
   * Fully-qualified MCP tool names that must be called during this run before `submit_response`
   * will be accepted (e.g., `mcp__trivia__submit_answers`). Threaded into the query context.
   */
  requiredTools?: string[];
  /**
   * Free-form skip conditions for scheduled runs. When non-empty, the prompt builder injects
   * a pre-check section and `submit_response` exposes `skip_response`. Ignored for non-scheduled
   * triggers.
   */
  skipConditions?: string;
  /**
   * Declarative override of `submit_response` schema/gating behavior. Threaded from the cron
   * job through `processMessage` to the tool-server build context. See `CronJob.submitResponseMode`.
   */
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /**
   * Effective "now" for time-sensitive tools. Threaded from the cron scheduler when a job is
   * replayed with an explicit `asOf` parameter; absent for normal scheduler-tick fires.
   * Tools that don't care ignore it; the trivia reveal processor reads it to define
   * "what counts as unprocessed at this effective time."
   */
  asOf?: Date;
  /**
   * Fires once per completed tool call (when its `tool_result` arrives from the SDK stream).
   * Populated for ALL tools the SDK dispatches — built-ins, clack MCP, plugin MCP, external MCP.
   * Use this to persist tool calls to the session incrementally for live debugging.
   */
  onToolCall?: (record: ToolCallRecord) => void | Promise<void>;
  /**
   * Topic names to pre-attach for this session. The system prompt resolver loads each topic's
   * `topics/<topic>/*.md` files (including plugin virtual defaults registered via
   * `sdk.addTopicInstruction`) into the system prompt from the first turn — Claude does not
   * need to call `attach_integration`. Threaded from the cron scheduler when the job's
   * `attachedTopics` field is set. See the `plugin-topic-instructions` capability.
   */
  preAttachedTopics?: string[];
  /**
   * Fired exactly once the moment the run has attempted to claim its active-runs slot —
   * whether the claim succeeded or the slot was already occupied. Used by `processMessage`'s
   * per-thread lock (`withThreadLock`) to release as soon as the slot is settled, so the lock
   * is held only across setup, not for the run's full duration. Always invoked before the run
   * begins streaming (and on the early-abort path when the slot is occupied).
   */
  onRegistered?: () => void;
}

function summarizeContentBlocks(content: unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
      parts.push(block.text.substring(0, 500));
    }
    if (block && typeof block === "object" && "type" in block) {
      parts.push(`[${block.type}]`);
    }
  }
  return parts.join(" ").substring(0, 1000);
}

function hasProperty<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
  return typeof obj === "object" && obj !== null && key in obj;
}

function summarizeMessageContent(message: unknown): string {
  if (hasProperty(message, "message") && hasProperty(message.message, "content")) {
    if (Array.isArray(message.message.content)) {
      return summarizeContentBlocks(message.message.content);
    }
  }

  if (hasProperty(message, "result") && typeof message.result === "string") {
    return message.result.substring(0, 1000);
  }

  if (hasProperty(message, "errors") && Array.isArray(message.errors)) {
    return `Errors: ${message.errors.join(", ")}`;
  }

  return JSON.stringify(message).substring(0, 500);
}

interface QuerySetup {
  reposDir: string;
  systemPrompt: string;
  userPrompt: string;
  model: string | undefined;
  clackTools: ClackToolsResult;
  mcpServers: Record<string, McpServerConfig>;
  mcpManager: McpServerManager;
}

/**
 * Wrap the caller's `DeliverFn` so a successful delivery latches `markDelivered()` on the
 * run handle. Once latched, `sendUpdate` rejects and a follow-up spawns a fresh run instead
 * of being absorbed into a run whose delivery context is already spent. Returns `undefined`
 * untouched (test/cron contexts without a deliver callback).
 */
function wrapDeliverWithDeliveredMark(
  deliver: DeliverFn | undefined,
  markDelivered: () => void,
): DeliverFn | undefined {
  if (!deliver) return undefined;
  return async (opts) => {
    const result = await deliver(opts);
    if (result.ok) markDelivered();
    return result;
  };
}

async function buildQuerySetup(
  session: SessionContext,
  options: AskClaudeOptions | undefined,
  hasPendingInput: () => boolean,
  consumePendingPushedTexts: () => string[],
  markDelivered: () => void,
): Promise<QuerySetup> {
  const config = getConfig();
  const reposDir = getRepositoriesDir();

  // All MCP-server setup (registry resolution, always-on loading, resume
  // attachment pre-loading, stale cleanup, manager construction) lives in the
  // `prepareMcpSession` factory. We get back a manager and the pieces needed
  // to finalize the session-start mcpServers map after building the clack/
  // plugin servers below.
  const mcpSetup = await prepareMcpSession(session, config);

  const trackedMemoryKinds = await trackedMemoryKindsForRole(options?.role);
  const systemPrompt = buildSystemPrompt({ ...options, trackedMemoryKinds });
  const userPrompt = buildPrompt(session, {
    ...options,
    mcpRegistry: mcpSetup.registry,
    skillPluginsRegistry: config.skillPlugins,
    userSkills: config.userSkills?.enabled
      ? discoverUserSkills()
          .filter((s) => !s.disabledAt)
          .map((s) => ({ slug: s.slug, description: s.description }))
      : undefined,
  });

  const skillsManager = prepareSkillsSession(
    session,
    discoverSkillPluginInfo(),
    config.skillPlugins,
  );

  // Top-level multi-message fields (additional_messages = top-level channel posts;
  // thread_replies = threaded replies) are gated to the scheduled (cron) trigger only.
  // In DM, @mention, reaction, auto-respond, thread-reply, and worker contexts the schema
  // hides these fields — the trigger channel is the user's conversation space and multi-
  // message there is almost never what they want (they'd use post_to with an explicit
  // channel). post_to's own multi-message fields are always available regardless.
  const allowMultiMessage = session.triggerType === "scheduled";
  const maxAdditionalMessages = config.submitResponse?.maxAdditionalMessages;

  const toolCtx = buildQueryContext({
    userId: session.userId,
    role: options?.role ?? "member",
    session,
    config,
    changesWorkflowEnabled: options?.changesWorkflowEnabled ?? false,
    cronUserSchedules: config.cron?.userSchedules ?? false,
    slackClient: options?.slackClient,
    deliver: wrapDeliverWithDeliveredMark(options?.deliver, markDelivered),
    deliveryControl: options?.deliveryControl,
    availableImages: options?.availableImages,
    availableFiles: options?.availableFiles,
    requiredTools: options?.requiredTools,
    skipConditions: options?.skipConditions,
    submitResponseMode: options?.submitResponseMode,
    allowMultiMessage,
    ...(maxAdditionalMessages !== undefined && { maxAdditionalMessages }),
    asOf: options?.asOf,
    mcpManager: mcpSetup.manager,
    skillsManager,
    hasPendingInput,
    consumePendingPushedTexts,
  });
  const clackTools = buildClackTools(toolCtx);

  // Hand the clack + plugin servers back to the factory. It hydrates the
  // manager's baseline and returns the merged `options.mcpServers` (baseline +
  // resumed attachments) so the CLI's restored state matches exactly.
  const mcpServers = completeSessionStart(
    mcpSetup,
    clackTools.mcpServers as Record<string, McpServerConfig>,
  );

  return {
    reposDir,
    systemPrompt,
    userPrompt,
    model: config.claudeCode.model,
    clackTools,
    mcpServers,
    mcpManager: mcpSetup.manager,
  };
}

function recordTraceEntry(
  message: SDKMessage,
  parsed: { toolUses: Array<{ name: string; args: Record<string, unknown> }> },
): ConversationMessage {
  const entry: ConversationMessage = {
    type: message.type,
    subtype: "subtype" in message ? String(message.subtype) : undefined,
    content: summarizeMessageContent(message),
    timestamp: Date.now(),
  };

  if (parsed.toolUses.length > 0) {
    const first = parsed.toolUses[0];
    entry.toolCall = { tool: first.name, args: first.args, result: {} };
  }

  return entry;
}

function optionalHistory(history: ToolCallRecord[]): ToolCallRecord[] | undefined {
  return history.length > 0 ? history : undefined;
}

function buildToolResults(clackTools: ClackToolsResult): {
  structuredResponse: SubmitResponsePayload | undefined;
  renderedBlocks: SlackBlocks | undefined;
  stagedIntents: Record<string, StagedIntent>;
} {
  const structuredResponse = clackTools.getResult() ?? undefined;
  const renderedBlocks = clackTools.getRenderedBlocks() ?? undefined;

  // Convert Map to plain object for serialization
  const stagedIntents: Record<string, StagedIntent> = {};
  for (const [ref, intent] of clackTools.getStagedIntents()) {
    stagedIntents[ref] = intent;
  }

  return { structuredResponse, renderedBlocks, stagedIntents };
}

function buildSuccessResponse(
  answer: string,
  conversationTrace: ConversationMessage[],
  clackTools: ClackToolsResult,
  streamToolHistory: ToolCallRecord[],
): ClaudeResponse {
  // Skip check must come before structuredResponse — when skipped,
  // responseCapture.get() returns null so structuredResponse is absent.
  if (clackTools.isSkipped()) {
    return {
      success: true,
      skipped: true,
      attentionLevel: clackTools.getAttentionLevel() ?? undefined,
      deliveryMode: clackTools.getDeliveryMode() ?? undefined,
      escalateToOwner: clackTools.getEscalateToOwner() ?? undefined,
      answer: "",
      conversationTrace,
      toolCallHistory: optionalHistory(streamToolHistory),
    };
  }

  const { structuredResponse, renderedBlocks, stagedIntents } = buildToolResults(clackTools);
  const optionalToolHistory = optionalHistory(streamToolHistory);
  const optionalIntents = Object.keys(stagedIntents).length > 0 ? stagedIntents : undefined;

  // If submit_response was called, use the structured response
  if (structuredResponse) {
    const answerText = extractDisplayText(structuredResponse.blocks);

    return {
      success: true,
      answer: answerText,
      conversationTrace,
      response: structuredResponse,
      renderedBlocks,
      stagedIntents: optionalIntents,
      toolCallHistory: optionalToolHistory,
      postedTopLevel: clackTools.isPostedTopLevel() || undefined,
      attentionLevel: clackTools.getAttentionLevel() ?? undefined,
      deliveryMode: clackTools.getDeliveryMode() ?? undefined,
      escalateToOwner: clackTools.getEscalateToOwner() ?? undefined,
    };
  }

  // No submit_response called — return raw text
  if (answer.trim()) {
    return {
      success: true,
      answer: answer.trim(),
      conversationTrace,
      toolCallHistory: optionalToolHistory,
    };
  }

  return {
    success: false,
    answer: "",
    error: "No response received from Claude",
    conversationTrace,
    toolCallHistory: optionalToolHistory,
  };
}

function handleQueryError(
  error: unknown,
  sessionId: string,
  conversationTrace: ConversationMessage[],
  stderrOutput: string,
  streamToolHistory: ToolCallRecord[],
  abortController?: AbortController,
): ClaudeResponse {
  const toolHistory = optionalHistory(streamToolHistory);
  // Detect cancellation via AbortController
  const isAbortError = error instanceof Error && error.name === "AbortError";
  const isSignalAbort =
    abortController?.signal.aborted && error instanceof Error && /aborted/i.test(error.message);

  if (isAbortError || isSignalAbort) {
    logger.info(`Claude query cancelled for session ${sessionId}`);
    return {
      success: false,
      cancelled: true,
      answer: "",
      conversationTrace,
      toolCallHistory: toolHistory,
    };
  }

  logger.error("Claude Agent SDK error:", error);
  if (stderrOutput) {
    logger.warn(`Claude stderr output:\n${stderrOutput}`);
  }
  return {
    success: false,
    answer: "",
    error: `Claude Agent SDK error: ${errorMessage(error)}`,
    conversationTrace,
    stderrOutput: stderrOutput || undefined,
    toolCallHistory: toolHistory,
  };
}

/**
 * Start a Claude run for the given session. Returns a `ClaudeRunHandle` whose
 * `futureResponse` resolves with the final `ClaudeResponse` once the run terminates.
 *
 * Callers may invoke `handle.sendUpdate(text)` while the run is in flight to push
 * follow-up user messages onto the live SDK Query, or `handle.stop(reason)` to abort.
 * Both reject cleanly once the run has settled (first-result-wins semantics).
 */
export async function askClaude(
  session: SessionContext,
  options?: AskClaudeOptions,
): Promise<ClaudeRunHandle> {
  // Forward-reference the run so the tool context can ask "is there pending input?"
  // before the run is constructed below. submit_response gates on this to refuse
  // finalizing while a sendUpdate push is unread.
  let runRef: ClaudeRunDriver | undefined;
  const { reposDir, systemPrompt, userPrompt, model, clackTools, mcpServers, mcpManager } =
    await buildQuerySetup(
      session,
      options,
      () => runRef?.hasPendingInput() ?? false,
      () => runRef?.consumePendingPushedTexts() ?? [],
      () => runRef?.markDelivered(),
    );

  logger.debug(`Querying Claude via Agent SDK for session ${session.sessionId}...`);

  const conversationTrace: ConversationMessage[] = [];
  const stderrLines: string[] = [];
  const streamToolHistory: ToolCallRecord[] = [];

  // Compute lastSeenThreadTs before the query starts
  const lastSeenTs = session.threadContext?.length
    ? session.threadContext[session.threadContext.length - 1].ts
    : undefined;

  // Forward declare so the run can reference itself in onTerminal (registry slot guard).
  let registeredHandle: ClaudeRunHandle | undefined;

  const run = clackSession({
    prompt: userPrompt,
    resumeSessionId: session.sdkSessionId,
    onSessionId: (id) => {
      updateSession(session.sessionId, { sdkSessionId: id }).catch((err) =>
        logger.warn(`Failed to save sdkSessionId: ${errorMessage(err)}`),
      );
    },
    onTerminal: () => {
      if (registeredHandle) {
        unregisterActiveRun(registeredHandle);
      }
    },
    onQuery: (query) => {
      // Bind the Query's setMcpServers so the manager (and by extension
      // `attach_integration`) can call it mid-session for NEW attachments.
      // Resume-time re-attach is handled at session-start — persisted
      // integrations are pre-loaded into `options.mcpServers` in buildQuerySetup
      // so the CLI's restored state matches --mcp-config exactly (otherwise we
      // get duplicate tool registrations and a 400 "tools must be unique" error).
      mcpManager.bind(query.setMcpServers.bind(query), query.mcpServerStatus.bind(query));
    },
    options: {
      cwd: reposDir,
      executable: detectRuntime(),
      systemPrompt,
      model,
      permissionMode: "bypassPermissions",
      tools: ["Read", "Glob", "Grep", "Skill", "WebSearch", "ToolSearch"],
      plugins: discoverEagerSkillPlugins(),
      mcpServers,
      // Force-pass ENABLE_TOOL_SEARCH so it reaches claude.exe regardless of
      // env propagation quirks. The SDK destructures `env: U = {...process.env}`,
      // so providing `env` here REPLACES process.env entirely — must spread it
      // back in to keep PATH, HOME, credentials, etc.
      env: {
        ...process.env,
        ENABLE_TOOL_SEARCH: process.env.ENABLE_TOOL_SEARCH ?? "true",
      },
      stderr: (data) => stderrLines.push(data),
    },
  });
  runRef = run;

  // Register in the active-runs registry so concurrent messages on the same thread can
  // route through `sendUpdate` instead of spawning a parallel session. Slot is freed by
  // the `onTerminal` hook above when the run settles or stops.
  if (registerActiveRun({ channelId: session.channelId, threadTs: session.threadTs }, run)) {
    registeredHandle = run;
  } else {
    // A registration collision means another run already owns this thread. Proceeding would
    // run a second SDK query that resumes the SAME `sdkSessionId` concurrently — corrupting
    // it — and would leave a run the stop pipeline can't reach (no registry entry). So abort
    // the duplicate instead of running it untracked. Release the per-thread lock first so the
    // owning run's waiter can proceed, then stop this run; `futureResponse` resolves cancelled
    // and the caller tears down its streamer via the cancellation path.
    logger.warn(
      `askClaude: active-runs slot already occupied for ${session.channelId}:${session.threadTs} (session ${session.sessionId}); aborting duplicate run`,
    );
    options?.onRegistered?.();
    await run.stop("duplicate run for thread");
    return run;
  }
  options?.onRegistered?.();

  // Bridge: until all callers migrate to `handle.stop(...)`, an external AbortController
  // passed via options aborts the run by triggering `run.stop`. Removed in the Slack
  // handler routing pass.
  if (options?.abortController) {
    if (options.abortController.signal.aborted) {
      void run.stop("aborted");
    } else {
      options.abortController.signal.addEventListener(
        "abort",
        () => {
          void run.stop("aborted");
        },
        { once: true },
      );
    }
  }

  async function driveRunToCompletion(): Promise<void> {
    try {
      let answer = "";
      const parser = new ClaudeMessageParser(options?.onEvent);

      for await (const message of run.messages) {
        const parsed = await parser.process(message);

        conversationTrace.push(recordTraceEntry(message, parsed));

        for (const completed of parsed.completedToolCalls) {
          streamToolHistory.push(completed);
          // Fire-and-forget: we don't want a slow `updateSession` (disk contention, etc.) to
          // stall the SDK stream. Errors are logged, not surfaced to callers.
          if (options?.onToolCall) {
            void Promise.resolve(options.onToolCall(completed)).catch((err) => {
              logger.warn(`onToolCall handler threw: ${errorMessage(err)}`);
            });
          }
        }

        if (parser.result) {
          if (parser.result.success) {
            answer = parser.result.text || parser.lastAssistantText;
            if (parser.result.usage) {
              // Fire-and-forget — don't block SDK stream teardown. addSessionUsage takes its own
              // per-session lock, so it serializes safely against the turn's finalization write.
              addSessionUsage(session.sessionId, parser.result.usage).catch((err) =>
                logger.warn(`Failed to persist session usage: ${errorMessage(err)}`),
              );
            }
            break;
          }
          // Defensive: if a "No conversation found" error ever reaches here, the
          // clackSession wrapper should already have retried on a fresh session.
          // Clear sdkSessionId anyway so the user's next turn starts clean.
          if (isResumeMissingError(parser.result.error ?? "")) {
            await updateSession(session.sessionId, { sdkSessionId: undefined });
          }
          run.settle({
            success: false,
            answer: "",
            error: `Claude query failed: ${parser.result.error}`,
            conversationTrace,
            toolCallHistory: optionalHistory(streamToolHistory),
          });
          return;
        }
      }

      // Check for platform errors masquerading as successful responses
      const platformError =
        detectPlatformError(answer) ?? detectPlatformError(parser.lastAssistantText);
      if (platformError) {
        logger.warn(`Platform error detected: ${platformError}`);
        run.settle({
          success: false,
          answer: "",
          error: platformError,
          conversationTrace,
          toolCallHistory: optionalHistory(streamToolHistory),
        });
        return;
      }

      // Persist lastSeenThreadTs so the next resumed query only injects delta context
      if (lastSeenTs) {
        updateSession(session.sessionId, { lastSeenThreadTs: lastSeenTs }).catch((err) =>
          logger.warn(`Failed to save lastSeenThreadTs: ${errorMessage(err)}`),
        );
      }

      run.settle(buildSuccessResponse(answer, conversationTrace, clackTools, streamToolHistory));
    } catch (error) {
      const stderrOutput = stderrLines.join("");
      const response = handleQueryError(
        error,
        session.sessionId,
        conversationTrace,
        stderrOutput,
        streamToolHistory,
        run.abortController,
      );
      // handleQueryError already builds a complete ClaudeResponse; settle with it directly
      // rather than re-converting via run.fail (which would lose the conversationTrace etc.).
      run.settle(response);
    }
  }
  driveRunToCompletion().catch((err) => {
    logger.error(`Unexpected error in askClaude completion driver: ${errorMessage(err)}`);
  });

  return run;
}
