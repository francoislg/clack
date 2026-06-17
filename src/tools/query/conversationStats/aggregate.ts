import type { SessionMessage } from "../../../sessions.js";
import {
  exclamationCount,
  extractEmoji,
  linkCount,
  politenessCount,
  questionMarkCount,
  wordCount,
} from "./text.js";
import type {
  AskerStat,
  ChannelStat,
  ConversationStat,
  CountStat,
  DMAskerStat,
  EmojiStat,
  StatsBundle,
  ToolStat,
  VerbosityStat,
} from "./types.js";

/** Triggers a human starts directly — the only ones counted as "asking" Clack. */
const HUMAN_INITIATED = new Set(["reactions", "mentions", "directMessages"]);

const LEADERBOARD_SIZE = 10;
const EMOJI_SIZE = 15;
const DAY_MS = 86_400_000;
/** Minimum messages before a user qualifies for the verbosity board (avoids one-off outliers). */
const MIN_VERBOSITY_MESSAGES = 3;

/** Normalized session the fold operates on — resolved from either the structured or legacy shape. */
export interface FoldSession {
  sessionId: string;
  channelId: string;
  channelName?: string;
  userId: string;
  displayName?: string;
  triggerType: string;
  triggerText: string;
  createdAt: number;
  lastActivity?: number;
  messages: SessionMessage[];
}

interface RawSession {
  sessionId?: unknown;
  channelId?: unknown;
  channelName?: unknown;
  userId?: unknown;
  displayName?: unknown;
  triggerType?: unknown;
  trigger?: { type?: string; messageText?: string; prompt?: string };
  originalQuestion?: unknown;
  createdAt?: unknown;
  lastActivity?: unknown;
  messages?: unknown;
}

/** Resolve a persisted session (structured or legacy) into the fold shape, or null when unusable. */
export function normalizeSession(raw: RawSession): FoldSession | null {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.sessionId !== "string" ||
    typeof raw.channelId !== "string" ||
    typeof raw.userId !== "string" ||
    typeof raw.createdAt !== "number"
  ) {
    return null;
  }
  const triggerType =
    typeof raw.triggerType === "string" ? raw.triggerType : (raw.trigger?.type ?? "unknown");
  const triggerText =
    raw.trigger?.type === "scheduled"
      ? (raw.trigger.prompt ?? "")
      : (raw.trigger?.messageText ??
        (typeof raw.originalQuestion === "string" ? raw.originalQuestion : ""));
  return {
    sessionId: raw.sessionId,
    channelId: raw.channelId,
    channelName: typeof raw.channelName === "string" ? raw.channelName : undefined,
    userId: raw.userId,
    displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
    triggerType,
    triggerText,
    createdAt: raw.createdAt,
    lastActivity: typeof raw.lastActivity === "number" ? raw.lastActivity : undefined,
    messages: Array.isArray(raw.messages) ? (raw.messages as SessionMessage[]) : [],
  };
}

interface Counter {
  userId: string;
  displayName?: string;
  count: number;
}
interface Verbosity {
  userId: string;
  displayName?: string;
  words: number;
  messages: number;
}

export interface Accumulators {
  now: number;
  sessions: number;
  clackReplies: number;
  timesStayedQuiet: number;
  byTrigger: Map<string, number>;
  firstSessionAt: number | null;
  byHour: number[];
  byDayOfWeek: number[];
  afterMidnight: number;
  byDay: Map<string, number>;
  distinctUsers: Set<string>;
  distinctChannels: Set<string>;
  channels: Map<string, ChannelStat>;
  askers: Map<string, AskerStat>;
  dmAskers: Map<string, DMAskerStat>;
  humanSessions: number;
  followUpSessions: number;
  multiTurnByUser: Map<string, Counter>;
  inquisitive: Map<string, Counter>;
  excitable: Map<string, Counter>;
  polite: Map<string, Counter>;
  verbosity: Map<string, Verbosity>;
  linksShared: number;
  longestQuestionWords: number;
  toolCalls: Map<string, number>;
  hardestSession: { sessionId: string; toolCalls: number } | null;
  teamEmoji: Map<string, number>;
  clackEmoji: Map<string, number>;
  longestByTurns: ConversationStat | null;
  longestByDuration: ConversationStat | null;
}

export function createAccumulators(now: number): Accumulators {
  return {
    now,
    sessions: 0,
    clackReplies: 0,
    timesStayedQuiet: 0,
    byTrigger: new Map(),
    firstSessionAt: null,
    byHour: Array.from({ length: 24 }, () => 0),
    byDayOfWeek: Array.from({ length: 7 }, () => 0),
    afterMidnight: 0,
    byDay: new Map(),
    distinctUsers: new Set(),
    distinctChannels: new Set(),
    channels: new Map(),
    askers: new Map(),
    dmAskers: new Map(),
    humanSessions: 0,
    followUpSessions: 0,
    multiTurnByUser: new Map(),
    inquisitive: new Map(),
    excitable: new Map(),
    polite: new Map(),
    verbosity: new Map(),
    linksShared: 0,
    longestQuestionWords: 0,
    toolCalls: new Map(),
    hardestSession: null,
    teamEmoji: new Map(),
    clackEmoji: new Map(),
    longestByTurns: null,
    longestByDuration: null,
  };
}

