import type { View, KnownBlock, Block } from "@slack/types";
import { getConfig } from "../config.js";
import { getConfiguredMcpServerNames, resolveEffectiveRegistry } from "../mcp.js";
import { getFailedMcpServers } from "../mcpStatus.js";
import { loadRoles, getRole, hasOwner, type UserRole } from "../roles.js";
import { canEditConfig, canManageRoles, canRequestChanges } from "../permissions.js";
import { getActiveWorkers } from "../changes/activeState.js";
import { getWorkerPoolSnapshot, type WorkerPoolSnapshot } from "../workers/index.js";
import { getActiveTesterRuns, type ActiveTesterRun } from "../tester/concurrency.js";
import { listInstructionFiles } from "../configurationFiles.js";
import { getReactionDelivery, getUserPreference } from "../userPreferences.js";
import { getVisibleRepos, canWriteRepo } from "../repoAccess.js";
import { getMigrationErrors } from "../migrations/admin.js";
import { discoverSkillPluginInfo } from "../skillPlugins.js";
import { type UserSkill } from "../userSkills.js";
import { buildUserSkillsSection } from "./userSkillsHomeTab.js";
import { getRules, type AutoRespondRule } from "../autoRespond.js";
import { isEphemeralRule } from "../ephemeralRules.js";
import { formatElapsedSeconds } from "../claude/preAnalysis.js";
import { getJobs, getJobsByUser, type CronJob } from "../cronJobs.js";
import {
  getQuarantineStores,
  type QuarantineStoreDescriptor,
} from "../state/stateQuarantineRegistry.js";
import type { QuarantineEntry } from "../state/resilientCollection.js";
import { humanReadableSchedule } from "../cronFormatter.js";
import { readUsageLimits, type UsageLimitsState, type UsageLimitWindow } from "../usageLimits.js";
import { getSlackClient } from "./app.js";
import { getUserInfo } from "./userCache.js";
import { truncate } from "../text.js";
import { t } from "../i18n/t.js";
import type { ActiveWorker } from "../changes/activeState.js";
import type { InstructionFileListing } from "../configurationFiles.js";
import type { Config, RepositoryConfig } from "../config.js";
import type { SkillPluginInfo } from "../skillPlugins.js";
import type { MigrationError } from "../migrations/types.js";
import { getLoadedPlugins, getLoadedPluginIntegrations } from "../plugins-core/state.js";
import { getInvestigationsChannel, listOpenInvestigations } from "../investigations/state.js";
import type { InvestigationSummary } from "../investigations/types.js";

export interface ClackPluginSummary {
  name: string;
  toolCount: number;
  /** Load-time errors recorded via `sdk.error` or thrown during init. Empty when healthy. */
  errors: string[];
}
import type { RolesConfig } from "../roles.js";
import type { UserPreferences } from "../userPreferences.js";

// ============================================================================
// Dependency Injection
// ============================================================================

export interface HomeTabDeps {
  getConfig: () => Config;
  getConfiguredMcpServerNames: () => string[];
  getFailedMcpServers: () => Set<string>;
  getRole: (userId: string) => Promise<UserRole>;
  hasOwner: () => Promise<boolean>;
  loadRoles: () => Promise<RolesConfig>;
  canEditConfig: (role: UserRole) => boolean;
  canManageRoles: (role: UserRole) => boolean;
  canRequestChanges: (role: UserRole) => boolean;
  getActiveWorkers: () => ActiveWorker[];
  getWorkerPoolSnapshot: () => WorkerPoolSnapshot;
  getActiveTesterRuns: () => ActiveTesterRun[];
  listInstructionFiles: () => InstructionFileListing;
  getReactionDelivery: (userId: string) => Promise<string>;
  getUserPreference: <K extends keyof UserPreferences>(
    userId: string,
    key: K,
  ) => Promise<UserPreferences[K]>;
  getVisibleRepos: (role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[];
  canWriteRepo: (role: UserRole, repo: RepositoryConfig) => boolean;
  getMigrationErrors: () => MigrationError[];
  discoverSkillPluginInfo: () => SkillPluginInfo[];
  getLoadedClackPlugins: () => ClackPluginSummary[];
  getRules: () => Promise<AutoRespondRule[]>;
  getJobs: () => Promise<CronJob[]>;
  getJobsByUser: (userId: string) => Promise<CronJob[]>;
  getUserTimezone: (userId: string) => Promise<string | undefined>;
  humanReadableSchedule: (
    cronExpression: string,
    timezone: string,
    viewerTimezone?: string,
  ) => string;
  getUsageLimits: () => Promise<UsageLimitsState>;
  getInvestigationsChannel: () => string | null;
  listOpenInvestigations: () => InvestigationSummary[];
}

export const defaultHomeTabDeps: HomeTabDeps = {
  getConfig,
  getConfiguredMcpServerNames,
  getFailedMcpServers,
  getRole,
  hasOwner,
  loadRoles,
  canEditConfig,
  canManageRoles,
  canRequestChanges,
  getActiveWorkers,
  getWorkerPoolSnapshot,
  getActiveTesterRuns,
  listInstructionFiles,
  getReactionDelivery,
  getUserPreference,
  getVisibleRepos,
  canWriteRepo,
  getMigrationErrors,
  discoverSkillPluginInfo,
  getLoadedClackPlugins: () =>
    getLoadedPlugins().results.map((r) => ({
      name: r.name,
      toolCount: r.tools.length,
      errors: r.errors,
    })),
  getRules,
  getJobs,
  getJobsByUser,
  getUserTimezone: async (userId) => {
    const client = getSlackClient();
    if (!client) return undefined;
    return (await getUserInfo(client, userId))?.tz;
  },
  humanReadableSchedule,
  getUsageLimits: readUsageLimits,
  getInvestigationsChannel,
  listOpenInvestigations,
};

interface HomeViewOptions {
  userId: string;
  ownerDisabled?: boolean;
}

export async function buildHomeView(
  options: HomeViewOptions,
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<View> {
  const { userId, ownerDisabled } = options;
  const role = await deps.getRole(userId);
  const userIsAdmin = deps.canManageRoles(role);
  const userCanEdit = deps.canEditConfig(role);
  const userIsDev = deps.canRequestChanges(role);
  const hasAnOwner = await deps.hasOwner();

  const blocks: (KnownBlock | Block)[] = [];

  // Migration error banner (shown to all, extra guidance for admins)
  const migrationErrors = deps.getMigrationErrors();
  if (migrationErrors.length > 0) {
    blocks.push(...buildMigrationBanner(migrationErrors, userIsAdmin));
  }

  // Role badge (only for assigned users)
  if (role !== "member") {
    blocks.push(...buildRoleBadge(role));
  }

  // Claim ownership section (if no owner or owner is disabled)
  if (!hasAnOwner) {
    blocks.push(...buildClaimOwnershipSection(false));
  } else if (ownerDisabled && userIsAdmin) {
    blocks.push(...buildClaimOwnershipSection(true));
  }

  // Quarantined schedules + freeze banner (admin only; renders only when something needs recovery)
  if (userIsAdmin) {
    blocks.push(...(await buildStateQuarantineSection()));
  }

  // Role, investigations, auto-respond, scheduled-messages, skills, plugins, and MCP servers
  // are reached through buttons in the Configuration section and rendered as modals, keeping
  // the Home view under Slack's 100-block ceiling. Feature gating is resolved from config
  // (guarded against an unloaded config — tests rarely call loadConfig before buildHomeView).
  let userSkillsEnabled = false;
  let userSchedulesEnabled = false;
  let investigationsEnabled = false;
  try {
    const config = getConfig();
    userSkillsEnabled = config.userSkills?.enabled === true;
    userSchedulesEnabled = config.cron?.userSchedules === true;
    investigationsEnabled = config.investigations?.enabled === true;
  } catch {
    // Config not loaded — features off.
  }

  // Configuration & preferences section (config editing for admins, preferences for all)
  blocks.push(
    ...buildConfigurationSection(
      {
        showEditButtons: userCanEdit,
        showRolesButton: userIsAdmin,
        showInvestigationsButton: userIsAdmin && investigationsEnabled,
        showAutoRespondButton: userIsAdmin,
        showSchedulesButton: userIsAdmin || userSchedulesEnabled,
        showSkillsButton: userSkillsEnabled,
        showPluginsButton: true,
        showMcpButton: true,
        showStatusButton: true,
      },
      deps,
    ),
  );

  // Workers section — unified view of active changes (disposable mode) or
  // the physical worker pool (reusable mode). Visible to devs and higher;
  // quarantine-clear buttons are admin-gated server-side.
  if (userIsDev) {
    blocks.push(...buildWorkersSection(deps));
  }

  // Help section (visible to all)
  blocks.push(...buildHelpSection(deps));

  // Usage limits section (admin only), at the bottom
  if (userIsAdmin) {
    blocks.push(...(await buildUsageLimitsSection(deps)));
  }

  // Spacer to prevent Slack client from cutting off the last block
  // (known Slack bug: bottom UI chrome clips the last blocks of App Home views)
  blocks.push({ type: "divider" });
  for (let i = 0; i < 4; i++) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: " " }],
    });
  }

  return {
    type: "home",
    blocks,
  };
}

