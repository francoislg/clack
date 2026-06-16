import { mkdir, readFile, writeFile, rename, rm, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getConfig, getSessionsDir } from "./config.js";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import type { ErrorRecord, ConversationMessage } from "./claude/index.js";
import { addUsage, type SessionUsage } from "./claude/usage.js";
import type {
  SubmitResponsePayload,
  ToolCallRecord,
  ResponseSnapshot,
  StagedIntent,
} from "./tools/types.js";
import type { SlackImageFile, SlackFile } from "./slack/slackFileBase.js";
import type { ChangeStatus, TriggerType } from "./changes/types.js";
import type { ActiveChangeState } from "./changes/activeState.js";
import { getActiveChange, clearActiveChange } from "./changes/activeState.js";

export interface SlackAttachmentField {
  title?: string;
  value?: string;
}

export interface SlackAttachment {
  text?: string;
  fallback?: string;
  title?: string;
  pretext?: string;
  author_name?: string;
  fields?: SlackAttachmentField[];
}

/** Minimal block shape accepted from both @slack/types KnownBlock and auto-generated response types.
 *  The full block structure is preserved at runtime for JSON serialization in tool output. */
export interface SlackBlock {
  type: string;
}

export interface MessageReaction {
  emoji: string;
  userIds: string[];
  usernames?: string[];
  /** Whether each user is a bot (parallel to userIds) */
  isBot?: boolean[];
}

export interface ThreadMessage {
  text: string;
  userId: string;
  isBot: boolean;
  ts: string;
  username?: string;
  displayName?: string;
  /** Raw blocks from the Slack message (preserved for tool output) */
  blocks?: SlackBlock[];
  /** Legacy attachments from the Slack message */
  attachments?: SlackAttachment[];
  /** Uploaded image files attached to this message */
  imageFiles?: SlackImageFile[];
  /** Non-image file attachments (PDFs, text files, etc.) */
  files?: SlackFile[];
  /** Emoji reactions on this message */
  reactions?: MessageReaction[];
}

// ============================================================================
// Session Trigger + Conversation Log
//
// A session has two parts:
//   - `trigger`: structured metadata describing what started the session (user
//                message, cron job, etc.). Discriminated union — the shape
//                depends on the trigger type.
//   - `messages[]`: a pure temporal log of everything that happened after.
//                   `messages[0]` is ALWAYS an assistant turn (Clack's first
//                   delivered response). User thread replies and button
//                   clicks are appended as `SessionUserMessage` entries.
// ============================================================================

/** Discriminated union describing what created a session. */
export type SessionTrigger =
  | {
      type: "reactions";
      userId: string;
      emoji: string;
      messageTs: string;
      messageText: string;
      imageFiles?: SlackImageFile[];
    }
  | {
      type: "mentions";
      userId: string;
      messageTs: string;
      messageText: string;
      imageFiles?: SlackImageFile[];
    }
  | {
      type: "directMessages";
      userId: string;
      messageTs: string;
      messageText: string;
      imageFiles?: SlackImageFile[];
    }
  | {
      type: "autoRespond";
      userId: string;
      messageTs: string;
      messageText: string;
      ruleName?: string;
      imageFiles?: SlackImageFile[];
      /** Pre-analysis verdict that decided the session should be created. */
      preAnalysis?: string;
    }
  | {
      type: "scheduled";
      jobId?: string;
      prompt: string;
      /** Skip-condition verdict at session creation, if the cron had one. */
      preAnalysis?: string;
    };

/** The set of trigger-type discriminator values. */
export type SessionTriggerType = SessionTrigger["type"];

/** User-authored entries appended after the session's trigger. No `"initial"` here —
 *  the session-creating text lives on the trigger, not on `messages[]`. */
export type SessionUserMessageSource = "reply" | "choice" | "followup";

export interface SessionUserMessage {
  role: "user";
  source: SessionUserMessageSource;
  text: string;
  ts: number;
  /** Machine value for `source: "choice"` (the action value, not the button label) */
  value?: string;
}

export interface SessionAssistantMessage {
  role: "assistant";
  ts: number;
  /** Plain-text rendering of the response as delivered to the user. Absent when `skipped` is true. */
  text?: string;
  /** Structured response authored by Claude via submit_response. Absent when `skipped` is true. */
  payload?: SubmitResponsePayload;
  /** Turn declined to answer via submit_response skip_response */
  skipped?: true;
  /** Turn opted out of further thread tracking (disengage requires skip_response) */
  disengaged?: true;
  /** Turn was delivered at channel top level (no thread_ts) */
  postedTopLevel?: true;
  /** Tool calls issued during this turn. Omitted when the turn made no tool calls. */
  toolCalls?: ToolCallRecord[];
  /** Error scoped to this specific turn (session-wide failures go on SessionContext.errors). */
  error?: ErrorRecord;
  /** Pre-analysis verdict for the autoRespond/threadReply gate that preceded this turn.
   *  Present for autoRespond-driven turns; absent for user-first and scheduled triggers. */
  preAnalysis?: string;
}

