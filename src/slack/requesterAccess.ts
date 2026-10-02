import type { App } from "@slack/bolt";
import { z } from "zod";
import { getSlackAccessMode } from "../config.js";
import { logger } from "../logger.js";
import type { UserRole } from "../roles.js";
import { addAccessGrant, type SessionContext } from "../sessions.js";
import { getBotIdentity } from "./botIdentity.js";

/**
 * Requester access check: answers "can the human behind this run see this Slack conversation
 * or file?". Slack membership is the only grant — no Clack role bypasses it — and every
 * unknown answer is a denial. A conversation's kind and privacy are read from
 * `conversations.info` on every evaluation, so a channel converted from public to private is
 * judged as private as soon as the cached verdict expires. Verdicts and requester
 * classifications are cached in process memory only; the verdict cache and its in-flight
 * dedupe bound the conversation lookup to one per `(conversation, requester)` per TTL.
 *
 * `config.slackAccessMode: "bot"` turns the requester evaluation off: a conversation is always
 * allowed, a file is allowed whenever the bot can see it, and no session grant is recorded.
 */

type SlackClient = App["client"];

export interface AccessRequest {
  client: App["client"];
  /** QueryToolContext.userId */
  userId: string;
  /** QueryToolContext.role — "system" means the run has no requester */
  role: UserRole;
  /** Session whose grants are consulted and extended. Absent → no session grants. */
  session?: SessionContext;
}

export type AccessDenialReason =
  | "no_requester"
  | "not_member"
  | "unknown_conversation"
  | "lookup_failed"
  | "file_unavailable"
  | "no_evidence";

export type ConversationAccess = { allowed: true } | { allowed: false; reason: AccessDenialReason };

export type FileAccess =
  | { allowed: true; botAccess: "read" | "write" | undefined }
  | { allowed: false; reason: AccessDenialReason };

export const ACCESS_DENIED_MESSAGE =
  "The requester does not have access to that Slack conversation, so it cannot be read on their behalf.";
export const FILE_ACCESS_DENIED_MESSAGE =
  "The requester does not have access to that Slack file, so it cannot be used on their behalf.";

/** How long an allowed conversation verdict is reused before membership is looked up again. */
export const ALLOW_VERDICT_TTL_MS = 5 * 60 * 1000;
/** How long a denied conversation verdict is reused. Shorter than the allow TTL so a user
 *  added to a channel is not refused for long. */
export const DENY_VERDICT_TTL_MS = 60 * 1000;
/** How long a requester's guest-or-full-member classification is reused. */
export const CLASSIFICATION_TTL_MS = 60 * 60 * 1000;

/** Denial reasons that describe a failed lookup rather than a fact about the requester. */
const UNCACHED_REASONS: ReadonlySet<AccessDenialReason> = new Set([
  "lookup_failed",
  "unknown_conversation",
]);

const MEMBERS_PAGE_SIZE = 1000;

const ALLOWED: ConversationAccess = { allowed: true };

interface CachedVerdict {
  verdict: ConversationAccess;
  expiresAt: number;
}

interface CachedClassification {
  isGuest: boolean;
  expiresAt: number;
}

const verdictCache = new Map<string, CachedVerdict>();
const inFlightVerdicts = new Map<string, Promise<ConversationAccess>>();
const classificationCache = new Map<string, CachedClassification>();
const inFlightClassifications = new Map<string, Promise<boolean>>();

/** The fields of a `files.info` file that carry access evidence. Each field degrades to
 *  absent on a malformed value, so a surprising shape removes evidence instead of adding it. */
const fileEvidenceZod = z.object({
  user: z.string().optional().catch(undefined),
  access: z.string().optional().catch(undefined),
  channels: z.array(z.string()).optional().catch(undefined),
  groups: z.array(z.string()).optional().catch(undefined),
  ims: z.array(z.string()).optional().catch(undefined),
  dm_mpdm_users_with_file_access: z
    .array(z.object({ user_id: z.string().optional().catch(undefined) }))
    .optional()
    .catch(undefined),
});

type FileEvidence = z.infer<typeof fileEvidenceZod>;

/** The `conversations.info` channel fields the access rule reads. Each field degrades to
 *  absent on a malformed value, so a surprising shape never reads as a public channel. */
const conversationZod = z.object({
  is_im: z.boolean().optional().catch(undefined),
  is_private: z.boolean().optional().catch(undefined),
  is_member: z.boolean().optional().catch(undefined),
  user: z.string().optional().catch(undefined),
});

interface ConversationFacts {
  isIm: boolean;
  isPrivate: boolean | undefined;
  /** Whether the bot itself is a member of the conversation. */
  botIsMember: boolean;
  /** A DM's other party. */
  user: string | undefined;
}

function deny(reason: AccessDenialReason): { allowed: false; reason: AccessDenialReason } {
  return { allowed: false, reason };
}

function hasRequester(req: AccessRequest): boolean {
  return req.role !== "system";
}

function isSessionGranted(req: AccessRequest, targetId: string): boolean {
  return req.session?.accessGranted?.includes(targetId) === true;
}