function buildMigrationBanner(errors: MigrationError[], isAdmin: boolean): KnownBlock[] {
  const errorList = errors
    .map((e) =>
      t("home.migration.entry", { name: e.migrationName, version: e.version, error: e.error }),
    )
    .join("\n");

  let text = `${t("home.migration.title")}\n\n${errorList}`;

  if (isAdmin) {
    text += `\n\n${t("home.migration.admin_hint")}`;
  }

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text,
      },
    },
    { type: "divider" },
  ];
}

function buildRoleBadge(role: UserRole): KnownBlock[] {
  // "system" never appears here — Home Tab is only rendered for human users.
  const roleLabels: Record<UserRole, string> = {
    system: t("home.role.system"),
    owner: t("home.role.owner"),
    admin: t("home.role.admin"),
    dev: t("home.role.dev"),
    member: t("home.role.member"),
  };

  const roleEmojis: Record<UserRole, string> = {
    system: ":robot_face:",
    owner: ":crown:",
    admin: ":shield:",
    dev: ":computer:",
    member: ":bust_in_silhouette:",
  };

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("home.role.badge", { emoji: roleEmojis[role], label: roleLabels[role] }),
      },
    },
    { type: "divider" },
  ];
}

function buildClaimOwnershipSection(ownerDisabled: boolean): KnownBlock[] {
  const message = ownerDisabled ? t("home.ownership.disabled_owner") : t("home.ownership.no_owner");

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: message,
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: t("home.ownership.claim_button"),
          emoji: true,
        },
        style: "primary",
        action_id: "claim_ownership",
      },
    },
    { type: "divider" },
  ];
}

export async function buildRoleManagementSection(
  role: UserRole,
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<KnownBlock[]> {
  const roles = await deps.loadRoles();
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: t("home.roles.header"),
      emoji: true,
    },
  });

  // Owner section
  if (roles.owner) {
    const ownerSection: KnownBlock = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("home.roles.owner_line", { mention: `<@${roles.owner}>` }),
      },
    };

    // Only owner can transfer ownership
    if (role === "owner") {
      ownerSection.accessory = {
        type: "button",
        text: {
          type: "plain_text",
          text: t("home.roles.transfer_button"),
          emoji: true,
        },
        action_id: "transfer_ownership",
      };
    }

    blocks.push(ownerSection);
  }

  // Admins section
  const adminList =
    roles.admins.length > 0 ? roles.admins.map((id) => `<@${id}>`).join(", ") : t("common.none");

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: t("home.roles.admins_line", { list: adminList }),
    },
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: t("home.roles.add_admin"),
          emoji: true,
        },
        action_id: "add_admin",
      },
      ...(roles.admins.length > 0
        ? [
            {
              type: "button" as const,
              text: {
                type: "plain_text" as const,
                text: t("home.roles.remove_admin"),
                emoji: true,
              },
              action_id: "remove_admin",
            },
          ]
        : []),
    ],
  });

  // Devs section
  const devList =
    roles.devs.length > 0 ? roles.devs.map((id) => `<@${id}>`).join(", ") : t("common.none");

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: t("home.roles.devs_line", { list: devList }),
    },
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: t("home.roles.add_dev"),
          emoji: true,
        },
        action_id: "add_dev",
      },
      ...(roles.devs.length > 0
        ? [
            {
              type: "button" as const,
              text: {
                type: "plain_text" as const,
                text: t("home.roles.remove_dev"),
                emoji: true,
              },
              action_id: "remove_dev",
            },
          ]
        : []),
    ],
  });

  blocks.push({ type: "divider" });

  return blocks;
}

const roleEmojis: Record<string, string> = {
  user: ":bust_in_silhouette:",
  dev: ":hammer_and_wrench:",
  admin: ":shield:",
  "pre-analysis": ":brain:",
};

export interface ConfigurationSectionOptions {
  /** Config-file + repo edit buttons (admin/config-editor only). */
  showEditButtons: boolean;
  /** "See roles" button → Role Management modal. */
  showRolesButton: boolean;
  /** "See investigations" button → Investigations modal. */
  showInvestigationsButton: boolean;
  /** "See auto-responses" button → Auto-Respond modal. */
  showAutoRespondButton: boolean;
  /** "See schedules" button → Scheduled Messages modal. */
  showSchedulesButton: boolean;
  /** "See skills" button → Skills modal. */
  showSkillsButton: boolean;
  /** "Plugins" button → Plugins modal. */
  showPluginsButton: boolean;
  /** "MCP Servers" button → MCP Servers modal. */
  showMcpButton: boolean;
  /** "Status" button → Status modal (repositories + trigger methods). */
  showStatusButton: boolean;
}

function groupHeader(text: string): KnownBlock {
  return { type: "header", text: { type: "plain_text", text, emoji: true } };
}

function featureButton(text: string, actionId: string): object {
  return {
    type: "button",
    text: { type: "plain_text", text, emoji: true },
    action_id: actionId,
  };
}

export function buildConfigurationSection(
  opts: ConfigurationSectionOptions,
  deps: HomeTabDeps = defaultHomeTabDeps,
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // ── Instructions (role config + pre-analysis) and Repositories ──────────────
  const configButtons: object[] = [];
  const repoButtons: object[] = [];

  if (opts.showEditButtons) {
    const listing = deps.listInstructionFiles();

    for (const roleEntry of listing.roles) {
      const roleName = roleEntry.role.charAt(0).toUpperCase() + roleEntry.role.slice(1);
      const roleLabel = `${roleName} ${t("home.config.role_suffix")}`;
      const emoji = roleEmojis[roleEntry.role] ?? "";
      const label = t("home.config.edit_role_button", {
        prefix: emoji ? `${emoji} ` : "",
        label: roleLabel,
      });
      configButtons.push({
        type: "button",
        text: { type: "plain_text", text: label, emoji: true },
        action_id: `view_config_dir:${roleEntry.role}`,
        value: roleEntry.role,
      });
    }

    // Pre-analysis context — distinct top-level field, rendered as its own button
    const preAnalysisEmoji = roleEmojis["pre-analysis"] ?? "";
    const preAnalysisLabel = t("home.config.edit_pre_analysis_button", {
      prefix: preAnalysisEmoji ? `${preAnalysisEmoji} ` : "",
    });
    configButtons.push({
      type: "button",
      text: { type: "plain_text", text: preAnalysisLabel, emoji: true },
      action_id: `view_config_dir:pre-analysis`,
      value: "pre-analysis",
    });

    // Repo directories
    for (const repoEntry of listing.repos) {
      repoButtons.push({
        type: "button",
        text: {
          type: "plain_text",
          text: t("home.config.edit_repo_button", { repo: repoEntry.repo }),
          emoji: true,
        },
        action_id: `view_config_dir:${repoEntry.repo}`,
        value: repoEntry.repo,
      });
    }
  }

  if (configButtons.length > 0) {
    blocks.push(groupHeader(t("home.config.group_instructions")));
    blocks.push({ type: "actions", elements: configButtons } as KnownBlock);
  }
  if (repoButtons.length > 0) {
    blocks.push(groupHeader(t("home.config.group_repositories")));
    blocks.push({ type: "actions", elements: repoButtons } as KnownBlock);
  }

  // ── Clack Features — each button opens the section as a modal ──────────────
  const featureButtons: object[] = [];
  if (opts.showRolesButton) {
    featureButtons.push(featureButton(t("home.config.see_roles_button"), "home_open_roles"));
  }
  if (opts.showInvestigationsButton) {
    featureButtons.push(
      featureButton(t("home.config.see_investigations_button"), "home_open_investigations"),
    );
  }
  if (opts.showAutoRespondButton) {
    featureButtons.push(
      featureButton(t("home.config.see_auto_responses_button"), "home_open_auto_respond"),
    );
  }
  if (opts.showSchedulesButton) {
    featureButtons.push(
      featureButton(t("home.config.see_schedules_button"), "home_open_schedules"),
    );
  }
  if (opts.showSkillsButton) {
    featureButtons.push(featureButton(t("home.config.see_skills_button"), "home_open_skills"));
  }
  if (opts.showPluginsButton) {
    featureButtons.push(featureButton(t("home.config.see_plugins_button"), "home_open_plugins"));
  }
  if (opts.showMcpButton) {
    featureButtons.push(featureButton(t("home.config.see_mcp_button"), "home_open_mcp"));
  }
  if (opts.showStatusButton) {
    featureButtons.push(featureButton(t("home.config.see_status_button"), "home_open_status"));
  }
  if (featureButtons.length > 0) {
    blocks.push(groupHeader(t("home.config.group_features")));
    blocks.push({ type: "actions", elements: featureButtons } as KnownBlock);
  }

  // ── Personal ───────────────────────────────────────────────────────────────
  blocks.push(groupHeader(t("home.config.group_personal")));
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: t("home.config.personal_preferences_button"),
          emoji: true,
        },
        action_id: "open_settings",
      },
    ],
  } as KnownBlock);

  if (opts.showEditButtons) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: t("home.config.chat_hint"),
        },
      ],
    });
  }

  blocks.push({ type: "divider" });

  return blocks;
}

