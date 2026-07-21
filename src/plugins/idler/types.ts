/**
 * An hours window on a set of days. Used for both the work and sync schedules. The schedule fires
 * INSIDE the window; set start > end for an overnight window (e.g. start 18, end 9 = 6 PM–9 AM).
 */
export interface IdlerWindow {
  /** Inclusive start hour [0..23]. */
  start: number;
  /** Exclusive end hour [1..24]. */
  end: number;
  tz: string;
  /** Days [0..6] (0 = Sunday) the schedule runs. It is idle on all other days. */
  days: number[];
}

/**
 * What and where the idler reports. Two orthogonal knobs gate Slack output:
 * `tickUpdates` (per-fire chatter) and `summary` (the morning digest). The activity ledger is
 * written regardless of either, so the summary always has material when enabled.
 */
export interface IdlerReporting {
  /** Destination for any Slack output (per-tick posts and the digest). Absent ⇒ idler dormant. */
  channel?: string;
  /**
   * Per-tick work-fire output. `"none"` (default): no Slack output per fire — the work fire still
   * triages/reviews/implements, but stays silent. `"optional"`: posts progress when it acts.
   */
  tickUpdates: "none" | "optional";
  /** Whether the morning digest fires. Default true. */
  summary: boolean;
  /** Hour [0..23] the digest fires; default 9. Only relevant when `summary` is true. */
  summaryHour?: number;
}

/** Discovery sources the idler sweeps. Each is gracefully skipped when its MCP is absent. */
export interface IdlerSources {
  /** Slack channel IDs to scan (incl. bot-alert channels like #sentry-alerts). */
  channels: string[];
  /** Poll an external tracker (Asana, Sentry, …) via its MCP, per the fetch instructions. */
  tracker: boolean;
  /** Inspect Clack's own open PRs for continue/self-review work. */
  ownPrs: boolean;
  /** Scan recently-updated core memory entries for untriaged work during sync. */
  scanMemory: boolean;
}

export interface IdlerConfig {
  enabled: boolean;
  /** When the idler works — it fires INSIDE this window. */
  workHours: IdlerWindow;
  /** When sync (ledger priming) runs. Absent ⇒ the complement of `workHours`. */
  syncHours?: IdlerWindow;
  /**
   * Sync cadence in hours within its window (1 = every hour). Thinning walks backwards from the
   * hour just before the work window opens, so the ledger-priming handoff fire is always kept.
   */
  syncEveryHours: number;
  /**
   * Minutes between work-task fires inside `workHours` (default 30). Must be a divisor of 60 in
   * [5, 60] so the cron minute field tiles each hour evenly. Fewer fires ⇒ lower nightly token cost.
   */
  workEveryMinutes: number;
  /** Repos the idler may act on. Empty ⇒ the plugin does nothing (safety default). */
  repoAllowlist: string[];
  /** What and where the idler reports. Absent `channel` ⇒ idler dormant. */
  reporting: IdlerReporting;
  /** Cap on code-changing actions per single work fire. */
  maxActionsPerFire: number;
  /** Cap on code-changing actions across one work window. */
  maxActionsPerNight: number;
  sources: IdlerSources;
}
