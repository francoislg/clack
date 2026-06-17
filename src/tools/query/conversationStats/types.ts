export interface ChannelStat {
  channelId: string;
  channelName?: string;
  sessions: number;
  userTurns: number;
}

export interface AskerStat {
  userId: string;
  displayName?: string;
  sessions: number;
  userTurns: number;
}

export interface DMAskerStat {
  userId: string;
  displayName?: string;
  sessions: number;
}

export interface ConversationStat {
  sessionId: string;
  channelName?: string;
  displayName?: string;
  turns: number;
  durationMs: number;
}

export interface CountStat {
  userId: string;
  displayName?: string;
  count: number;
}

export interface VerbosityStat {
  userId: string;
  displayName?: string;
  avgWords: number;
}

export interface ToolStat {
  tool: string;
  calls: number;
}

export interface EmojiStat {
  emoji: string;
  count: number;
}

export interface StatsBundle {
  range: { from: number | null; to: number | null; sessionsScanned: number };
  totals: {
    sessions: number;
    clackReplies: number;
    byTrigger: Record<string, number>;
  };
  core: {
    topChannels: ChannelStat[];
    topAskers: AskerStat[];
    topDMAskers: DMAskerStat[];
    longest: {
      byTurns: ConversationStat | null;
      byDuration: ConversationStat | null;
    };
  };
  temporal: {
    byHour: number[];
    byDayOfWeek: number[];
    firstSessionAt: number | null;
    activeDays: number;
    busiestDay: { date: string; sessions: number } | null;
    afterMidnight: number;
  };
  engagement: {
    followUpRate: number;
    marathoner: { userId: string; displayName?: string; multiTurnSessions: number } | null;
    distinctUsers: number;
    distinctChannels: number;
    timesStayedQuiet: number;
  };
  personality: {
    mostInquisitive: CountStat[];
    mostExcitable: CountStat[];
    politest: CountStat[];
    mostVerbose: VerbosityStat[];
  };
  contentLite: {
    linksShared: number;
    longestQuestionWords: number;
  };
  tools: {
    favourite: ToolStat[];
    hardestWorkingSession: { sessionId: string; toolCalls: number } | null;
  };
  emoji: {
    teamTop: EmojiStat[];
    clackTop: EmojiStat[];
  };
}
