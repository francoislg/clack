import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig, getSessionsDir } from "./config.js";

export interface SessionContext {
  sessionId: string;
  channelId: string;
  messageTs: string;
  threadTs: string;
  userId: string;
  originalQuestion: string;
  threadContext: string[];
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
    console.error(`Failed to parse sessionId: ${sessionId}`);
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

export function createSession(
  channelId: string,
  messageTs: string,
  threadTs: string,
  userId: string,
  originalQuestion: string,
  threadContext: string[] = []
): SessionContext {
  const sessionsDir = getSessionsDir();

  // Ensure sessions directory exists
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  const sessionId = generateSessionId(channelId, messageTs, userId);
  const sessionPath = getSessionPath(sessionId);

  // Create session directory
  mkdirSync(sessionPath, { recursive: true });

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
  writeFileSync(getContextPath(sessionId), JSON.stringify(context, null, 2));

  console.log(`Created session ${sessionId}`);
  return context;
}

export function getSession(sessionId: string): SessionContext | null {
  const contextPath = getContextPath(sessionId);

  if (!existsSync(contextPath)) {
    return null;
  }

  try {
    const content = readFileSync(contextPath, "utf-8");
    return JSON.parse(content) as SessionContext;
  } catch (error) {
    console.error(`Failed to read session ${sessionId}:`, error);
    return null;
  }
}

export function findSessionByMessage(
  channelId: string,
  messageTs: string,
  userId: string
): SessionContext | null {
  const sessionsDir = getSessionsDir();

  if (!existsSync(sessionsDir)) {
    return null;
  }

  const sessionDirs = readdirSync(sessionsDir);

  for (const dir of sessionDirs) {
    const session = getSession(dir);
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

export function updateSession(sessionId: string, updates: Partial<SessionContext>): SessionContext | null {
  const session = getSession(sessionId);

  if (!session) {
    return null;
  }

  const updated: SessionContext = {
    ...session,
    ...updates,
    lastActivity: Date.now(),
  };

  writeFileSync(getContextPath(sessionId), JSON.stringify(updated, null, 2));
  return updated;
}

export function addRefinement(sessionId: string, refinement: string): SessionContext | null {
  const session = getSession(sessionId);

  if (!session) {
    return null;
  }

  return updateSession(sessionId, {
    refinements: [...session.refinements, refinement],
  });
}

export function updateThreadContext(sessionId: string, threadContext: string[]): SessionContext | null {
  return updateSession(sessionId, { threadContext });
}

export function setLastAnswer(sessionId: string, answer: string): SessionContext | null {
  return updateSession(sessionId, { lastAnswer: answer });
}

export function touchSession(sessionId: string): SessionContext | null {
  return updateSession(sessionId, {});
}

export function isSessionExpired(session: SessionContext): boolean {
  const config = getConfig();
  const timeoutMs = config.sessions.timeoutMinutes * 60 * 1000;
  const now = Date.now();

  return now - session.lastActivity > timeoutMs;
}

export function deleteSession(sessionId: string): void {
  const sessionPath = getSessionPath(sessionId);

  if (existsSync(sessionPath)) {
    rmSync(sessionPath, { recursive: true });
    console.log(`Deleted session ${sessionId}`);
  }
}

export function cleanupExpiredSessions(): void {
  const sessionsDir = getSessionsDir();

  if (!existsSync(sessionsDir)) {
    return;
  }

  const sessionDirs = readdirSync(sessionsDir);
  let cleaned = 0;

  for (const dir of sessionDirs) {
    const session = getSession(dir);
    if (session && isSessionExpired(session)) {
      deleteSession(dir);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired sessions`);
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupScheduler(): void {
  const config = getConfig();
  const intervalMs = config.sessions.cleanupIntervalMinutes * 60 * 1000;

  console.log(`Starting session cleanup scheduler (every ${config.sessions.cleanupIntervalMinutes} minutes)`);

  cleanupInterval = setInterval(() => {
    cleanupExpiredSessions();
  }, intervalMs);
}

export function stopCleanupScheduler(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("Session cleanup scheduler stopped");
  }
}