const WORKER_STATUS_EMOJI: Record<string, string> = {
  // Pool worker states (reusable mode)
  idle: ":large_green_circle:",
  busy: ":hammer_and_wrench:",
  initializing: ":hourglass_flowing_sand:",
  quarantined: ":warning:",
  failed: ":x:",
  // Active change states (disposable mode + busy reusable)
  planning: ":thinking_face:",
  executing: ":hammer_and_wrench:",
  reviewing: ":eyes:",
  merging: ":rocket:",
  pr_created: ":white_check_mark:",
  cancelled: ":no_entry_sign:",
};

function emojiFor(status: string): string {
  return WORKER_STATUS_EMOJI[status] ?? ":hourglass:";
}

function slackDate(d: Date): string {
  return `<!date^${Math.floor(d.getTime() / 1000)}^{date_short_pretty} at {time}|${d.toISOString()}>`;
}

// A reading whose `observedAt` is older than this is flagged "may be outdated".
const USAGE_STALE_AFTER_MS = 30 * 60 * 1000;

// Render order for the usage panel; any window type not listed follows, sorted, with a fallback label.
const USAGE_WINDOW_ORDER: readonly string[] = [
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "overage",
];

function usageWindowLabel(type: string): string {
  switch (type) {
    case "five_hour":
      return t("home.usage.window_five_hour");
    case "seven_day":
      return t("home.usage.window_seven_day");
    case "seven_day_opus":
      return t("home.usage.window_seven_day_opus");
    case "seven_day_sonnet":
      return t("home.usage.window_seven_day_sonnet");
    case "overage":
      return t("home.usage.window_overage");
    default:
      return t("home.usage.window_unknown", { type });
  }
}

function orderedUsageWindowTypes(state: UsageLimitsState): string[] {
  const present = Object.keys(state);
  const known = USAGE_WINDOW_ORDER.filter((type) => present.includes(type));
  const unknown = present.filter((type) => !USAGE_WINDOW_ORDER.includes(type)).sort();
  return [...known, ...unknown];
}

function usageRowText(type: string, window: UsageLimitWindow, now: number): string {
  const segments: string[] = [];

  if (typeof window.utilization === "number") {
    const percent = Math.round(Math.max(0, Math.min(1, window.utilization)) * 100);
    segments.push(t("home.usage.percent", { percent }));
  } else {
    segments.push(t("home.usage.percent_unavailable"));
  }

  if (typeof window.resetsAt === "number") {
    segments.push(
      t("home.usage.resets", { resetTime: slackDate(new Date(window.resetsAt * 1000)) }),
    );
  }

  // observedAt may be absent on partial/legacy state — then we show no "as of" note at all.
  if (typeof window.observedAt === "number") {
    const asOf = t("home.usage.as_of", { observedTime: slackDate(new Date(window.observedAt)) });
    const stale =
      now - window.observedAt > USAGE_STALE_AFTER_MS ? ` · _${t("home.usage.stale")}_` : "";
    segments.push(`${asOf}${stale}`);
  }

  return `• *${usageWindowLabel(type)}* — ${segments.join(" · ")}`;
}

/**
 * Admin-only panel reflecting the latest Claude subscription rate-limit snapshot. The data only
 * refreshes when a Claude run streams a rate_limit_event, so this is a point-in-time reading —
 * the intro copy and the per-row "as of" note make that explicit.
 */
async function buildUsageLimitsSection(deps: HomeTabDeps): Promise<KnownBlock[]> {
  const state = await deps.getUsageLimits();
  const now = Date.now();

  const blocks: KnownBlock[] = [
    { type: "divider" },
    {
      type: "header",
      text: { type: "plain_text", text: t("home.usage.header"), emoji: true },
    },
    { type: "context", elements: [{ type: "mrkdwn", text: t("home.usage.intro") }] },
  ];

  const types = orderedUsageWindowTypes(state);
  if (types.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: t("home.usage.empty") } });
    return blocks;
  }

  const lines = types.map((type) => usageRowText(type, state[type], now));
  blocks.push({ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } });
  return blocks;
}

/**
 * Unified "Workers" section — shows physical pool state AND active change
 * sessions in one place.
 *
 * Disposable mode: one row per active change request (description, status,
 * branch, repo, requester, thread link, PR if any). This is the legacy view.
 *
 * Reusable mode: per repo, a counts header followed by one row per worker
 * with id, status, branch, last-used time, claimant session (if busy), and a
 * "Discard & restore" button when quarantined. A trailing context block per
 * queued request shows who's waiting. Visible to all devs, but quarantine
 * buttons are admin-gated server-side.
 */