export type SessionMessage = SessionUserMessage | SessionAssistantMessage;

/**
 * Per-conversation attention dial — the single source of truth for thread auto-respond
 * engagement. A monotonic ladder from most eager to disengaged:
 *   - `"always"` — respond to every thread reply; pre-analysis is skipped entirely.
 *   - `"high"`   — respond to nearly everything; skip only unmistakable other-user side-talk.
 *   - `"medium"` — respond when plausibly relevant; skip clear cross-talk. The default.
 *   - `"low"`    — respond only to direct address / clear follow-ups; the only rung whose
 *                  pre-analysis gate may disengage the thread.
 *   - `"off"`    — disengaged; thread replies are ignored.
 * A thread is engaged iff its level is not `"off"` (see {@link isEngaged}).
 */
export type AttentionLevel = "always" | "high" | "medium" | "low" | "off";

/**
 * The subset of {@link AttentionLevel} a trigger source (plugin cron, auto-respond rule,
 * session creation) may seed. `"off"` is excluded: a dead thread is only ever reached by an
 * explicit disengage action, never born disengaged.
 */
export type SettableAttentionLevel = Exclude<AttentionLevel, "off">;

/**
 * Per-thread delivery mode. `"streamer"` (the default — absent reads as this) shows the live
 * `SlackStreamer` thinking / tool-progress card; `"invisible"` suppresses it and delivers the
 * turn silently (the existing `silentThinking` path). Sibling of {@link AttentionLevel}: where
 * attention governs *how eagerly* a thread is followed, delivery mode governs *how* it delivers.
 */
export type DeliveryMode = "streamer" | "invisible";

export interface SessionContext {
  sessionId: string;
  channelId: string;
  messageTs: string;
  threadTs: string;
  userId: string;
  username?: string;
  displayName?: string;
  /** Structured metadata describing what created this session. Discriminated union.
   *  The session-creating user message (or cron prompt) lives here — NOT on `messages[]`. */
  trigger: SessionTrigger;
  /** Temporal log of everything that happened after the trigger. `messages[0]` is always an
   *  assistant turn (Clack's first response). User thread replies, choice/followup clicks
   *  append later entries. Readers must use the selectors in `./sessions/selectors.js`. */
  messages: SessionMessage[];
  threadContext: ThreadMessage[];
  errors: ErrorRecord[];
  lastActivity: number;
  createdAt: number;
  /** Staged intents from action tools, keyed by ref ID */
  stagedIntents?: Record<string, StagedIntent>;
  /** How the session was triggered (mirrors `trigger.type`). Kept as a top-level field for
   *  filter queries like `find_recent_interactions` that want to shallow-scan without parsing
   *  the full trigger. */
  triggerType?: TriggerType;
  /** Resolved channel name (e.g., "backend-dev") */
  channelName?: string;
  /** Additional system prompt injected into the delivery context */
  additionalSystemPrompt?: string;
  /** DM-first delivery: the DM channel ID */
  dmChannel?: string;
  /** DM-first delivery: the root DM message timestamp (thread anchor) */
  dmThreadTs?: string;
  /** DM-first delivery: the original channel where the reaction was added */
  originChannel?: string;
  /** DM-first delivery: the original thread timestamp in the channel */
  originThreadTs?: string;
  /** DM-first delivery: timestamp of the message posted to the original channel */
  channelPostTs?: string;
  /** Assistant thread: channel the user was viewing when the thread was opened (immutable) */
  assistantOriginChannelId?: string;
  /** Assistant thread: channel the user is currently viewing (updated on context changes) */
  assistantCurrentChannelId?: string;
  /** Saved response snapshots, keyed by auto-generated ID */
  snapshots?: Record<string, ResponseSnapshot>;
  /** Timestamp of Clack's top-level response (when posted without thread_ts).
   *  Used so replies to this message can find the originating session. */
  responseTs?: string;
  /** SDK session ID for resuming Claude conversations across turns */
  sdkSessionId?: string;
  /** Timestamp of the most recent thread message at last query start (for delta context) */
  lastSeenThreadTs?: string;
  /** Active change execution state (runtime-only, not persisted) */
  activeChange?: ActiveChangeState;
  /** Per-conversation attention dial governing thread auto-respond engagement and the
   *  pre-analysis gate's eagerness. Absent reads as `"medium"`. `"off"` is disengaged. */
  attentionLevel?: AttentionLevel;
  /** Per-thread delivery mode read at turn start to drive `silentThinking`. Absent reads as
   *  `"streamer"`. `"invisible"` suppresses the live thinking card on this thread's turns. */
  deliveryMode?: DeliveryMode;
  /**
   * Integrations the session has attached via `attach_integration` mid-session.
   * Persisted so resumed turns can re-attach (call `query.setMcpServers`) before
   * the first assistant message. Absent/empty means no lazy integrations are active.
   */
  attachedIntegrations?: string[];
  /**
   * Per-attempt history of every `attach_integration` call in this session. Unlike
   * `attachedIntegrations` (which is the current *successful* set), this records
   * every attempt — success, duplicate, or failure — with the outcome and any
   * error text, in chronological order. Used for post-hoc debugging of sessions
   * where Claude reached for an integration and something went wrong.
   */
  mcpAttachHistory?: Array<{
    name: string;
    outcome: "ok" | "duplicate" | "failed" | "instructions_only";
    error?: string;
    timestamp: number;
  }>;
  /**
   * Skills loaded in this session via `load_skill`. Each entry is a (pack, skill)
   * pair. Persisted so resumed turns short-circuit repeated loads of the same
   * skill. Absent/empty means no lazy skills have been loaded yet.
   */
  loadedSkills?: Array<{ pack: string; skill: string }>;
  /**
   * Cumulative token + cost usage for this session, accumulated across every Claude run
   * attributed to it (each query turn, plus any auto-executed worker run folded back via
   * {@link addSessionUsage}). Absent on sessions persisted before usage tracking existed.
   */
  usage?: SessionUsage;
}

