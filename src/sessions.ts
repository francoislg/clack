import { mkdir, readFile, writeFile, rm, readdir, access } from "node:fs/promises";
import { resolve } from "node:path";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
import { getConfig, getSessionsDir } from "./config.js";
import { logger } from "./logger.js";

export interface ThreadMessage {
  text: string;
  userId: string;
  isBot: boolean;
  ts: string;
}

export interface SessionContext {
  sessionId: string;
  channelId: string;
  messageTs: string;
  threadTs: string;
  userId: string;
  originalQuestion: string;
  threadContext: ThreadMessage[];
  refinements: string[];
  lastAnswer?: string;
  lastActivity: number;
  createdAt: number;
}

function generateSessionId(channelId: string, messageTs: string, userId: string): string {
  // Create a unique session ID from channel, message, and user
  const timestamp = Date.now();
  const base = `${channelId}-${messageTs}-${userId}-${timestamp}`;
  // Simple hash to keep it shorter
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
  // Pattern: channelId (C or G prefix), messageTs (seconds-microseconds), userId (U prefix), timestamp
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

export async function createSession(
  channelId: string,
  messageTs: string,
  threadTs: string,
  userId: string,
  originalQuestion: string,
  threadContext: ThreadMessage[] = []
): Promise<SessionContext> {
  const sessionsDir = getSessionsDir();

  // Ensure sessions directory exists
  if (!(await exists(sessionsDir))) {
    await mkdir(sessionsDir, { recursive: true });
  }

  const sessionId = generateSessionId(channelId, messageTs, userId);
  const sessionPath = getSessionPath(sessionId);

  // Create session directory
  await mkdir(sessionPath, { recursive: true });

  const now = Date.now();
  const context: SessionContext = {
    sessionId,
    channelId,
    messageTs,
    threadTs,
    userId,
    originalQuestion,
    threadContext,
    refinements: [],
    lastActivity: now,
    createdAt: now,
  };

  // Write context file
  await writeFile(getContextPath(sessionId), JSON.stringify(context, null, 2));

  logger.debug(`Created session ${sessionId}`);
  return context;
}

export async function getSession(sessionId: string): Promise<SessionContext | null> {
  const contextPath = getContextPath(sessionId);

  if (!(await exists(contextPath))) {
    return null;
  }

  try {
    const content = await readFile(contextPath, "utf-8");
    return JSON.parse(content) as SessionContext;
  } catch (error) {
    logger.error(`Failed to read session ${sessionId}:`, error);
    return null;
  }
}

export async function findSessionByMessage(
  channelId: string,
  messageTs: string,
  userId: string
): Promise<SessionContext | null> {
  const sessionsDir = getSessionsDir();

  if (!(await exists(sessionsDir))) {
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
  threadTs: string
): Promise<SessionContext | null> {
  const sessionsDir = getSessionsDir();

  if (!(await exists(sessionsDir))) {
    return null;
  }

  const sessionDirs = await readdir(sessionsDir);

  for (const dir of sessionDirs) {
    const session = await getSession(dir);
    if (
      session &&
      session.channelId === channelId &&
      session.threadTs === threadTs
    ) {
      return session;
    }
  }

  return null;
}

export async function updateSession(sessionId: string, updates: Partial<SessionContext>): Promise<SessionContext | null> {
  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  const updated: SessionContext = {
    ...session,
    ...updates,
    lastActivity: Date.now(),
  };

  await writeFile(getContextPath(sessionId), JSON.stringify(updated, null, 2));
  return updated;
}

export async function addRefinement(sessionId: string, refinement: string): Promise<SessionContext | null> {
  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  return updateSession(sessionId, {
    refinements: [...session.refinements, refinement],
  });
}

export async function updateThreadContext(sessionId: string, threadContext: ThreadMessage[]): Promise<SessionContext | null> {
  return updateSession(sessionId, { threadContext });
}

export async function setLastAnswer(sessionId: string, answer: string): Promise<SessionContext | null> {
  return updateSession(sessionId, { lastAnswer: answer });
}

export async function touchSession(sessionId: string): Promise<SessionContext | null> {
  return updateSession(sessionId, {});
}

export function isSessionExpired(session: SessionContext): boolean {
  const config = getConfig();
  const timeoutMs = config.sessions.timeoutMinutes * 60 * 1000;
  const now = Date.now();

  return now - session.lastActivity > timeoutMs;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const sessionPath = getSessionPath(sessionId);

  if (await exists(sessionPath)) {
    await rm(sessionPath, { recursive: true });
    logger.debug(`Deleted session ${sessionId}`);
  }
}

export async function cleanupExpiredSessions(): Promise<void> {
  const sessionsDir = getSessionsDir();

  if (!(await exists(sessionsDir))) {
    return;
  }

  const sessionDirs = await readdir(sessionsDir);
  let cleaned = 0;

  for (const dir of sessionDirs) {
    const session = await getSession(dir);
    if (session && isSessionExpired(session)) {
      await deleteSession(dir);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} expired sessions`);
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupScheduler(): void {
  const config = getConfig();
  const intervalMs = config.sessions.cleanupIntervalMinutes * 60 * 1000;

  logger.debug(`Starting session cleanup scheduler (every ${config.sessions.cleanupIntervalMinutes} minutes)`);

  cleanupInterval = setInterval(() => {
    cleanupExpiredSessions();
  }, intervalMs);
}

export function stopCleanupScheduler(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.debug("Session cleanup scheduler stopped");
  }
}