export function buildWorkersSection(deps: HomeTabDeps = defaultHomeTabDeps): KnownBlock[] {
  const snapshot = deps.getWorkerPoolSnapshot();
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("home.workers.header"), emoji: true },
  });

  // Active tester runs get a context line (e.g. "1 testing — my-repo `feature/x`") in
  // both pool modes, so an in-flight QA session is visible at a glance.
  const testerRuns = deps.getActiveTesterRuns();
  if (testerRuns.length > 0) {
    const details = testerRuns.map((run) => `${run.repo} \`${run.branch}\``).join(", ");
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🎬 ${t("homeTab.workers.testing_count", { count: testerRuns.length })} — ${details}`,
        },
      ],
    });
  }

  if (!snapshot.reusable) {
    // Disposable mode — list active change sessions.
    const activeChanges = deps.getActiveWorkers();
    if (activeChanges.length === 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: t("home.workers.no_active_changes") },
      });
      blocks.push({ type: "divider" });
      return blocks;
    }
    for (const w of activeChanges) {
      const statusLabel = w.status.charAt(0).toUpperCase() + w.status.slice(1);
      const threadLink = `https://slack.com/archives/${w.channel}/p${w.threadTs.replace(".", "")}`;
      let text = `${emojiFor(w.status)} *${w.description}*\n`;
      text += `${t("home.workers.status_line", { label: statusLabel })}\n`;
      text += `${t("home.workers.branch_line", { branch: w.branch })}\n`;
      text += `${t("home.workers.repo_line", { repo: w.repo })}\n`;
      const byLabel =
        w.userId === "auto-respond" ? t("home.workers.auto_respond_label") : `<@${w.userId}>`;
      text += `${t("home.workers.by_line", { by: byLabel })}\n`;
      text += t("home.workers.thread_line", { url: threadLink });
      if (w.prUrl) text += t("home.workers.pr_line", { url: w.prUrl });
      blocks.push({ type: "section", text: { type: "mrkdwn", text } });
    }
    blocks.push({ type: "divider" });
    return blocks;
  }

  // Reusable mode.
  if (snapshot.byRepo.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("home.workers.no_workers_yet"),
      },
    });
    blocks.push({ type: "divider" });
    return blocks;
  }

  for (const repo of snapshot.byRepo) {
    const counts = t("home.workers.counts", {
      idle: repo.idle,
      busy: repo.busy,
      init: repo.initializing,
      quar: repo.quarantined,
      failed: repo.failed,
      queued: repo.queueDepth,
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${repo.repo}*\n${counts}` },
    });

    if (repo.workers.length === 0) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: t("home.workers.no_workers_for_repo"),
          },
        ],
      });
    }

    for (const w of repo.workers) {
      const branchLabel = w.currentBranch ?? t("home.workers.detached");
      const claimedLine = w.claimedBy ? t("home.workers.session_suffix", { id: w.claimedBy }) : "";
      const setupLine = w.setupComplete ? "" : t("home.workers.setup_incomplete_suffix");
      const text = t("home.workers.worker_line", {
        emoji: emojiFor(w.status),
        id: w.id,
        status: w.status,
        branch: branchLabel,
        claimed: claimedLine,
        setup: setupLine,
        when: slackDate(w.lastUsedAt),
      });

      if (w.status === "quarantined") {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text },
          accessory: {
            type: "button",
            style: "danger",
            text: { type: "plain_text", text: t("home.workers.discard_restore"), emoji: true },
            action_id: "clack_clear_quarantine",
            value: `${repo.repo}/${w.id}`,
            confirm: {
              title: { type: "plain_text", text: t("home.workers.discard_title") },
              text: {
                type: "mrkdwn",
                text: t("home.workers.discard_text", { id: w.id }),
              },
              confirm: { type: "plain_text", text: t("home.workers.discard_confirm") },
              deny: { type: "plain_text", text: t("common.cancel") },
            },
          },
        });
      } else {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text }],
        });
      }
    }

    for (const q of repo.queued) {
      const when = `<!date^${Math.floor(q.enqueuedAt.getTime() / 1000)}^{time}|${q.enqueuedAt.toISOString()}>`;
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: t("home.workers.queued_entry", {
              branch: q.branch,
              session: q.sessionId,
              when,
            }),
          },
        ],
      });
    }
  }

  blocks.push({ type: "divider" });
  return blocks;
}

export function buildHelpSection(deps: HomeTabDeps = defaultHomeTabDeps): KnownBlock[] {
  const config = deps.getConfig();

  const triggerInstructions: string[] = [];

  triggerInstructions.push(t("home.help.reaction", { emoji: config.reactions.trigger }));

  if (config.directMessages.enabled) {
    triggerInstructions.push(t("home.help.dm"));
  }

  if (config.mentions.enabled) {
    triggerInstructions.push(t("home.help.mention"));
  }

  if (config.reactions.stop) {
    triggerInstructions.push(t("home.help.stop", { emoji: config.reactions.stop }));
  }

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: t("home.help.header"),
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("home.help.how_to_use"),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: triggerInstructions.join("\n"),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: t("home.help.context"),
        },
      ],
    },
  ];
}

// Settings section and modal

export async function buildSettingsModal(
  userId: string,
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<View> {
  const delivery = await deps.getReactionDelivery(userId);
  const notifyOnResponse = await deps.getUserPreference(userId, "notifyOnResponse");

  const dmOption = {
    text: { type: "plain_text" as const, text: t("home.settings.delivery_dm_label") },
    description: {
      type: "plain_text" as const,
      text: t("home.settings.delivery_dm_description"),
    },
    value: "dm",
  };
  const threadOption = {
    text: { type: "plain_text" as const, text: t("home.settings.delivery_thread_label") },
    description: {
      type: "plain_text" as const,
      text: t("home.settings.delivery_thread_description"),
    },
    value: "thread",
  };

  const notifyOnOption = {
    text: { type: "plain_text" as const, text: t("home.settings.notify_on_label") },
    description: {
      type: "plain_text" as const,
      text: t("home.settings.notify_on_description"),
    },
    value: "true",
  };
  const notifyOffOption = {
    text: { type: "plain_text" as const, text: t("home.settings.notify_off_label") },
    description: {
      type: "plain_text" as const,
      text: t("home.settings.notify_off_description"),
    },
    value: "false",
  };

  return {
    type: "modal",
    callback_id: "settings_modal",
    title: {
      type: "plain_text",
      text: t("home.settings.title"),
    },
    submit: {
      type: "plain_text",
      text: t("common.save"),
    },
    close: {
      type: "plain_text",
      text: t("common.cancel"),
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("home.settings.delivery_label"),
        },
      },
      {
        type: "actions",
        block_id: "response_delivery_block",
        elements: [
          {
            type: "radio_buttons",
            action_id: "response_delivery",
            initial_option: delivery === "dm" ? dmOption : threadOption,
            options: [dmOption, threadOption],
          },
        ],
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("home.settings.notify_label"),
        },
      },
      {
        type: "actions",
        block_id: "notify_on_response_block",
        elements: [
          {
            type: "radio_buttons",
            action_id: "notify_on_response",
            initial_option: notifyOnResponse ? notifyOnOption : notifyOffOption,
            options: [notifyOnOption, notifyOffOption],
          },
        ],
      },
    ],
  };
}

// Modal builders for user selection

export function buildUserSelectModal(title: string, actionId: string, placeholder: string): View {
  return {
    type: "modal",
    callback_id: actionId,
    title: {
      type: "plain_text",
      text: title,
    },
    submit: {
      type: "plain_text",
      text: t("common.submit"),
    },
    close: {
      type: "plain_text",
      text: t("common.cancel"),
    },
    blocks: [
      {
        type: "input",
        block_id: "user_select_block",
        element: {
          type: "users_select",
          action_id: "selected_user",
          placeholder: {
            type: "plain_text",
            text: placeholder,
          },
        },
        label: {
          type: "plain_text",
          text: t("home.user_select.label"),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Config file picker modal
// ---------------------------------------------------------------------------

const MAX_MODAL_CONTENT_LENGTH = 3000;

export interface ConfigFilePickerEntry {
  filename: string;
  sourceLabel: string; // "", "Customized", "Custom"
  effectiveLength: number;
}

export function buildConfigFilePickerModal(
  dir: string,
  files: ConfigFilePickerEntry[],
  isRepoDir: boolean,
): View {
  const blocks: KnownBlock[] = [];

  for (const file of files) {
    const tooLarge = file.effectiveLength > MAX_MODAL_CONTENT_LENGTH;
    const label = file.sourceLabel ? ` — _${file.sourceLabel}_` : "";

    if (tooLarge) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `\`${file.filename}\`${label}\n${t("home.config.too_large")}`,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: t("home.config.chat_to_edit"),
          },
          action_id: "chat_edit_config_file",
          value: `${dir}/${file.filename}`,
        },
      });
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `\`${file.filename}\`${label}`,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: t("common.edit"),
          },
          action_id: "edit_config_file",
          value: `${dir}/${file.filename}`,
        },
      });
    }
  }

  if (!isRepoDir) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: t("home.config.create_new_file"),
          },
          action_id: "create_config_file",
          value: dir,
        },
      ],
    });
  }

  const titleText = t("home.config.instructions_title", { dir });
  const truncatedTitle = truncate(titleText, 24);

  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: truncatedTitle,
    },
    close: {
      type: "plain_text",
      text: t("common.close"),
    },
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Config file editor modal
// ---------------------------------------------------------------------------

export type ConfigFileState = "default-only" | "has-override" | "custom-only";

interface EditorMetadata {
  dir: string;
  filename: string;
  hasDefault: boolean;
  hasOverride: boolean;
}