function bump(map: Map<string, Counter>, s: FoldSession, by: number): void {
  if (by === 0) return;
  const entry = map.get(s.userId) ?? { userId: s.userId, displayName: s.displayName, count: 0 };
  entry.count += by;
  if (s.displayName) entry.displayName = s.displayName;
  map.set(s.userId, entry);
}

function tallyEmoji(map: Map<string, number>, text: string): void {
  for (const e of extractEmoji(text)) map.set(e, (map.get(e) ?? 0) + 1);
}

function localDayKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function foldSession(acc: Accumulators, s: FoldSession): void {
  acc.sessions += 1;
  acc.byTrigger.set(s.triggerType, (acc.byTrigger.get(s.triggerType) ?? 0) + 1);
  acc.firstSessionAt =
    acc.firstSessionAt === null ? s.createdAt : Math.min(acc.firstSessionAt, s.createdAt);
  acc.distinctChannels.add(s.channelId);

  const isHuman = HUMAN_INITIATED.has(s.triggerType);
  const isCron = s.triggerType === "scheduled";
  if (!isCron) acc.distinctUsers.add(s.userId);

  if (!isCron) {
    const d = new Date(s.createdAt);
    const hour = d.getHours();
    acc.byHour[hour] += 1;
    acc.byDayOfWeek[d.getDay()] += 1;
    if (hour < 5) acc.afterMidnight += 1;
    const day = localDayKey(d);
    acc.byDay.set(day, (acc.byDay.get(day) ?? 0) + 1);
  }

  const userMessages = s.messages.filter((m) => m.role === "user");
  let sessionToolCalls = 0;
  for (const m of s.messages) {
    if (m.role !== "assistant") continue;
    if (m.skipped) acc.timesStayedQuiet += 1;
    else acc.clackReplies += 1;
    if (m.text) tallyEmoji(acc.clackEmoji, m.text);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        acc.toolCalls.set(tc.tool, (acc.toolCalls.get(tc.tool) ?? 0) + 1);
      }
      sessionToolCalls += m.toolCalls.length;
    }
  }
  if (
    sessionToolCalls > 0 &&
    (!acc.hardestSession || sessionToolCalls > acc.hardestSession.toolCalls)
  ) {
    acc.hardestSession = { sessionId: s.sessionId, toolCalls: sessionToolCalls };
  }

  const userTurns = (isHuman ? 1 : 0) + userMessages.length;
  const channel = acc.channels.get(s.channelId) ?? {
    channelId: s.channelId,
    channelName: s.channelName,
    sessions: 0,
    userTurns: 0,
  };
  channel.sessions += 1;
  channel.userTurns += userTurns;
  if (s.channelName) channel.channelName = s.channelName;
  acc.channels.set(s.channelId, channel);

  if (!isHuman) return;

  acc.humanSessions += 1;
  const asker = acc.askers.get(s.userId) ?? {
    userId: s.userId,
    displayName: s.displayName,
    sessions: 0,
    userTurns: 0,
  };
  asker.sessions += 1;
  asker.userTurns += userTurns;
  if (s.displayName) asker.displayName = s.displayName;
  acc.askers.set(s.userId, asker);

  if (s.channelId.startsWith("D")) {
    const dm = acc.dmAskers.get(s.userId) ?? {
      userId: s.userId,
      displayName: s.displayName,
      sessions: 0,
    };
    dm.sessions += 1;
    if (s.displayName) dm.displayName = s.displayName;
    acc.dmAskers.set(s.userId, dm);
  }

  if (userMessages.length > 0) {
    acc.followUpSessions += 1;
    bump(acc.multiTurnByUser, s, 1);
  }

  const userTexts = [
    s.triggerText,
    ...userMessages.map((m) => (m.role === "user" ? m.text : "")),
  ].filter((t) => t.length > 0);
  let qm = 0;
  let ex = 0;
  let pol = 0;
  let words = 0;
  for (const text of userTexts) {
    qm += questionMarkCount(text);
    ex += exclamationCount(text);
    pol += politenessCount(text);
    acc.linksShared += linkCount(text);
    words += wordCount(text);
    acc.longestQuestionWords = Math.max(acc.longestQuestionWords, wordCount(text));
    tallyEmoji(acc.teamEmoji, text);
  }
  bump(acc.inquisitive, s, qm);
  bump(acc.excitable, s, ex);
  bump(acc.polite, s, pol);
  const verb = acc.verbosity.get(s.userId) ?? {
    userId: s.userId,
    displayName: s.displayName,
    words: 0,
    messages: 0,
  };
  verb.words += words;
  verb.messages += userTexts.length;
  if (s.displayName) verb.displayName = s.displayName;
  acc.verbosity.set(s.userId, verb);

  const turns = s.messages.length;
  const durationMs = (s.lastActivity ?? s.createdAt) - s.createdAt;
  const convo: ConversationStat = {
    sessionId: s.sessionId,
    channelName: s.channelName,
    displayName: s.displayName,
    turns,
    durationMs,
  };
  if (!acc.longestByTurns || turns > acc.longestByTurns.turns) acc.longestByTurns = convo;
  if (!acc.longestByDuration || durationMs > acc.longestByDuration.durationMs) {
    acc.longestByDuration = convo;
  }
}

