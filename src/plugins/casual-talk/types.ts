/**
 * A configured candidate channel. Bare strings are the common case — admins just list
 * channel IDs. Objects with `promptSuggestion` give Claude a per-channel character hint
 * for cases where the channel name/purpose isn't enough (e.g. "memes only — keep it visual").
 */
export type CasualTalkChannel = string | { id: string; promptSuggestion?: string };

/** Named chattiness rates — mapped to a roll-die size by the heuristic given `workHours`. */
export type CasualTalkRate = "hourly" | "2-per-day" | "daily" | "2-per-week" | "weekly";

/**
 * Work-hour window during which the cron may fire. `start` is inclusive (e.g. 9 = first
 * fire at HH=9). `end` is exclusive (e.g. 16 = last fire at HH=15:45 for the fixed
 * 15-minute cadence). `days` are JS day-of-week numbers (0=Sun, 6=Sat).
 */
export interface CasualTalkWorkHours {
  start: number;
  end: number;
  tz: string;
  days: number[];
}

export interface CasualTalkConfig {
  enabled: boolean;
  channels: CasualTalkChannel[];
  workHours: CasualTalkWorkHours;
  expectedRate: CasualTalkRate;
  /**
   * Optional override for the resolved die size. When set, wins over `expectedRate`
   * in the heuristic. Clamped to `>= 1`.
   */
  die?: number;
  smallTalkTopics: string[];
  /** When true, the built-in fallback topics are unioned with `smallTalkTopics`. */
  useBuiltinFallbackTopics: boolean;
}

/** Normalize a channel entry to its canonical object form for downstream consumers. */
export function normalizeChannel(entry: CasualTalkChannel): {
  id: string;
  promptSuggestion?: string;
} {
  if (typeof entry === "string") return { id: entry };
  return entry;
}