export function buildConfigEditorModal(
  dir: string,
  filename: string,
  content: string,
  fileState: ConfigFileState,
): View {
  const blocks: KnownBlock[] = [];

  // Status line
  if (fileState === "default-only") {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: t("home.config.default_only") }],
    });
  }

  // Content textarea
  blocks.push({
    type: "input",
    block_id: "content_block",
    element: {
      type: "plain_text_input",
      action_id: "file_content",
      multiline: true,
      initial_value: content,
    },
    label: {
      type: "plain_text",
      text: t("home.config.content_label"),
    },
  });

  // Action buttons row
  const actionElements: object[] = [
    {
      type: "button",
      text: { type: "plain_text", text: t("home.config.chat_to_edit") },
      action_id: "chat_edit_config_file",
      value: `${dir}/${filename}`,
    },
  ];

  if (fileState === "has-override") {
    actionElements.push({
      type: "button",
      text: { type: "plain_text", text: t("home.config.reset_to_default") },
      style: "danger",
      action_id: "delete_config_file",
      value: `${dir}/${filename}`,
    });
  } else if (fileState === "custom-only") {
    actionElements.push({
      type: "button",
      text: { type: "plain_text", text: t("home.config.delete_file") },
      style: "danger",
      action_id: "delete_config_file",
      value: `${dir}/${filename}`,
    });
  }

  blocks.push({ type: "actions", elements: actionElements } as KnownBlock);

  const submitLabel =
    fileState === "default-only" ? t("home.config.create_override") : t("common.save");

  const metadata: EditorMetadata = {
    dir,
    filename,
    hasDefault: fileState === "default-only" || fileState === "has-override",
    hasOverride: fileState === "has-override",
  };

  // Title truncation (24 char limit)
  const titleText = `${dir}/${filename}`;
  const truncatedTitle = truncate(titleText, 24);

  return {
    type: "modal",
    callback_id: "config_editor_modal",
    title: {
      type: "plain_text",
      text: truncatedTitle,
    },
    submit: {
      type: "plain_text",
      text: submitLabel,
    },
    close: {
      type: "plain_text",
      text: t("common.back"),
    },
    private_metadata: JSON.stringify(metadata),
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Config create file modal
// ---------------------------------------------------------------------------

export function buildConfigCreateFileModal(dir: string): View {
  return {
    type: "modal",
    callback_id: "config_create_modal",
    title: {
      type: "plain_text",
      text: t("home.config.create_new_file_title"),
    },
    submit: {
      type: "plain_text",
      text: t("common.create"),
    },
    close: {
      type: "plain_text",
      text: t("common.back"),
    },
    private_metadata: JSON.stringify({ dir }),
    blocks: [
      {
        type: "input",
        block_id: "filename_block",
        element: {
          type: "plain_text_input",
          action_id: "filename",
          placeholder: {
            type: "plain_text",
            text: t("home.config.filename_placeholder"),
          },
        },
        label: {
          type: "plain_text",
          text: t("home.config.filename_label"),
        },
        hint: {
          type: "plain_text",
          text: t("home.config.filename_hint"),
        },
      },
      {
        type: "input",
        block_id: "content_block",
        element: {
          type: "plain_text_input",
          action_id: "file_content",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: t("home.config.content_placeholder"),
          },
        },
        label: {
          type: "plain_text",
          text: t("home.config.content_label"),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// User select modals (existing)
// ---------------------------------------------------------------------------

export function buildRemoveUserModal(title: string, actionId: string, users: string[]): View {
  const options = users.map((userId) => ({
    text: {
      type: "plain_text" as const,
      text: userId, // Will show as user ID, Slack may not resolve in static select
    },
    value: userId,
  }));

  return {
    type: "modal",
    callback_id: actionId,
    title: {
      type: "plain_text",
      text: title,
    },
    submit: {
      type: "plain_text",
      text: t("common.remove"),
    },
    close: {
      type: "plain_text",
      text: t("common.cancel"),
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("home.user_remove.prompt"),
        },
      },
      {
        type: "input",
        block_id: "user_select_block",
        element: {
          type: "static_select",
          action_id: "selected_user",
          placeholder: {
            type: "plain_text",
            text: t("home.user_remove.placeholder"),
          },
          options,
        },
        label: {
          type: "plain_text",
          text: t("home.user_remove.label"),
        },
      },
    ],
  };
}

// ============================================================================
// Auto-Respond Section
// ============================================================================

export async function buildAutoRespondSection(
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<(KnownBlock | Block)[]> {
  const blocks: (KnownBlock | Block)[] = [];
  const allRules = await deps.getRules();
  const conversations = allRules.filter(isEphemeralRule);
  const rules = allRules.filter((r) => !isEphemeralRule(r));

  blocks.push({ type: "divider" });
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("home.auto_respond.header") },
  });

  if (conversations.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: t("home.auto_respond.conversations_header") },
    });
    const now = Date.now();
    for (const conversation of conversations) {
      const channel = `<#${conversation.channels[0]}>`;
      const level = t("home.auto_respond.conversation_level", {
        level: conversation.attentionLevel,
      });
      const expiry =
        conversation.expiresAt > now
          ? t("home.auto_respond.conversation_expires", {
              time: formatElapsedSeconds((conversation.expiresAt - now) / 1000),
            })
          : t("home.auto_respond.conversation_dormant");
      const sessions = t("home.auto_respond.conversation_sessions", {
        count: String(conversation.sessionIds.length),
      });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${channel} · ${level} · ${expiry} · ${sessions}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: t("home.auto_respond.stop_following") },
          action_id: `ai_stop_following:${conversation.id}`,
        },
      });
    }
  }

  if (rules.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: t("home.auto_respond.empty") },
    });
  } else {
    for (const rule of rules) {
      const channels = rule.channels.map((c) => `<#${c}>`).join(", ");
      const users = rule.userFilters?.length
        ? ` · ${rule.userFilters.map((u) => `<@${u}>`).join(", ")}`
        : "";
      const keywords = rule.keywords?.length
        ? t("home.auto_respond.keywords_suffix", {
            list: rule.keywords.map((k) => `\`${k}\``).join(", "),
          })
        : "";
      const preAnalysis = rule.preAnalysisContext ? t("home.auto_respond.pre_analysis_suffix") : "";
      const status = rule.enabled ? "" : t("home.auto_respond.paused_suffix");

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${channels}${users}${keywords}${preAnalysis}${status}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: t("common.edit") },
          action_id: `ai_edit_rule:${rule.id}`,
        },
      });
    }
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: t("home.auto_respond.add_rule") },
        action_id: "ai_add_rule",
        style: "primary",
      },
    ],
  });

  return blocks;
}

function buildInvestigationsSection(
  deps: HomeTabDeps = defaultHomeTabDeps,
): (KnownBlock | Block)[] {
  const config = deps.getConfig();
  const isInvestigationsEnabled = config.investigations?.enabled === true;

  if (!isInvestigationsEnabled) {
    return [];
  }

  const blocks: (KnownBlock | Block)[] = [];

  blocks.push({ type: "divider" });
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: t("investigations.home_section_title"),
      emoji: true,
    },
  });

  const channel = deps.getInvestigationsChannel();

  // A section+accessory picker (not an input block) so it dispatches on change inside the
  // modal without needing a submit button. The action fires investigations_select_channel.
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*${t("investigations.home_channel_label")}*` },
    accessory: {
      type: "conversations_select",
      action_id: "investigations_select_channel",
      filter: {
        include: ["public", "private"],
        exclude_bot_users: true,
      },
      placeholder: {
        type: "plain_text",
        text: t("investigations.home_channel_placeholder"),
      },
      ...(channel && { initial_conversation: channel }),
    },
  });

  if (!channel) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: t("investigations.home_unconfigured_warning"),
        },
      ],
    });
  }

  const openInvestigations = deps.listOpenInvestigations();
  if (openInvestigations.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("investigations.home_open_none"),
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Open Investigations*",
      },
    });

    for (const investigation of openInvestigations) {
      const permalink = `https://slack.com/archives/${investigation.mainChannel}/p${investigation.mainThreadTs.replace(".", "")}`;
      const link = `<${permalink}|View Investigation>`;
      const text = t("investigations.home_open_item", {
        link,
        count: String(investigation.followedCount),
        user: `<@${investigation.startedBy}>`,
      });

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: t("investigations.home_close_button"),
          },
          action_id: "investigations_close",
          value: investigation.sessionId,
          style: "danger",
        },
      });
    }
  }

  blocks.push({ type: "divider" });
  return blocks;
}