function generateSessionId(channelId: string, messageTs: string, userId: string): string {
  const timestamp = Date.now();
  const base = `${channelId}-${messageTs}-${userId}-${timestamp}`;
  return base.replace(/[^a-zA-Z0-9]/g, "-");
}

export interface ParsedSessionId {
  channelId: string;
  messageTs: string;
  userId: string;
}

/**
 * Parse a sessionId to extract the original channelId, messageTs, and userId.
 * SessionId format: {channelId}-{messageTs with . replaced by -}-{userId}-{timestamp}
 * Example: C0A82GNR25V-1768338604-542809-U09FSR0REUQ-1768400009272
 */
export function parseSessionId(sessionId: string): ParsedSessionId | null {
  const match = sessionId.match(/^([CG][A-Z0-9]+)-(\d+)-(\d+)-([U][A-Z0-9]+)-\d+$/);

  if (!match) {
    logger.error(`Failed to parse sessionId: ${sessionId}`);
    return null;
  }

  const [, channelId, tsSeconds, tsMicros, userId] = match;
  const messageTs = `${tsSeconds}.${tsMicros}`;

  return { channelId, messageTs, userId };
}

export function getSessionPath(sessionId: string): string {
  return resolve(getSessionsDir(), sessionId);
}

function getContextPath(sessionId: string): string {
  return resolve(getSessionPath(sessionId), "context.json");
}

// ============================================================================
// In-Memory State
// ============================================================================

/** Runtime session cache — merges disk state with in-memory runtime fields */
const sessionCache = new Map<string, SessionContext>();

/** Thread-to-session index for O(1) lookups: "channel:threadTs" → sessionId */
const threadIndex = new Map<string, string>();

/** Per-session write locks — serialize read-merge-write cycles for the same sessionId
 *  so concurrent callers can't clobber each other or race at the filesystem level. */
const sessionLocks = new Map<string, Promise<unknown>>();

function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(sessionId, next);
  next.finally(() => {
    if (sessionLocks.get(sessionId) === next) sessionLocks.delete(sessionId);
  });
  return next;
}

/** Write context.json atomically: write to a tmp sibling, then rename into place.
 *  rename() is atomic on POSIX, so readers always see either the old or new file —
 *  never a half-written one, even if the process crashes mid-write. */
