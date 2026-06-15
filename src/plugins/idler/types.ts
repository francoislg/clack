/** The window during which Clack is "at work". The idler fires only OUTSIDE this window. */
export interface IdlerActiveHours {
  /** Inclusive start hour [0..23]. */
  start: number;
  /** Exclusive end hour [1..24]. */
  end: number;
  tz: string;
  /** Days [0..6] (0 = Sunday) the active window applies; off-days are fully idler-eligible. */
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
  activeHours: IdlerActiveHours;
  /** Repos the idler may act on. Empty ⇒ the plugin does nothing (safety default). */
  repoAllowlist: string[];
  /** Absent ⇒ no summary task is reconciled. */
  reportingChannel?: string;
  /** Cap on code-changing actions per single work fire. */
  maxActionsPerFire: number;
  /** Cap on code-changing actions across one off-hours window. */
  maxActionsPerNight: number;
  sources: IdlerSources;
}