export function buildAutoRespondModal(rule?: AutoRespondRule): View {
  const isEdit = !!rule;
  const blocks: (KnownBlock | Block)[] = [
    {
      type: "input",
      block_id: "channels_block",
      label: { type: "plain_text", text: t("home.auto_respond.channels_label") },
      element: {
        type: "multi_conversations_select",
        action_id: "channels",
        ...(rule?.channels && { initial_conversations: rule.channels }),
        filter: {
          include: ["public", "private"],
          exclude_bot_users: true,
        },
        placeholder: { type: "plain_text", text: t("home.auto_respond.channels_placeholder") },
      },
    },
    {
      type: "input",
      block_id: "users_block",
      label: { type: "plain_text", text: t("home.auto_respond.users_label") },
      optional: true,
      element: {
        type: "multi_users_select",
        action_id: "users",
        ...(rule?.userFilters && { initial_users: rule.userFilters }),
        placeholder: {
          type: "plain_text",
          text: t("home.auto_respond.users_placeholder"),
        },
      },
    },
    {
      type: "input",
      block_id: "keywords_block",
      label: { type: "plain_text", text: t("home.auto_respond.keywords_label") },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "keywords",
        ...(rule?.keywords && { initial_value: rule.keywords.join(", ") }),
        placeholder: {
          type: "plain_text",
          text: t("home.auto_respond.keywords_placeholder"),
        },
      },
    },
    {
      type: "input",
      block_id: "extra_context_block",
      label: { type: "plain_text", text: t("home.auto_respond.extra_context_label") },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "extra_context",
        multiline: true,
        ...(rule?.extraContext && { initial_value: rule.extraContext }),
        placeholder: {
          type: "plain_text",
          text: t("home.auto_respond.extra_context_placeholder"),
        },
      },
    },
    {
      type: "input",
      block_id: "pre_analysis_block",
      label: { type: "plain_text", text: t("home.auto_respond.pre_analysis_label") },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "pre_analysis_context",
        multiline: true,
        ...(rule?.preAnalysisContext && {
          initial_value: rule.preAnalysisContext,
        }),
        placeholder: {
          type: "plain_text",
          text: t("home.auto_respond.pre_analysis_placeholder"),
        },
      },
      hint: {
        type: "plain_text",
        text: t("home.auto_respond.pre_analysis_hint"),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: t("home.auto_respond.context_hint"),
        },
      ],
    },
  ];

  // Edit mode: add enable/disable and delete actions at the bottom
  if (isEdit && rule) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      block_id: "rule_actions_block",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: rule.enabled
              ? t("home.auto_respond.disable_rule")
              : t("home.auto_respond.enable_rule"),
          },
          action_id: `ai_toggle_rule:${rule.id}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: t("home.auto_respond.delete_rule") },
          action_id: `ai_delete_rule:${rule.id}`,
          style: "danger",
          confirm: {
            title: { type: "plain_text", text: t("home.auto_respond.delete_confirm_title") },
            text: {
              type: "plain_text",
              text: t("home.auto_respond.delete_confirm_text"),
            },
            confirm: { type: "plain_text", text: t("common.delete") },
            deny: { type: "plain_text", text: t("common.cancel") },
            style: "danger",
          },
        },
      ],
    });
  }

  return {
    type: "modal",
    callback_id: isEdit ? "ai_edit_rule_modal" : "ai_add_rule_modal",
    private_metadata: isEdit ? rule.id : "",
    title: {
      type: "plain_text",
      text: isEdit
        ? t("home.auto_respond.modal_title_edit")
        : t("home.auto_respond.modal_title_add"),
    },
    submit: { type: "plain_text", text: t("common.save") },
    close: { type: "plain_text", text: t("common.cancel") },
    blocks,
  };
}

// ============================================================================
// SCHEDULED MESSAGES
// ============================================================================

/**
 * Escape characters that would otherwise break Slack mrkdwn formatting when a user-typed
 * (or plugin-supplied) schedule name is wrapped in bold (`*…*`) on the Home Tab row.
 * Strips: `*` (bold marker), `_` (italic), `~` (strikethrough), `<` and `>` (link/mention
 * brackets), `&` (HTML entity). The 80-char name cap is enforced at the input boundary.
 */
function escapeMrkdwn(value: string): string {
  return value.replace(/[*_~<>&]/g, "");
}

export async function buildScheduledMessagesSection(
  userId: string,
  isAdmin: boolean,
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<(KnownBlock | Block)[]> {
  const allJobs = isAdmin ? await deps.getJobs() : await deps.getJobsByUser(userId);
  // Partition: user-created jobs go in the first section with full controls; plugin-managed
  // jobs go in a separate admin-only section with read-only details + Enable/Disable only.
  // The user-created subsection is also hidden when `config.cron.userSchedules` is false —
  // those jobs are skipped at tick time, so showing them here would mislead admins.
  const userSchedulesEnabled = deps.getConfig().cron?.userSchedules === true;
  // `createdBy !== null` excludes core system jobs (e.g. the memory review) — invisible
  // plumbing with no operator knobs. The createJob invariant makes null ⇔ systemActor set.
  const userJobs = userSchedulesEnabled
    ? allJobs.filter((j) => !j.pluginManaged && j.createdBy !== null)
    : [];
  const pluginJobs = isAdmin ? allJobs.filter((j) => j.pluginManaged) : [];
  const viewerTz = await deps.getUserTimezone(userId);

  const blocks: (KnownBlock | Block)[] = [];

  if (userJobs.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: t("home.scheduled.header"), emoji: true },
    });

    for (const job of userJobs) {
      const schedule = deps.humanReadableSchedule(job.cronExpression, job.timezone, viewerTz);
      const statusLabel = !job.enabled
        ? t("home.scheduled.paused_suffix")
        : job.lastRunStatus === "error"
          ? " :warning:"
          : job.lastRunStatus === "skipped"
            ? job.submitResponseMode === "skipped"
              ? t("home.scheduled.ran_without_responses_suffix")
              : t("home.scheduled.skipped_suffix")
            : "";
      const typeLabel = job.oneShot ? t("home.scheduled.one_time_suffix") : "";
      const jitterLabel = job.jitterMinutes
        ? t("home.scheduled.jitter_suffix", { minutes: job.jitterMinutes })
        : "";
      // userJobs filters out pluginManaged rows, so createdBy is always a real userId here.
      const creator =
        isAdmin && job.createdBy !== null && job.createdBy !== userId
          ? ` · <@${job.createdBy}>`
          : "";
      const namePrefix = job.name ? `*${escapeMrkdwn(job.name)}* — ` : "";

      const channelRef = job.channel ? `<#${job.channel}> · ` : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${namePrefix}${channelRef}${schedule}${jitterLabel}${typeLabel}${creator}${statusLabel}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: t("common.edit") },
          action_id: `cron_edit_job:${job.id}`,
        },
      });
    }
  }

  if (pluginJobs.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: t("home.scheduled.plugin_header"), emoji: true },
    });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: t("home.scheduled.plugin_hint"),
        },
      ],
    });

    for (const job of pluginJobs) {
      const schedule = deps.humanReadableSchedule(job.cronExpression, job.timezone, viewerTz);
      const statusLabel = !job.enabled
        ? t("home.scheduled.paused_suffix")
        : job.lastRunStatus === "error"
          ? " :warning:"
          : job.lastRunStatus === "skipped"
            ? job.submitResponseMode === "skipped"
              ? t("home.scheduled.ran_without_responses_suffix")
              : t("home.scheduled.skipped_suffix")
            : "";
      const ownerLabel = job.plugin
        ? t("home.scheduled.plugin_suffix", { plugin: job.plugin })
        : "";
      const jitterLabel = job.jitterMinutes
        ? t("home.scheduled.jitter_suffix", { minutes: job.jitterMinutes })
        : "";
      const namePrefix = job.name ? `*${escapeMrkdwn(job.name)}* — ` : "";

      const channelRef = job.channel ? `<#${job.channel}> · ` : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${namePrefix}${channelRef}${schedule}${jitterLabel}${ownerLabel}${statusLabel}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: t("common.edit") },
          action_id: `cron_edit_job:${job.id}`,
        },
      });
    }
  }

  return blocks;
}