/** Record an allowed target on the session. The persisted list is the source of truth; when the
 *  grant can't be persisted it is kept in memory only, and the verdict is left as is. */
async function recordGrant(req: AccessRequest, targetId: string): Promise<void> {
  const session = req.session;
  if (!session || session.accessGranted?.includes(targetId)) return;
  const inMemory = [...(session.accessGranted ?? []), targetId];
  try {
    const persisted = await addAccessGrant(session.sessionId, targetId);
    if (persisted) {
      session.accessGranted = persisted.accessGranted;
      return;
    }
    session.accessGranted = inMemory;
    logger.warn(
      `requesterAccess: session ${session.sessionId} not found, grant kept in memory only`,
    );
  } catch (error) {
    session.accessGranted = inMemory;
    logger.warn(
      `requesterAccess: failed to persist a grant on session ${session.sessionId}: ${String(error)}`,
    );
  }
}

async function fetchClassification(client: SlackClient, userId: string): Promise<boolean> {
  try {
    const [result, bot] = await Promise.all([
      client.users.info({ user: userId }),
      getBotIdentity(client),
    ]);
    const user = result.user;
    if (!user) return true;
    const flagged =
      user.is_restricted === true || user.is_ultra_restricted === true || user.is_stranger === true;
    const otherTeam = Boolean(user.team_id) && Boolean(bot.teamId) && user.team_id !== bot.teamId;
    const isGuest = flagged || otherTeam;
    classificationCache.set(userId, { isGuest, expiresAt: Date.now() + CLASSIFICATION_TTL_MS });
    return isGuest;
  } catch (error) {
    logger.warn(`requesterAccess: user lookup failed for ${userId}: ${String(error)}`);
    return true;
  }
}

/** Whether the requester is a guest or external user. A failed lookup reads as guest and is
 *  not cached, so the next check asks Slack again. */
function isGuestRequester(client: SlackClient, userId: string): Promise<boolean> {
  const cached = classificationCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.isGuest);
  const existing = inFlightClassifications.get(userId);
  if (existing) return existing;
  const pending = fetchClassification(client, userId).finally(() =>
    inFlightClassifications.delete(userId),
  );
  inFlightClassifications.set(userId, pending);
  return pending;
}

/** Paginate `conversations.members`, stopping at the first page that holds the requester. */
async function membershipVerdict(
  client: SlackClient,
  channelId: string,
  userId: string,
): Promise<ConversationAccess> {
  try {
    let cursor: string | undefined;
    do {
      const page = await client.conversations.members({
        channel: channelId,
        limit: MEMBERS_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });
      if (page.members?.includes(userId)) return ALLOWED;
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return deny("not_member");
  } catch (error) {
    logger.warn(`requesterAccess: membership lookup failed for ${channelId}: ${String(error)}`);
    return deny("lookup_failed");
  }
}

/** What Slack reports about a conversation right now. A thrown error, a failed response or a
 *  missing channel reads as an unknown conversation. */
async function lookupConversation(
  client: SlackClient,
  channelId: string,
): Promise<ConversationFacts | undefined> {
  try {
    const result = await client.conversations.info({ channel: channelId });
    if (!result.ok || !result.channel) return undefined;
    const parsed = conversationZod.safeParse(result.channel);
    if (!parsed.success) return undefined;
    return {
      isIm: parsed.data.is_im === true,
      isPrivate: parsed.data.is_private,
      botIsMember: parsed.data.is_member === true,
      user: parsed.data.user,
    };
  } catch (error) {
    logger.warn(`requesterAccess: conversation lookup failed for ${channelId}: ${String(error)}`);
    return undefined;
  }
}

/** A DM is visible to its user only. The DM's user comes from the conversation lookup, so no
 *  further Slack call is made. */
function dmVerdict(conversation: ConversationFacts, userId: string): ConversationAccess {
  return conversation.user === userId ? ALLOWED : deny("not_member");
}

async function evaluateForRequester(
  client: SlackClient,
  channelId: string,
  userId: string,
): Promise<ConversationAccess> {
  const conversation = await lookupConversation(client, channelId);
  if (!conversation) return deny("unknown_conversation");
  if (conversation.isIm) return dmVerdict(conversation, userId);
  if (conversation.isPrivate === false && !(await isGuestRequester(client, userId))) {
    return ALLOWED;
  }
  return membershipVerdict(client, channelId, userId);
}

/** A run with no requester sees public channels, plus the private channels and group DMs the
 *  bot was invited into. It never sees a DM. */
async function evaluateWithoutRequester(
  client: SlackClient,
  channelId: string,
): Promise<ConversationAccess> {
  const conversation = await lookupConversation(client, channelId);
  if (!conversation) return deny("unknown_conversation");
  if (conversation.isIm) return deny("no_requester");
  if (conversation.isPrivate === false || conversation.botIsMember) return ALLOWED;
  return deny("no_requester");
}

async function evaluateAndCache(
  client: SlackClient,
  channelId: string,
  userId: string,
  key: string,
): Promise<ConversationAccess> {
  let verdict: ConversationAccess;
  try {
    verdict = await evaluateForRequester(client, channelId, userId);
  } catch (error) {
    logger.warn(`requesterAccess: evaluation failed for ${channelId}: ${String(error)}`);
    return deny("lookup_failed");
  }
  if (verdict.allowed) {
    verdictCache.set(key, { verdict, expiresAt: Date.now() + ALLOW_VERDICT_TTL_MS });
  } else if (!UNCACHED_REASONS.has(verdict.reason)) {
    verdictCache.set(key, { verdict, expiresAt: Date.now() + DENY_VERDICT_TTL_MS });
  }
  return verdict;
}

/** The cached, deduped verdict for one `(conversation, requester)` pair. */
function requesterVerdict(
  client: SlackClient,
  channelId: string,
  userId: string,
): Promise<ConversationAccess> {
  const key = `${channelId}:${userId}`;
  const cached = verdictCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.verdict);
  const existing = inFlightVerdicts.get(key);
  if (existing) return existing;
  const pending = evaluateAndCache(client, channelId, userId, key).finally(() =>
    inFlightVerdicts.delete(key),
  );
  inFlightVerdicts.set(key, pending);
  return pending;
}

