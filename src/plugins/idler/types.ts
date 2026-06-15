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

/** Discovery sources the idler sweeps. Each is gracefully skipped when its MCP is absent. */
export interface IdlerSources {
  /** Slack channel IDs to scan (incl. bot-alert channels like #sentry-alerts). */
  channels: string[];
  /** Poll an external tracker (Asana, Sentry, …) via its MCP, per the fetch instructions. */
  tracker: boolean;
  /** Inspect Clack's own open PRs for continue/self-review work. */
  ownPrs: boolean;
}

export interface IdlerConfig {
  enabled: boolean;
  /** When the idler works — it fires INSIDE this window. */
  workHours: IdlerWindow;
  /** When sync (ledger priming) runs. Absent ⇒ the complement of `workHours`. */
  syncHours?: IdlerWindow;
  /** Repos the idler may act on. Empty ⇒ the plugin does nothing (safety default). */
  repoAllowlist: string[];
  /** Absent ⇒ no summary task is reconciled. */
  reportingChannel?: string;
  /** Hour [0..23] the morning digest fires. Absent ⇒ 9 (AM). */
  summaryHour?: number;
  /** Cap on code-changing actions per single work fire. */
  maxActionsPerFire: number;
  /** Cap on code-changing actions across one work window. */
  maxActionsPerNight: number;
  sources: IdlerSources;
}