async function writeContextAtomic(sessionId: string, data: PersistableSession): Promise<void> {
  const final = getContextPath(sessionId);
  const tmp = `${final}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, final);
}

function getThreadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

/** SessionContext fields that are actually persisted to disk.
 *  Excludes runtime-only state held in memory or sourced from Slack on each turn. */
type PersistableSession = Omit<SessionContext, "activeChange" | "threadContext">;

/**
 * Strip runtime-only and Slack-derived fields before persisting to disk.
 * These fields are held in the session cache and don't need to survive restarts.
 */
function stripRuntimeFields(session: SessionContext): PersistableSession {
  const { activeChange: _activeChange, threadContext: _threadContext, ...persistable } = session;
  return persistable;
}

/** On-disk shape for sessions persisted before the unified-conversation-log migration.
 *  Carries the legacy fields that `synthesizeMessagesFromLegacy` converts into `messages[]`.
 *  Kept narrow — only what the synthesis needs. */
export interface LegacySessionShape {
  originalQuestion?: string;
  refinements?: string[];
  lastAnswer?: string;
  lastResponse?: SubmitResponsePayload;
  toolCallHistory?: ToolCallRecord[];
  imageFiles?: SlackImageFile[];
  createdAt: number;
  lastActivity: number;
}

/** Result of synthesizing a pre-trigger-split session file: produces both the trigger
 *  metadata and the post-trigger messages log. */
export interface SynthesizedSession {
  trigger: SessionTrigger;
  messages: SessionMessage[];
}

/** Inputs the synthesizer needs. We accept either a purely legacy shape or a first-wave
 *  unified-log shape (`messages` populated but no `trigger`). */
export interface SynthesizeInput extends LegacySessionShape {
  /** First-wave unified-log shape: messages[] may be present with a `source: "initial"` head. */
  messages?: SessionMessage[];
  /** Top-level triggerType drives the synthesized trigger's discriminator. */
  triggerType?: TriggerType;
  /** Carried through to user-first trigger variants. */
  userId?: string;
  /** Carried onto the trigger's messageTs for user-first variants. */
  messageTs?: string;
}

/** Synthesize a `{ trigger, messages }` pair from an on-disk session that predates the
 *  trigger split. Handles two input shapes:
 *   (a) Pre-unified-log (originalQuestion + refinements + lastAnswer + lastResponse): build
 *       trigger from originalQuestion, construct messages[] from refinements + assistant reply.
 *   (b) First-wave unified-log (messages[0] as `source: "initial"`): lift messages[0] into a
 *       synthesized trigger; convert subsequent user entries from "refinement"/"initial" → "reply". */
export function synthesizeMessagesFromLegacy(input: SynthesizeInput): SynthesizedSession {
  const triggerType = input.triggerType ?? "mentions";
  const userId = input.userId ?? "";

  // Derive the triggering text — messages[0] wins over legacy originalQuestion.
  let triggerText = input.originalQuestion ?? "";
  let triggerImages = input.imageFiles;
  let firstWaveInitialTs: number | undefined;
  const firstWaveUserMessages: SessionUserMessage[] = [];
  const firstWaveAssistantMessages: SessionAssistantMessage[] = [];

  if (input.messages && input.messages.length > 0) {
    for (const msg of input.messages) {
      if (msg.role === "user") {
        // Widen the runtime shape so we can recognize legacy "initial"/"refinement" values.
        const asLegacy = msg as SessionUserMessage & { imageFiles?: SlackImageFile[] };
        const legacySource: string = asLegacy.source;
        if (legacySource === "initial" && !firstWaveInitialTs) {
          triggerText = asLegacy.text;
          triggerImages = asLegacy.imageFiles ?? triggerImages;
          firstWaveInitialTs = asLegacy.ts;
          continue;
        }
        const narrowedSource: SessionUserMessageSource =
          legacySource === "choice" || legacySource === "followup"
            ? (legacySource as "choice" | "followup")
            : "reply";
        firstWaveUserMessages.push({
          role: "user",
          source: narrowedSource,
          text: asLegacy.text,
          ts: asLegacy.ts,
          ...(asLegacy.value !== undefined ? { value: asLegacy.value } : {}),
        });
      } else {
        firstWaveAssistantMessages.push(msg);
      }
    }
  }

  const trigger = buildSynthesizedTrigger({
    triggerType,
    userId,
    messageTs: input.messageTs ?? "",
    messageText: triggerText,
    imageFiles: triggerImages,
  });

  // Merge first-wave messages in original order. If we split them above by role, we lose
  // chronological ordering — so reconstruct by walking the original array a second time.
  const messages: SessionMessage[] = [];
  if (input.messages && input.messages.length > 0) {
    for (const msg of input.messages) {
      if (msg.role === "user") {
        const asLegacy = msg as SessionUserMessage;
        const legacySource: string = asLegacy.source;
        if (legacySource === "initial") continue; // lifted into trigger
        const narrowedSource: SessionUserMessageSource =
          legacySource === "choice" || legacySource === "followup"
            ? (legacySource as "choice" | "followup")
            : "reply";
        messages.push({
          role: "user",
          source: narrowedSource,
          text: asLegacy.text,
          ts: asLegacy.ts,
          ...(asLegacy.value !== undefined ? { value: asLegacy.value } : {}),
        });
      } else {
        messages.push(msg);
      }
    }
    return { trigger, messages };
  }

  // Pure legacy shape (no messages array): synthesize from originalQuestion/refinements/lastAnswer.
  for (const refinement of input.refinements ?? []) {
    messages.push({
      role: "user",
      source: "reply",
      text: refinement,
      ts: input.createdAt,
    });
  }
  if (input.lastAnswer !== undefined || input.lastResponse !== undefined) {
    const assistant: SessionAssistantMessage = {
      role: "assistant",
      ts: input.lastActivity,
    };
    if (input.lastAnswer !== undefined) assistant.text = input.lastAnswer;
    if (input.lastResponse !== undefined) assistant.payload = input.lastResponse;
    if (input.toolCallHistory !== undefined) assistant.toolCalls = input.toolCallHistory;
    messages.push(assistant);
  }
  return { trigger, messages };
}

/** Build a `SessionTrigger` from loose inputs (shape-matching the pre-split on-disk fields).
 *  Used by the synthesizer; fields that don't apply to a given type are dropped by TS narrowing. */
function buildSynthesizedTrigger(input: {
  triggerType: TriggerType;
  userId: string;
  messageTs: string;
  messageText: string;
  imageFiles?: SlackImageFile[];
}): SessionTrigger {
  switch (input.triggerType) {
    case "scheduled":
      return { type: "scheduled", prompt: input.messageText };
    case "reactions":
      // The emoji isn't preserved in legacy files — default to empty string as a placeholder.
      return {
        type: "reactions",
        userId: input.userId,
        emoji: "",
        messageTs: input.messageTs,
        messageText: input.messageText,
        ...(input.imageFiles !== undefined ? { imageFiles: input.imageFiles } : {}),
      };
    case "autoRespond":
    case "threadReply":
      // Pre-split files used "threadReply" as a distinct triggerType; the new model treats
      // threadReply continuations as the original autoRespond session's trigger, so normalize.
      return {
        type: "autoRespond",
        userId: input.userId,
        messageTs: input.messageTs,
        messageText: input.messageText,
        ...(input.imageFiles !== undefined ? { imageFiles: input.imageFiles } : {}),
      };
    case "mentions":
    case "directMessages":
    default:
      return {
        type: input.triggerType === "directMessages" ? "directMessages" : "mentions",
        userId: input.userId,
        messageTs: input.messageTs,
        messageText: input.messageText,
        ...(input.imageFiles !== undefined ? { imageFiles: input.imageFiles } : {}),
      };
  }
}

// ============================================================================
// Session CRUD
// ============================================================================

export interface CreateSessionOptions {
  channelId: string;
  messageTs: string;
  threadTs: string;
  userId: string;
  /** Structured metadata describing what created this session. Drives the session's
   *  `trigger` field. For user-first types this carries the triggering message; for
   *  scheduled cron jobs it carries the job prompt. */
  trigger: SessionTrigger;
  threadContext?: ThreadMessage[];
  username?: string;
  displayName?: string;
  additionalSystemPrompt?: string;
  channelName?: string;
  /** Initial attention level seeded by the trigger source (cron/rule). Defaults to `"medium"`. */
  attentionLevel?: SettableAttentionLevel;
  /** Initial delivery mode seeded by the trigger source. Omit to leave it default (`"streamer"`). */
  deliveryMode?: DeliveryMode;
}

export async function createSession(opts: CreateSessionOptions): Promise<SessionContext> {
  const sessionsDir = getSessionsDir();

  if (!(await fileExists(sessionsDir))) {
    await mkdir(sessionsDir, { recursive: true });
  }

  const sessionId = generateSessionId(opts.channelId, opts.messageTs, opts.userId);
  const sessionPath = getSessionPath(sessionId);

  await mkdir(sessionPath, { recursive: true });

  const now = Date.now();
  const context: SessionContext = {
    sessionId,
    channelId: opts.channelId,
    messageTs: opts.messageTs,
    threadTs: opts.threadTs,
    userId: opts.userId,
    username: opts.username,
    displayName: opts.displayName,
    trigger: opts.trigger,
    messages: [],
    threadContext: opts.threadContext ?? [],
    triggerType: opts.trigger.type,
    additionalSystemPrompt: opts.additionalSystemPrompt,
    channelName: opts.channelName,
    errors: [],
    lastActivity: now,
    createdAt: now,
    attentionLevel: opts.attentionLevel ?? "medium",
    ...(opts.deliveryMode && { deliveryMode: opts.deliveryMode }),
  };

  // Write to disk (strip runtime fields)
  await writeContextAtomic(sessionId, stripRuntimeFields(context));

  // Populate caches and index
  sessionCache.set(sessionId, context);
  threadIndex.set(getThreadKey(opts.channelId, opts.threadTs), sessionId);

  logger.debug(`Created session ${sessionId}`);
  return context;
}

/** Synthetic author for plugin-seeded thread-engagement sessions (no human author yet). */
const THREAD_ENGAGEMENT_USER_ID = "thread-engagement";

export interface EngageThreadOptions {
  /** Attention level to seed onto the destination thread. `"off"` makes the call a no-op. */
  attentionLevel: AttentionLevel;
  /** Guidance injected into the answer turn (stored as the session's `additionalSystemPrompt`). */
  followUpContext?: string;
  /** Delivery mode to seed onto the destination thread. Omit to leave it default (`"streamer"`). */
  deliveryMode?: DeliveryMode;
}

/**
 * Seed a discoverable, engaged session for a destination `(channel, threadRoot)` so that human
 * replies in that thread are picked up by the existing thread auto-respond path. The seeded
 * session carries no messages — it exists only so `findSessionByThread` resolves it and
 * `isEngaged` passes; `followUpContext` rides along as `additionalSystemPrompt` and is injected
 * into the reply turn's prompt the same way an auto-respond rule's `extraContext` is.
 *
 * `attentionLevel: "off"` is a no-op (today's fire-and-forget behavior). When a session already
 * exists for the thread it is left untouched — a real conversation already owns it.
 */
export async function registerThreadSession(
  channel: string,
  threadRoot: string,
  opts: EngageThreadOptions,
): Promise<SessionContext | null> {
  if (opts.attentionLevel === "off") {
    return null;
  }

  const existing = await findSessionByThread(channel, threadRoot);
  if (existing) {
    return existing;
  }

  return createSession({
    channelId: channel,
    messageTs: threadRoot,
    threadTs: threadRoot,
    userId: THREAD_ENGAGEMENT_USER_ID,
    trigger: { type: "scheduled", prompt: "Seeded thread engagement (awaiting human reply)." },
    attentionLevel: opts.attentionLevel,
    additionalSystemPrompt: opts.followUpContext,
    ...(opts.deliveryMode && { deliveryMode: opts.deliveryMode }),
  });
}

export async function getSession(sessionId: string): Promise<SessionContext | null> {
  // Check cache first
  const cached = sessionCache.get(sessionId);
  if (cached) {
    // Merge latest activeChange state from dedicated module
    cached.activeChange = getActiveChange(sessionId);
    return cached;
  }

  // Read from disk
  const contextPath = getContextPath(sessionId);
  if (!(await fileExists(contextPath))) {
    return null;
  }

  try {
    const content = await readFile(contextPath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("sessionId" in parsed) ||
      (!("messages" in parsed) && !("originalQuestion" in parsed))
    ) {
      logger.warn(`Corrupt session file ${contextPath}: missing required fields`);
      return null;
    }
    // On-disk files may be in one of three shapes:
    //   (a) Pre-unified-log: has `originalQuestion` + `refinements` + `lastAnswer`/`lastResponse`, no `messages`.
    //   (b) First-wave unified-log: has `messages[]` with `messages[0]` as `source: "initial"`, no `trigger`.
    //   (c) Final: has `trigger` + `messages[]` (assistant-first).
    // The synthesizer handles (a) and (b); (c) passes through untouched.
    const session = parsed as SessionContext & Partial<LegacySessionShape>;

    // Backward compatibility: ensure arrays exist
    if (!session.errors) session.errors = [];
    if (!session.threadContext) session.threadContext = [];
    // Migrate legacy engagement flag onto the attention dial: a disengaged session reads
    // as "off", everything else as the new "medium" default. The old field is then dropped.
    if (session.attentionLevel === undefined) {
      const legacy = (session as { autoResponseActive?: boolean }).autoResponseActive;
      session.attentionLevel = legacy === false ? "off" : "medium";
    }
    delete (session as { autoResponseActive?: boolean }).autoResponseActive;
    // If there's no trigger yet (pre-split shape), synthesize from whichever shape is on disk.
    if (!session.trigger) {
      const synth = synthesizeMessagesFromLegacy(session);
      session.trigger = synth.trigger;
      session.messages = synth.messages;
      if (!session.triggerType) session.triggerType = synth.trigger.type;
    }
    if (!session.messages) session.messages = [];

    // Merge active change state from dedicated module
    const ac = getActiveChange(sessionId);
    if (ac) session.activeChange = ac;

    // Cache for future lookups and populate thread index
    sessionCache.set(sessionId, session);
    const key = getThreadKey(session.channelId, session.threadTs);
    if (!threadIndex.has(key)) {
      threadIndex.set(key, sessionId);
    }
    if (session.responseTs) {
      const responseKey = getThreadKey(session.channelId, session.responseTs);
      if (!threadIndex.has(responseKey)) {
        threadIndex.set(responseKey, sessionId);
      }
    }

    return session;
  } catch (error) {
    logger.error(`Failed to read session ${sessionId}, quarantining:`, error);
    try {
      await rename(contextPath, `${contextPath}.corrupt-${Date.now()}`);
    } catch (renameErr) {
      logger.warn(`Failed to quarantine corrupt session ${sessionId}: ${renameErr}`);
    }
    return null;
  }
}

export async function findSessionByMessage(
  channelId: string,
  messageTs: string,
  userId: string,
): Promise<SessionContext | null> {
  // Check cache first
  for (const session of sessionCache.values()) {
    if (
      session.channelId === channelId &&
      session.messageTs === messageTs &&
      session.userId === userId
    ) {
      return session;
    }
  }

  // Fallback: disk scan
  const sessionsDir = getSessionsDir();
  if (!(await fileExists(sessionsDir))) {
    return null;
  }

  const sessionDirs = await readdir(sessionsDir);
  for (const dir of sessionDirs) {
    const session = await getSession(dir);
    if (
      session &&
      session.channelId === channelId &&
      session.messageTs === messageTs &&
      session.userId === userId
    ) {
      return session;
    }
  }

  return null;
}

export async function findSessionByThread(
  channelId: string,
  threadTs: string,
): Promise<SessionContext | null> {
  // Check thread index first (O(1))
  const key = getThreadKey(channelId, threadTs);
  const indexedId = threadIndex.get(key);
  if (indexedId) {
    return getSession(indexedId);
  }

  // Fallback: disk scan (getSession populates index on hit)
  const sessionsDir = getSessionsDir();
  if (!(await fileExists(sessionsDir))) {
    return null;
  }

  const sessionDirs = await readdir(sessionsDir);
  for (const dir of sessionDirs) {
    const session = await getSession(dir);
    if (session && session.channelId === channelId && session.threadTs === threadTs) {
      return session;
    }
  }

  return null;
}

export async function findSessionByDmThread(
  dmChannel: string,
  dmThreadTs: string,
): Promise<SessionContext | null> {
  // Check cache first
  for (const session of sessionCache.values()) {
    if (session.dmChannel === dmChannel && session.dmThreadTs === dmThreadTs) {
      return session;
    }
  }

  // Fallback: disk scan
  const sessionsDir = getSessionsDir();
  if (!(await fileExists(sessionsDir))) {
    return null;
  }

  const sessionDirs = await readdir(sessionsDir);
  for (const dir of sessionDirs) {
    const session = await getSession(dir);
    if (session && session.dmChannel === dmChannel && session.dmThreadTs === dmThreadTs) {
      return session;
    }
  }

  return null;
}

/**
 * Unlocked body of updateSession — callers MUST hold the session lock.
 * Reads the latest state via getSession (cache-first, populated by the previous
 * lock holder), merges updates, writes atomically, and updates the cache.
 */
async function updateSessionUnlocked(
  sessionId: string,
  updates: Partial<SessionContext>,
): Promise<SessionContext | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  const updated: SessionContext = {
    ...session,
    ...updates,
    lastActivity: Date.now(),
  };

  await writeContextAtomic(sessionId, stripRuntimeFields(updated));
  sessionCache.set(sessionId, updated);

  // Index responseTs so findSessionByThread can find this session by the posted message
  if (updates.responseTs) {
    threadIndex.set(getThreadKey(updated.channelId, updates.responseTs), sessionId);
  }

  return updated;
}

export function updateSession(
  sessionId: string,
  updates: Partial<SessionContext>,
): Promise<SessionContext | null> {
  return withSessionLock(sessionId, () => updateSessionUnlocked(sessionId, updates));
}

/**
 * Add a run's usage component-wise onto a session's persisted `usage`, treating a missing
 * record on either side as zero. Read-modify-write inside the session lock so concurrent
 * folds (e.g. a query turn and an async worker run completing close together) don't clobber.
 * Returns null if the session no longer exists (evicted) — never throws.
 */
export function addSessionUsage(
  sessionId: string,
  delta: SessionUsage,
): Promise<SessionContext | null> {
  return withSessionLock(sessionId, async () => {
    const session = await getSession(sessionId);
    if (!session) return null;
    return updateSessionUnlocked(sessionId, { usage: addUsage(session.usage, delta) });
  });
}

export async function setAttentionLevel(sessionId: string, level: AttentionLevel): Promise<void> {
  await updateSession(sessionId, { attentionLevel: level });
}

export async function setDeliveryMode(sessionId: string, mode: DeliveryMode): Promise<void> {
  await updateSession(sessionId, { deliveryMode: mode });
}

/** A session is engaged for thread auto-respond unless its attention level is `"off"`.
 *  Absent level reads as `"medium"`. */
export function isEngaged(session: Pick<SessionContext, "attentionLevel">): boolean {
  return (session.attentionLevel ?? "medium") !== "off";
}

/**
 * Append a user message to the session's unified conversation log.
 *
 * Dual-writes the legacy `refinements[]` field so pre-migration readers (prompt
 * builder, find_recent_interactions, etc.) keep working during the transition.
 * The legacy dual-write is removed in §9 of the unified-conversation-log change.
 *
 * For `source: "initial"` (the first message), call `createSession()` instead —
 * `appendUserMessage` is for continuations only.
 */
export function appendUserMessage(
  sessionId: string,
  message: SessionUserMessage,
): Promise<SessionContext | null> {
  return withSessionLock(sessionId, async () => {
    const session = await getSession(sessionId);
    if (!session) return null;
    const existing = session.messages ?? [];
    return updateSessionUnlocked(sessionId, {
      messages: [...existing, message],
    });
  });
}

/** Append an assistant turn (or skip/error turn) to the session's unified conversation log. */
export function appendAssistantMessage(
  sessionId: string,
  message: SessionAssistantMessage,
): Promise<SessionContext | null> {
  return withSessionLock(sessionId, async () => {
    const session = await getSession(sessionId);
    if (!session) return null;
    const existing = session.messages ?? [];
    return updateSessionUnlocked(sessionId, {
      messages: [...existing, message],
    });
  });
}

export function updateThreadContext(
  sessionId: string,
  threadContext: ThreadMessage[],
): Promise<SessionContext | null> {
  return updateSession(sessionId, { threadContext });
}

export function addError(
  sessionId: string,
  errorMessage: string,
  conversationTrace: ConversationMessage[],
): Promise<SessionContext | null> {
  return withSessionLock(sessionId, async () => {
    const session = await getSession(sessionId);
    if (!session) return null;

    const errorRecord: ErrorRecord = {
      timestamp: Date.now(),
      errorMessage,
      conversationTrace,
    };

    return updateSessionUnlocked(sessionId, {
      errors: [...session.errors, errorRecord],
    });
  });
}

export function hasErrors(session: SessionContext): boolean {
  return session.errors && session.errors.length > 0;
}

export function touchSession(sessionId: string): Promise<SessionContext | null> {
  return updateSession(sessionId, {});
}

/**
 * Resolve a staged intent by session ID and ref key.
 * Returns null if the session or intent doesn't exist.
 */
export async function getStagedIntent(
  sessionId: string,
  ref: string,
): Promise<StagedIntent | null> {
  const session = await getSession(sessionId);
  if (!session?.stagedIntents?.[ref]) return null;
  return session.stagedIntents[ref];
}

/**
 * Merge new staged intents into session.stagedIntents under the session lock.
 * Used by submit_response (write-through before delivering the button-bearing
 * message) and by persistResponseState (defense-in-depth at turn end). Existing
 * refs are preserved so a follow-up turn that stages a different intent does
 * not invalidate the buttons posted by an earlier turn.
 */
export async function appendStagedIntents(
  sessionId: string,
  newIntents: Record<string, StagedIntent>,
): Promise<void> {
  if (Object.keys(newIntents).length === 0) return;
  await withSessionLock(sessionId, async () => {
    const session = await getSession(sessionId);
    if (!session) return null;
    const merged = { ...session.stagedIntents, ...newIntents };
    return updateSessionUnlocked(sessionId, { stagedIntents: merged });
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  // Clean up in-memory state
  const session = sessionCache.get(sessionId);
  if (session) {
    threadIndex.delete(getThreadKey(session.channelId, session.threadTs));
  }
  sessionCache.delete(sessionId);
  clearActiveChange(sessionId);

  // Clean up disk
  const sessionPath = getSessionPath(sessionId);
  if (await fileExists(sessionPath)) {
    await rm(sessionPath, { recursive: true });
    logger.debug(`Deleted session ${sessionId}`);
  }
}

// ============================================================================
// Session Cleanup (age-based eviction)
// ============================================================================

const MAX_AGE_DAYS = 30;

/**
 * Check if a session is eligible for age-based eviction.
 * Sessions with active (non-terminal) changes are never evicted.
 */
function isSessionEvictable(session: SessionContext): boolean {
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const age = Date.now() - session.createdAt;

  if (age < maxAgeMs) return false;

  // Don't evict sessions with active changes
  if (session.activeChange) {
    const terminalStatuses: ChangeStatus[] = ["completed", "failed"];
    if (!terminalStatuses.includes(session.activeChange.status)) {
      return false;
    }
  }

  return true;
}

export async function cleanupExpiredSessions(): Promise<void> {
  const sessionsDir = getSessionsDir();

  if (!(await fileExists(sessionsDir))) {
    return;
  }

  const sessionDirs = await readdir(sessionsDir);
  let cleaned = 0;
  let preserved = 0;

  for (const dir of sessionDirs) {
    const session = await getSession(dir);
    if (session && isSessionEvictable(session)) {
      // Skip cleanup of sessions with errors for debugging purposes
      if (hasErrors(session)) {
        preserved++;
        continue;
      }
      await deleteSession(dir);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} old sessions`);
  }
  if (preserved > 0) {
    logger.debug(`Preserved ${preserved} old sessions with errors for debugging`);
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupScheduler(): void {
  const config = getConfig();
  const intervalMinutes = config.sessions.cleanupIntervalMinutes;
  const intervalMs = intervalMinutes * 60 * 1000;

  logger.debug(`Starting session cleanup scheduler (every ${intervalMinutes} minutes)`);

  cleanupInterval = setInterval(() => {
    cleanupExpiredSessions().catch((err) => {
      logger.error(`Session cleanup failed: ${err}`);
    });
  }, intervalMs);
}

export function stopCleanupScheduler(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.debug("Session cleanup scheduler stopped");
  }
}
