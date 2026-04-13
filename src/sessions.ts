import { mkdir, readFile, writeFile, rename, rm, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getConfig, getSessionsDir } from "./config.js";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import type { ErrorRecord, ConversationMessage } from "./claude/index.js";
import type {
  SubmitResponsePayload,
  ToolCallRecord,
  ContinuationRecord,
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

export interface SessionContext {
  sessionId: string;
  channelId: string;
  messageTs: string;
  threadTs: string;
  userId: string;
  username?: string;
  displayName?: string;
  originalQuestion: string;
  threadContext: ThreadMessage[];
  refinements: string[];
  lastAnswer?: string;
  errors: ErrorRecord[];
  lastActivity: number;
  createdAt: number;
  /** Structured response from submit_response tool */
  lastResponse?: SubmitResponsePayload;
  /** Tool call history from the latest query */
  toolCallHistory?: ToolCallRecord[];
  /** Staged intents from action tools, keyed by ref ID */
  stagedIntents?: Record<string, StagedIntent>;
  /** History of user continuations (choice, followup, refine) */
  continuationHistory?: ContinuationRecord[];
  /** Images from the triggering message */
  imageFiles?: SlackImageFile[];
  /** How the session was triggered */
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
  /** Whether this session is actively tracked for auto-respond thread replies.
   *  Defaults to true. Set to false to disengage from thread tracking. */
  autoResponseActive?: boolean;
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

// ============================================================================
// Session CRUD
// ============================================================================

export interface CreateSessionOptions {
  channelId: string;
  messageTs: string;
  threadTs: string;
  userId: string;
  originalQuestion: string;
  threadContext?: ThreadMessage[];
  username?: string;
  displayName?: string;
  triggerType?: SessionContext["triggerType"];
  additionalSystemPrompt?: string;
  channelName?: string;
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
    originalQuestion: opts.originalQuestion,
    threadContext: opts.threadContext ?? [],
    triggerType: opts.triggerType,
    additionalSystemPrompt: opts.additionalSystemPrompt,
    channelName: opts.channelName,
    refinements: [],
    errors: [],
    lastActivity: now,
    createdAt: now,
    autoResponseActive: true,
  };

  // Write to disk (strip runtime fields)
  await writeContextAtomic(sessionId, stripRuntimeFields(context));

  // Populate caches and index
  sessionCache.set(sessionId, context);
  threadIndex.set(getThreadKey(opts.channelId, opts.threadTs), sessionId);

  logger.debug(`Created session ${sessionId}`);
  return context;
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
      !("originalQuestion" in parsed)
    ) {
      logger.warn(`Corrupt session file ${contextPath}: missing required fields`);
      return null;
    }
    const session = parsed as SessionContext;

    // Backward compatibility: ensure arrays exist
    if (!session.errors) session.errors = [];
    if (!session.refinements) session.refinements = [];
    if (!session.threadContext) session.threadContext = [];
    // Default autoResponseActive to true for pre-existing sessions
    if (session.autoResponseActive === undefined) session.autoResponseActive = true;

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

export async function setAutoResponseActive(sessionId: string, active: boolean): Promise<void> {
  await updateSession(sessionId, { autoResponseActive: active });
}

export function addRefinement(
  sessionId: string,
  refinement: string,
): Promise<SessionContext | null> {
  return withSessionLock(sessionId, async () => {
    const session = await getSession(sessionId);
    if (!session) return null;
    return updateSessionUnlocked(sessionId, {
      refinements: [...session.refinements, refinement],
    });
  });
}

export function updateThreadContext(
  sessionId: string,
  threadContext: ThreadMessage[],
): Promise<SessionContext | null> {
  return updateSession(sessionId, { threadContext });
}

export function setLastAnswer(sessionId: string, answer: string): Promise<SessionContext | null> {
  return updateSession(sessionId, { lastAnswer: answer });
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