// ── List-modal wrappers ─────────────────────────────────────────────────────
// The heavy Home Tab sections (roles, auto-respond, scheduled, skills) are reached
// through buttons in the Configuration section and rendered inside modals, keeping
// the Home view itself well under Slack's 100-block ceiling.

function stripLeadingDividers(blocks: (KnownBlock | Block)[]): (KnownBlock | Block)[] {
  let start = 0;
  while (start < blocks.length && blocks[start]?.type === "divider") start++;
  return blocks.slice(start);
}

function wrapListModal(
  callbackId: string,
  title: string,
  blocks: (KnownBlock | Block)[],
  emptyText?: string,
): View {
  const body = stripLeadingDividers(blocks);
  return {
    type: "modal",
    callback_id: callbackId,
    title: { type: "plain_text", text: title, emoji: true },
    close: { type: "plain_text", text: t("common.close") },
    blocks:
      body.length > 0
        ? body
        : [{ type: "section", text: { type: "mrkdwn", text: emptyText ?? " " } }],
  };
}

export async function buildRolesModalView(
  role: UserRole,
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<View> {
  const blocks = await buildRoleManagementSection(role, deps);
  return wrapListModal("roles_modal_view", t("home.roles.modal_title"), blocks);
}

export async function buildAutoRespondModalView(
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<View> {
  const blocks = await buildAutoRespondSection(deps);
  return wrapListModal("auto_respond_modal_view", t("home.auto_respond.modal_title"), blocks);
}

export async function buildSchedulesModalView(
  userId: string,
  isAdmin: boolean,
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<View> {
  const blocks = await buildScheduledMessagesSection(userId, isAdmin, deps);
  return wrapListModal(
    "schedules_modal_view",
    t("home.scheduled.modal_title"),
    blocks,
    t("home.scheduled.modal_empty"),
  );
}

export function buildSkillsModalView(userId: string, role: UserRole, skills: UserSkill[]): View {
  const blocks = buildUserSkillsSection(userId, role, skills);
  return wrapListModal("skills_modal_view", t("userSkills.modal_list_title"), blocks);
}

export function buildInvestigationsModalView(deps: HomeTabDeps = defaultHomeTabDeps): View {
  const blocks = buildInvestigationsSection(deps);
  return wrapListModal("investigations_modal_view", t("investigations.home_section_title"), blocks);
}

export function buildMcpModalView(deps: HomeTabDeps = defaultHomeTabDeps): View {
  const config = deps.getConfig();
  const mcpServers = deps.getConfiguredMcpServerNames();
  const blocks: (KnownBlock | Block)[] = [];

  // MCP Servers — split into always-loaded (session-start) vs on-demand (lazy).
  // Servers in mcp.json with no registry entry fall back to alwaysLoad=true.
  if (mcpServers.length > 0) {
    const failed = deps.getFailedMcpServers();
    const { registry } = resolveEffectiveRegistry({
      configRegistry: config.mcpServers,
      mcpServerNames: mcpServers,
      githubAutoInjected: mcpServers.includes("github"),
      pluginIntegrations: getLoadedPluginIntegrations(),
    });

    const always: string[] = [];
    const onDemand: string[] = [];
    for (const name of mcpServers) {
      const marker = failed.has(name) ? `${name} :warning:` : name;
      if (registry[name]?.alwaysLoad !== false) {
        always.push(marker);
      } else {
        onDemand.push(marker);
      }
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("home.status.mcp_servers_block", {
          always: always.length > 0 ? always.join(", ") : t("common.none_paren"),
          onDemand: onDemand.length > 0 ? onDemand.join(", ") : t("common.none_paren"),
        }),
      },
    });
  }

  return wrapListModal(
    "mcp_modal_view",
    t("home.config.mcp_modal_title"),
    blocks,
    t("home.config.mcp_empty"),
  );
}

export function buildPluginsModalView(
  role: UserRole,
  deps: HomeTabDeps = defaultHomeTabDeps,
): View {
  const userIsAdmin = deps.canManageRoles(role);
  const blocks: (KnownBlock | Block)[] = [];

  // SDK skill plugins (Claude Code skill packs), split eager vs lazy.
  const skillPlugins = deps.discoverSkillPluginInfo();
  if (skillPlugins.length > 0) {
    const format = (p: SkillPluginInfo) =>
      t("home.status.skill_plugin_entry", {
        name: p.name,
        suffix:
          p.skillCount > 0 ? t("home.status.skill_count_suffix", { count: p.skillCount }) : "",
      });
    const eager = skillPlugins
      .filter((p) => !p.lazyLoad)
      .map(format)
      .join("\n");
    const lazy = skillPlugins
      .filter((p) => p.lazyLoad)
      .map(format)
      .join("\n");
    const sections: string[] = [];
    if (eager) sections.push(t("home.status.skill_eager_section", { list: eager }));
    if (lazy) sections.push(t("home.status.skill_lazy_section", { list: lazy }));
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("home.status.skill_plugins_block", { sections: sections.join("\n\n") }),
      },
    });
  }

  // Clack plugins — one row per plugin, admin-only error banner beneath a failing row.
  const clackPlugins = deps.getLoadedClackPlugins();
  if (clackPlugins.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: t("home.status.clack_plugins_header") },
    });
    for (const p of clackPlugins) {
      const hasErrors = p.errors.length > 0;
      const statusIcon = hasErrors ? ":x: " : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            statusIcon + t("home.status.clack_plugin_entry", { name: p.name, count: p.toolCount }),
        },
      });
      if (hasErrors && userIsAdmin) {
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: t("home.status.clack_plugin_error", {
                reasons: p.errors.map((e) => `:warning: ${e}`).join("\n"),
              }),
            },
          ],
        });
      }
    }
  }

  return wrapListModal(
    "plugins_modal_view",
    t("home.config.plugins_modal_title"),
    blocks,
    t("home.config.plugins_empty"),
  );
}

function formatAccessTag(role: UserRole): string {
  return role === "member" ? t("home.status.access_all") : t("home.status.access_plus", { role });
}

export function buildStatusModalView(role: UserRole, deps: HomeTabDeps = defaultHomeTabDeps): View {
  const config = deps.getConfig();
  const showAccessTags = deps.canRequestChanges(role); // dev+
  const blocks: (KnownBlock | Block)[] = [];

  // Repositories (filtered by role), with access tags for dev+.
  const visibleRepos = deps.getVisibleRepos(role, config.repositories);
  const repoList = visibleRepos
    .map((r) => {
      let line = `• *${r.name}*: ${r.description}`;
      if (showAccessTags) {
        const readTag = formatAccessTag(r.access?.read ?? "member");
        if (deps.canWriteRepo(role, r)) {
          const writeTag = formatAccessTag(r.access!.write!);
          line += `\n   ${t("home.status.repo_access_writable", { read: readTag, write: writeTag })}`;
        } else {
          line += `\n   ${t("home.status.repo_access_readonly", { read: readTag })}`;
        }
      }
      return line;
    })
    .join("\n");
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: t("home.status.repositories_block", { list: repoList }) },
  });

  // Trigger methods
  const methods: string[] = [
    t("home.status.trigger_reaction", { emoji: config.reactions.trigger }),
  ];
  if (config.directMessages.enabled) {
    methods.push(t("home.status.trigger_dm"));
  }
  if (config.mentions.enabled) {
    methods.push(t("home.status.trigger_mention"));
  }
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: t("home.status.trigger_methods", { methods: methods.join(", ") }),
    },
  });

  return wrapListModal("status_modal_view", t("home.status.header"), blocks);
}

/**
 * Admin-only recovery surface spanning every resilient store (cron + the migrated collection
 * loaders): a banner naming any store whose persistence is frozen (a corrupt file could not be
 * loaded) and a "Quarantined state" panel listing each entry that failed validation, with Retry
 * (re-validate → rejoin the live set) and Delete (explicit removal) buttons. A frozen store shows
 * only the banner (a freeze yields an empty quarantine). Renders nothing when everything is healthy.
 */