/** The conversation verdict — session grant first, then the requester — recording nothing. */
async function conversationVerdict(
  req: AccessRequest,
  channelId: string,
): Promise<ConversationAccess> {
  if (isSessionGranted(req, channelId)) return ALLOWED;
  try {
    return hasRequester(req)
      ? await requesterVerdict(req.client, channelId, req.userId)
      : await evaluateWithoutRequester(req.client, channelId);
  } catch (error) {
    logger.warn(`requesterAccess: conversation check failed for ${channelId}: ${String(error)}`);
    return deny("lookup_failed");
  }
}

/**
 * Whether the requester can see a Slack conversation. Never throws: every Slack error is a
 * denial. An allowance is recorded on `req.session`; a denial never is.
 */
export async function checkConversationAccess(
  req: AccessRequest,
  channelId: string,
): Promise<ConversationAccess> {
  if (getSlackAccessMode() === "bot") return ALLOWED;
  const verdict = await conversationVerdict(req, channelId);
  if (verdict.allowed) await recordGrant(req, channelId);
  return verdict;
}

async function fetchFileEvidence(
  client: SlackClient,
  fileId: string,
): Promise<FileEvidence | undefined> {
  try {
    const result = await client.files.info({ file: fileId });
    if (!result.file) return undefined;
    const parsed = fileEvidenceZod.safeParse(result.file);
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    logger.warn(`requesterAccess: file lookup failed for ${fileId}: ${String(error)}`);
    return undefined;
  }
}

function botAccessOf(file: FileEvidence): "read" | "write" | undefined {
  return file.access === "read" || file.access === "write" ? file.access : undefined;
}

/** The requester created the file or is named in its per-user access list. */
function isNamedOnFile(req: AccessRequest, file: FileEvidence): boolean {
  if (!hasRequester(req)) return false;
  if (file.user === req.userId) return true;
  const listed = file.dm_mpdm_users_with_file_access ?? [];
  return listed.some((entry) => entry.user_id === req.userId);
}

/** The requester passes the conversation rule for a conversation the file is shared to. */
async function isSharedWithRequester(req: AccessRequest, file: FileEvidence): Promise<boolean> {
  const shares = [...(file.channels ?? []), ...(file.groups ?? []), ...(file.ims ?? [])];
  for (const channelId of shares) {
    const verdict = await conversationVerdict(req, channelId);
    if (verdict.allowed) return true;
  }
  return false;
}

/**
 * Whether the requester can see a Slack file (canvases and lists included), from positive
 * evidence only. Fetches the file's info itself and reports the bot's own access level on an
 * allowance. Never throws: every Slack error is a denial. An allowance is recorded on
 * `req.session`; a denial never is.
 */
export async function checkFileAccess(req: AccessRequest, fileId: string): Promise<FileAccess> {
  const file = await fetchFileEvidence(req.client, fileId);
  if (!file) return deny("file_unavailable");
  const allowed: FileAccess = { allowed: true, botAccess: botAccessOf(file) };
  if (getSlackAccessMode() === "bot" || isSessionGranted(req, fileId)) return allowed;
  try {
    if (!isNamedOnFile(req, file) && !(await isSharedWithRequester(req, file))) {
      return deny(hasRequester(req) ? "no_evidence" : "no_requester");
    }
  } catch (error) {
    logger.warn(`requesterAccess: file check failed for ${fileId}: ${String(error)}`);
    return deny("lookup_failed");
  }
  await recordGrant(req, fileId);
  return allowed;
}

/** Test helper: clear the verdict and classification caches and their in-flight lookups. */
export function clearRequesterAccessCache(): void {
  verdictCache.clear();
  inFlightVerdicts.clear();
  classificationCache.clear();
  inFlightClassifications.clear();
}