/** Sort by a numeric metric (desc) then identifier (asc) for a stable, scan-order-independent order. */
function topBy<T>(entries: T[], metric: (t: T) => number, id: (t: T) => string, size: number): T[] {
  return [...entries]
    .sort((a, b) => metric(b) - metric(a) || id(a).localeCompare(id(b)))
    .slice(0, size);
}

export function finalize(acc: Accumulators): StatsBundle {
  const counters = (map: Map<string, Counter>): CountStat[] =>
    topBy(
      [...map.values()].filter((c) => c.count > 0),
      (c) => c.count,
      (c) => c.userId,
      LEADERBOARD_SIZE,
    ).map((c) => ({ userId: c.userId, displayName: c.displayName, count: c.count }));

  const verbose: VerbosityStat[] = topBy(
    [...acc.verbosity.values()].filter((v) => v.messages >= MIN_VERBOSITY_MESSAGES),
    (v) => v.words / v.messages,
    (v) => v.userId,
    LEADERBOARD_SIZE,
  ).map((v) => ({
    userId: v.userId,
    displayName: v.displayName,
    avgWords: Math.round((v.words / v.messages) * 10) / 10,
  }));

  const marathonerEntry = topBy(
    [...acc.multiTurnByUser.values()],
    (c) => c.count,
    (c) => c.userId,
    1,
  )[0];

  let busiestDay: { date: string; sessions: number } | null = null;
  for (const [date, sessions] of acc.byDay) {
    if (
      !busiestDay ||
      sessions > busiestDay.sessions ||
      (sessions === busiestDay.sessions && date < busiestDay.date)
    ) {
      busiestDay = { date, sessions };
    }
  }

  const channelStats: ChannelStat[] = topBy(
    [...acc.channels.values()],
    (c) => c.sessions,
    (c) => c.channelId,
    LEADERBOARD_SIZE,
  );
  const askerStats: AskerStat[] = topBy(
    [...acc.askers.values()],
    (a) => a.sessions,
    (a) => a.userId,
    LEADERBOARD_SIZE,
  );
  const dmAskerStats: DMAskerStat[] = topBy(
    [...acc.dmAskers.values()],
    (a) => a.sessions,
    (a) => a.userId,
    LEADERBOARD_SIZE,
  );
  const toolStats: ToolStat[] = topBy(
    [...acc.toolCalls.entries()].map(([tool, calls]) => ({ tool, calls })),
    (t) => t.calls,
    (t) => t.tool,
    LEADERBOARD_SIZE,
  );
  const emoji = (map: Map<string, number>): EmojiStat[] =>
    topBy(
      [...map.entries()].map(([e, count]) => ({ emoji: e, count })),
      (e) => e.count,
      (e) => e.emoji,
      EMOJI_SIZE,
    );

  return {
    range: { from: null, to: null, sessionsScanned: acc.sessions },
    totals: {
      sessions: acc.sessions,
      clackReplies: acc.clackReplies,
      byTrigger: Object.fromEntries(acc.byTrigger),
    },
    core: {
      topChannels: channelStats,
      topAskers: askerStats,
      topDMAskers: dmAskerStats,
      longest: { byTurns: acc.longestByTurns, byDuration: acc.longestByDuration },
    },
    temporal: {
      byHour: acc.byHour,
      byDayOfWeek: acc.byDayOfWeek,
      firstSessionAt: acc.firstSessionAt,
      activeDays:
        acc.firstSessionAt === null ? 0 : Math.floor((acc.now - acc.firstSessionAt) / DAY_MS) + 1,
      busiestDay,
      afterMidnight: acc.afterMidnight,
    },
    engagement: {
      followUpRate: acc.humanSessions === 0 ? 0 : acc.followUpSessions / acc.humanSessions,
      marathoner: marathonerEntry
        ? {
            userId: marathonerEntry.userId,
            displayName: marathonerEntry.displayName,
            multiTurnSessions: marathonerEntry.count,
          }
        : null,
      distinctUsers: acc.distinctUsers.size,
      distinctChannels: acc.distinctChannels.size,
      timesStayedQuiet: acc.timesStayedQuiet,
    },
    personality: {
      mostInquisitive: counters(acc.inquisitive),
      mostExcitable: counters(acc.excitable),
      politest: counters(acc.polite),
      mostVerbose: verbose,
    },
    contentLite: { linksShared: acc.linksShared, longestQuestionWords: acc.longestQuestionWords },
    tools: { favourite: toolStats, hardestWorkingSession: acc.hardestSession },
    emoji: { teamTop: emoji(acc.teamEmoji), clackTop: emoji(acc.clackEmoji) },
  };
}