async function buildStateQuarantineSection(): Promise<(KnownBlock | Block)[]> {
  const blocks: (KnownBlock | Block)[] = [];
  const stores = getQuarantineStores();

  const frozen = stores.filter((s) => s.isFrozen());
  if (frozen.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("home.state_quarantine.freeze_banner", {
          stores: frozen.map((s) => s.label).join(", "),
          count: frozen.length,
        }),
      },
    });
  }

  const rows: { store: QuarantineStoreDescriptor; entry: QuarantineEntry }[] = [];
  for (const store of stores) {
    if (store.isFrozen()) continue;
    for (const entry of await store.getSummaries()) rows.push({ store, entry });
  }
  if (rows.length === 0) return blocks;

  blocks.push(
    { type: "divider" },
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `:warning: ${t("home.state_quarantine.header")}`,
        emoji: true,
      },
    },
    { type: "context", elements: [{ type: "mrkdwn", text: t("home.state_quarantine.hint") }] },
  );

  for (const { store, entry } of rows) {
    const value = `${store.storeId}::${entry.key}`;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("home.state_quarantine.entry", {
          source: store.label,
          key: escapeMrkdwn(entry.key),
          field: entry.field,
          error: entry.error,
        }),
      },
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: t("home.state_quarantine.retry"), emoji: true },
          action_id: "state_quarantine_retry",
          value,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: t("home.state_quarantine.delete"), emoji: true },
          action_id: "state_quarantine_delete",
          value,
        },
      ],
    });
  }

  return blocks;
}

function buildPluginCronJobModal(job: CronJob, viewerTimezone?: string): View {
  const schedule = humanReadableSchedule(job.cronExpression, job.timezone, viewerTimezone);
  const ownerLabel = job.plugin ? ` · _plugin: ${escapeMrkdwn(job.plugin)}_` : "";
  const statusLabel = !job.enabled ? t("home.scheduled.paused_suffix") : "";
  const namePrefix = job.name ? `*${escapeMrkdwn(job.name)}*\n` : "";

  // Slack mrkdwn section text limit is 3000 chars; cap each field independently with
  // headroom for the label + code fence wrapper.
  const MRKDWN_BUDGET = 2800;

  const blocks: (KnownBlock | Block)[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${namePrefix}${t("home.scheduled.plugin_modal_intro")}${ownerLabel}${statusLabel}`,
      },
    },
    { type: "divider" },
  ];
  if (job.channel) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${t("home.scheduled.channel_label")}*: <#${job.channel}>`,
      },
    });
  }
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${t("home.scheduled.cron_label")}*: \`${escapeMrkdwn(job.cronExpression)}\` — ${schedule}`,
    },
  });
  if (job.jitterMinutes) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${t("home.scheduled.jitter_modal_label")}*: ${job.jitterMinutes}m`,
      },
    });
  }

  if (job.prompt) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${t("home.scheduled.prompt_label")}*:\n\`\`\`${truncate(job.prompt, MRKDWN_BUDGET)}\`\`\``,
      },
    });
  }
  if (job.skipConditions) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${t("home.scheduled.skip_label")}*:\n${escapeMrkdwn(truncate(job.skipConditions, MRKDWN_BUDGET))}`,
      },
    });
  }

  blocks.push(
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: t("home.scheduled.plugin_pause_explanation") },
    },
    {
      type: "actions",
      block_id: "cron_job_actions_block",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: job.enabled ? t("home.scheduled.pause") : t("home.scheduled.resume"),
          },
          action_id: `cron_toggle_job:${job.id}`,
        },
      ],
    },
  );

  return {
    type: "modal",
    callback_id: "cron_plugin_job_modal",
    private_metadata: job.id,
    title: { type: "plain_text", text: t("home.scheduled.plugin_modal_title") },
    close: { type: "plain_text", text: t("common.close") },
    blocks,
  };
}

export function buildCronJobModal(job?: CronJob, viewerTimezone?: string): View {
  const isEdit = !!job;
  if (isEdit && job?.pluginManaged) {
    return buildPluginCronJobModal(job, viewerTimezone);
  }
  const blocks: (KnownBlock | Block)[] = [
    {
      type: "input",
      block_id: "cron_name_block",
      label: { type: "plain_text", text: t("home.scheduled.name_label") },
      element: {
        type: "plain_text_input",
        action_id: "cron_name",
        max_length: 80,
        ...(job?.name && { initial_value: job.name }),
        placeholder: { type: "plain_text", text: t("home.scheduled.name_placeholder") },
      },
      hint: { type: "plain_text", text: t("home.scheduled.name_hint") },
    },
    {
      type: "input",
      block_id: "cron_channel_block",
      label: { type: "plain_text", text: t("home.scheduled.channel_label") },
      element: {
        type: "conversations_select",
        action_id: "channel",
        ...(job?.channel && { initial_conversation: job.channel }),
        filter: {
          include: ["public", "private"],
          exclude_bot_users: true,
        },
        placeholder: { type: "plain_text", text: t("home.scheduled.channel_placeholder") },
      },
    },
    {
      type: "input",
      block_id: "cron_expression_block",
      label: { type: "plain_text", text: t("home.scheduled.cron_label") },
      element: {
        type: "plain_text_input",
        action_id: "cron_expression",
        ...(job?.cronExpression && { initial_value: job.cronExpression }),
        placeholder: {
          type: "plain_text",
          text: t("home.scheduled.cron_placeholder"),
        },
      },
      hint: {
        type: "plain_text",
        text: t("home.scheduled.cron_hint"),
      },
    },
    {
      type: "input",
      block_id: "cron_jitter_block",
      label: { type: "plain_text", text: t("home.scheduled.jitter_label") },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "cron_jitter",
        ...(job?.jitterMinutes && { initial_value: String(job.jitterMinutes) }),
        placeholder: { type: "plain_text", text: t("home.scheduled.jitter_placeholder") },
      },
      hint: { type: "plain_text", text: t("home.scheduled.jitter_hint") },
    },
    {
      type: "input",
      block_id: "cron_prompt_block",
      label: { type: "plain_text", text: t("home.scheduled.prompt_label") },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "prompt",
        multiline: true,
        ...(job?.prompt && { initial_value: job.prompt }),
        placeholder: {
          type: "plain_text",
          text: t("home.scheduled.prompt_placeholder"),
        },
      },
    },
    {
      type: "input",
      block_id: "cron_skip_conditions_block",
      label: { type: "plain_text", text: t("home.scheduled.skip_label") },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "skip_conditions",
        multiline: true,
        ...(job?.skipConditions && { initial_value: job.skipConditions }),
        placeholder: {
          type: "plain_text",
          text: t("home.scheduled.skip_placeholder"),
        },
      },
      hint: {
        type: "plain_text",
        text: t("home.scheduled.skip_hint"),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: t("home.scheduled.context_hint"),
        },
      ],
    },
  ];

  if (isEdit && job) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      block_id: "cron_job_actions_block",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: t("home.scheduled.send_now") },
          action_id: `cron_run_job:${job.id}`,
          confirm: {
            title: { type: "plain_text", text: t("home.scheduled.send_confirm_title") },
            text: {
              type: "plain_text",
              text: t("home.scheduled.send_confirm_text"),
            },
            confirm: { type: "plain_text", text: t("home.scheduled.send_now") },
            deny: { type: "plain_text", text: t("common.cancel") },
          },
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: job.enabled ? t("home.scheduled.disable") : t("home.scheduled.enable"),
          },
          action_id: `cron_toggle_job:${job.id}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: t("common.delete") },
          action_id: `cron_delete_job:${job.id}`,
          style: "danger",
          confirm: {
            title: { type: "plain_text", text: t("home.scheduled.delete_confirm_title") },
            text: {
              type: "plain_text",
              text: t("home.scheduled.delete_confirm_text"),
            },
            confirm: { type: "plain_text", text: t("common.delete") },
            deny: { type: "plain_text", text: t("common.cancel") },
            style: "danger",
          },
        },
      ],
    });
  }

  return {
    type: "modal",
    callback_id: isEdit ? "cron_edit_job_modal" : "cron_add_job_modal",
    private_metadata: isEdit ? job.id : "",
    title: {
      type: "plain_text",
      text: isEdit ? t("home.scheduled.modal_title_edit") : t("home.scheduled.modal_title_add"),
    },
    submit: { type: "plain_text", text: t("common.save") },
    close: { type: "plain_text", text: t("common.cancel") },
    blocks,
  };
}
