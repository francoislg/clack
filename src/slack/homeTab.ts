import type { View, KnownBlock, Block } from "@slack/types";
import { getConfig } from "../config.js";
import { getConfiguredMcpServerNames, resolveEffectiveRegistry } from "../mcp.js";
import { getFailedMcpServers } from "../mcpStatus.js";
import { loadRoles, getRole, hasOwner, type UserRole } from "../roles.js";
import { canEditConfig, canManageRoles, canRequestChanges } from "../permissions.js";
import { getActiveWorkers } from "../changes/activeState.js";
import { listInstructionFiles } from "../configurationFiles.js";
import { getReactionDelivery, getUserPreference } from "../userPreferences.js";
import { getVisibleRepos, canWriteRepo } from "../repoAccess.js";
import { getMigrationErrors } from "../migrations/admin.js";
import { discoverSkillPluginInfo } from "../skillPlugins.js";
import { getRules, type AutoRespondRule } from "../autoRespond.js";
import { getJobs, getJobsByUser, type CronJob } from "../cronJobs.js";
import { humanReadableSchedule } from "../cronFormatter.js";
import { truncate } from "../text.js";
import type { ActiveWorker } from "../changes/activeState.js";
import type { InstructionFileListing } from "../configurationFiles.js";
import type { Config, RepositoryConfig } from "../config.js";
import type { SkillPluginInfo } from "../skillPlugins.js";
import type { MigrationError } from "../migrations/types.js";
import { getLoadedPlugins } from "../plugins/state.js";

export interface ClackPluginSummary {
  name: string;
  toolCount: number;
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
  humanReadableSchedule: (cronExpression: string, timezone: string) => string;
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
    })),
  getRules,
  getJobs,
  getJobsByUser,
  humanReadableSchedule,
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

  // Role management section (only for admins/owner)
  if (userIsAdmin) {
    blocks.push(...(await buildRoleManagementSection(userId, role, deps)));
  }

  // Auto-respond section (admin only)
  if (userIsAdmin) {
    blocks.push(...(await buildAutoRespondSection(deps)));
  }

  // Scheduled messages section (admins see all, others see own)
  const scheduledBlocks = await buildScheduledMessagesSection(userId, userIsAdmin, deps);
  if (scheduledBlocks.length > 0) {
    blocks.push(...scheduledBlocks);
  }

  // Configuration & preferences section (config editing for admins, preferences for all)
  blocks.push(...buildConfigurationSection(userCanEdit, deps));

  // Active workers section (only for devs and higher)
  if (userIsDev) {
    blocks.push(...buildActiveWorkersSection(deps));
  }

  // Status section (visible to all)
  blocks.push(...buildStatusSection(role, deps));

  // Help section (visible to all)
  blocks.push(...buildHelpSection(deps));

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

function buildMigrationBanner(
  errors: import("../migrations/types.js").MigrationError[],
  isAdmin: boolean,
): KnownBlock[] {
  const errorList = errors
    .map((e) => `• *${e.migrationName}* (v${e.version}): ${e.error}`)
    .join("\n");

  let text = `:warning: *Migration Error*\n\n${errorList}`;

  if (isAdmin) {
    text += `\n\n_Check the logs for details and restart Clack after resolving the issue._`;
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
  const roleLabels: Record<UserRole, string> = {
    owner: "Owner",
    admin: "Admin",
    dev: "Dev",
    member: "Member",
  };

  const roleEmojis: Record<UserRole, string> = {
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
        text: `${roleEmojis[role]} *Your Role:* ${roleLabels[role]}`,
      },
    },
    { type: "divider" },
  ];
}

function buildClaimOwnershipSection(ownerDisabled: boolean): KnownBlock[] {
  const message = ownerDisabled
    ? ":warning: The current owner is inactive. As an admin, you can claim ownership."
    : ":wave: *Welcome!* This bot has no owner yet. Claim ownership to manage it.";

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
          text: "Claim Ownership",
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
  userId: string,
  role: UserRole,
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<KnownBlock[]> {
  const roles = await deps.loadRoles();
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "Role Management",
      emoji: true,
    },
  });

  // Owner section
  if (roles.owner) {
    const ownerSection: KnownBlock = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:crown: *Owner:* <@${roles.owner}>`,
      },
    };

    // Only owner can transfer ownership
    if (role === "owner") {
      ownerSection.accessory = {
        type: "button",
        text: {
          type: "plain_text",
          text: "Transfer",
          emoji: true,
        },
        action_id: "transfer_ownership",
      };
    }

    blocks.push(ownerSection);
  }

  // Admins section
  const adminList =
    roles.admins.length > 0 ? roles.admins.map((id) => `<@${id}>`).join(", ") : "_None_";

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `:shield: *Admins:* ${adminList}`,
    },
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "+ Add Admin",
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
                text: "- Remove Admin",
                emoji: true,
              },
              action_id: "remove_admin",
            },
          ]
        : []),
    ],
  });

  // Devs section
  const devList = roles.devs.length > 0 ? roles.devs.map((id) => `<@${id}>`).join(", ") : "_None_";

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `:computer: *Devs:* ${devList}`,
    },
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "+ Add Dev",
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
                text: "- Remove Dev",
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

export function buildConfigurationSection(
  showEditButtons: boolean,
  deps: HomeTabDeps = defaultHomeTabDeps,
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "Configuration",
      emoji: true,
    },
  });

  const buttons: object[] = [];

  if (showEditButtons) {
    const listing = deps.listInstructionFiles();

    for (const roleEntry of listing.roles) {
      const roleLabel = `${roleEntry.role.charAt(0).toUpperCase() + roleEntry.role.slice(1)} Config`;
      const emoji = roleEmojis[roleEntry.role] ?? "";
      const label = emoji ? `${emoji} Edit ${roleLabel}` : `Edit ${roleLabel}`;
      buttons.push({
        type: "button",
        text: { type: "plain_text", text: label, emoji: true },
        action_id: `view_config_dir:${roleEntry.role}`,
        value: roleEntry.role,
      });
    }

    // Pre-analysis context — distinct top-level field, rendered as its own button
    const preAnalysisEmoji = roleEmojis["pre-analysis"] ?? "";
    const preAnalysisLabel = preAnalysisEmoji
      ? `${preAnalysisEmoji} Edit Pre-Analysis Context`
      : "Edit Pre-Analysis Context";
    buttons.push({
      type: "button",
      text: { type: "plain_text", text: preAnalysisLabel, emoji: true },
      action_id: `view_config_dir:pre-analysis`,
      value: "pre-analysis",
    });

    // Repo directories
    for (const repoEntry of listing.repos) {
      buttons.push({
        type: "button",
        text: {
          type: "plain_text",
          text: `:file_folder: Edit ${repoEntry.repo} Config`,
          emoji: true,
        },
        action_id: `view_config_dir:${repoEntry.repo}`,
        value: repoEntry.repo,
      });
    }
  }

  // Personal Preferences button — always visible
  buttons.push({
    type: "button",
    text: {
      type: "plain_text",
      text: ":gear: Personal Preferences",
      emoji: true,
    },
    action_id: "open_settings",
  });

  blocks.push({ type: "actions", elements: buttons } as KnownBlock);

  if (showEditButtons) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Chat with me to edit core config files (config.json, mcp.json, .env, tool mappings) or restart the app._",
        },
      ],
    });
  }

  blocks.push({ type: "divider" });

  return blocks;
}

function formatAccessTag(role: UserRole): string {
  return role === "member" ? "all" : `${role}+`;
}

export function buildStatusSection(
  role: UserRole,
  deps: HomeTabDeps = defaultHomeTabDeps,
): KnownBlock[] {
  const config = deps.getConfig();
  const mcpServers = deps.getConfiguredMcpServerNames();
  const showAccessTags = deps.canRequestChanges(role); // dev+

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Status",
        emoji: true,
      },
    },
  ];

  // Repositories (filtered by role)
  const visibleRepos = deps.getVisibleRepos(role, config.repositories);
  const repoList = visibleRepos
    .map((r) => {
      let line = `• *${r.name}*: ${r.description}`;
      if (showAccessTags) {
        const readTag = formatAccessTag(r.access?.read ?? "member");
        if (deps.canWriteRepo(role, r)) {
          const writeTag = formatAccessTag(r.access!.write!);
          line += `\n   _read: ${readTag} · write: ${writeTag}_`;
        } else {
          line += `\n   _read: ${readTag} · read-only_`;
        }
      }
      return line;
    })
    .join("\n");

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `:file_folder: *Repositories:*\n${repoList}`,
    },
  });

  // MCP Servers — split into always-loaded (session-start) vs on-demand (lazy).
  // The effective registry is the source of truth for the alwaysLoad flag;
  // servers in mcp.json with no registry entry fall back to alwaysLoad=true
  // (see `resolveEffectiveRegistry`), so they surface in the Always group.
  if (mcpServers.length > 0) {
    const failed = deps.getFailedMcpServers();
    const { registry } = resolveEffectiveRegistry({
      configRegistry: config.mcpServers,
      mcpServerNames: mcpServers,
      githubAutoInjected: mcpServers.includes("github"),
    });

    const always: string[] = [];
    const onDemand: string[] = [];
    for (const name of mcpServers) {
      const marker = failed.has(name) ? `${name} :warning:` : name;
      // Unknown → default to always (legacy behaviour parity).
      if (registry[name]?.alwaysLoad !== false) {
        always.push(marker);
      } else {
        onDemand.push(marker);
      }
    }

    const lines: string[] = [":electric_plug: *MCP Servers:*"];
    lines.push(`• *Always loaded:* ${always.length > 0 ? always.join(", ") : "_(none)_"}`);
    lines.push(`• *On demand:* ${onDemand.length > 0 ? onDemand.join(", ") : "_(none)_"}`);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: lines.join("\n"),
      },
    });
  }

  // SDK Skill Plugins (Claude Code skill packs from data/skill-plugins/)
  // Split into eager (passed via --plugin-dir at session start) and lazy
  // (excluded from baseline; loaded on demand via list_skill_pack_skills /
  // load_skill). Mirrors the MCP Always/On-demand split.
  const skillPlugins = deps.discoverSkillPluginInfo();
  if (skillPlugins.length > 0) {
    const format = (p: SkillPluginInfo) =>
      `• *${p.name}*${p.skillCount > 0 ? ` (${p.skillCount} skills)` : ""}`;
    const eager = skillPlugins
      .filter((p) => !p.lazyLoad)
      .map(format)
      .join("\n");
    const lazy = skillPlugins
      .filter((p) => p.lazyLoad)
      .map(format)
      .join("\n");
    const sections: string[] = [];
    if (eager) sections.push(`_Eager (always loaded):_\n${eager}`);
    if (lazy) sections.push(`_Lazy (on-demand via load_skill):_\n${lazy}`);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:jigsaw: *Skill Plugins:*\n${sections.join("\n\n")}`,
      },
    });
  }

  // Clack Plugins (loaded via plugins config)
  const clackPlugins = deps.getLoadedClackPlugins();
  if (clackPlugins.length > 0) {
    const pluginList = clackPlugins.map((p) => `• *${p.name}* (${p.toolCount} tools)`).join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:package: *Plugins:*\n${pluginList}`,
      },
    });
  }

  // Trigger methods
  const methods: string[] = [`:${config.reactions.trigger}: Reaction`];
  if (config.directMessages.enabled) {
    methods.push(":speech_balloon: Direct Messages");
  }
  if (config.mentions.enabled) {
    methods.push(":mega: @Mentions");
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `:zap: *Trigger Methods:* ${methods.join(", ")}`,
    },
  });

  blocks.push({ type: "divider" });

  return blocks;
}

export function buildActiveWorkersSection(deps: HomeTabDeps = defaultHomeTabDeps): KnownBlock[] {
  const workers = deps.getActiveWorkers();
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "Active Workers",
      emoji: true,
    },
  });

  if (workers.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No active change requests_",
      },
    });
  } else {
    // Status emoji mapping
    const statusEmoji: Record<string, string> = {
      planning: ":thinking_face:",
      executing: ":hammer_and_wrench:",
      reviewing: ":eyes:",
      merging: ":rocket:",
      cancelled: ":no_entry_sign:",
    };

    for (const worker of workers) {
      const emoji = statusEmoji[worker.status] || ":hourglass:";
      const statusLabel = worker.status.charAt(0).toUpperCase() + worker.status.slice(1);

      const threadLink = `https://slack.com/archives/${worker.channel}/p${worker.threadTs.replace(".", "")}`;

      let text = `${emoji} *${worker.description}*\n`;
      text += `• Status: ${statusLabel}\n`;
      text += `• Branch: \`${worker.branch}\`\n`;
      text += `• Repo: ${worker.repo}\n`;
      text += `• By: ${worker.userId === "auto-respond" ? "Auto-Respond" : `<@${worker.userId}>`}\n`;
      text += `• Thread: <${threadLink}|View thread>`;

      if (worker.prUrl) {
        text += `\n• PR: <${worker.prUrl}|View PR>`;
      }

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      });
    }
  }

  blocks.push({ type: "divider" });

  return blocks;
}

export function buildHelpSection(deps: HomeTabDeps = defaultHomeTabDeps): KnownBlock[] {
  const config = deps.getConfig();

  const triggerInstructions: string[] = [];

  triggerInstructions.push(
    `• *Reaction:* React to any message with :${config.reactions.trigger}: to ask about it`,
  );

  if (config.directMessages.enabled) {
    triggerInstructions.push("• *Direct Message:* Send me a DM with your question");
  }

  if (config.mentions.enabled) {
    triggerInstructions.push("• *Mention:* @mention me in any channel with your question");
  }

  if (config.reactions.stop) {
    triggerInstructions.push(
      `• *Stop:* React with :${config.reactions.stop}: (or type it inline in a short message) to cancel current work and silence me in a thread`,
    );
  }

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Help",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*How to use this bot:*",
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
          text: "_I analyze your codebase and answer questions in plain language._",
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
    text: { type: "plain_text" as const, text: "Direct Message" },
    description: {
      type: "plain_text" as const,
      text: "Get a private DM thread to refine before sharing.",
    },
    value: "dm",
  };
  const threadOption = {
    text: { type: "plain_text" as const, text: "Thread" },
    description: {
      type: "plain_text" as const,
      text: "Answer posted directly in the channel thread.",
    },
    value: "thread",
  };

  const notifyOnOption = {
    text: { type: "plain_text" as const, text: "On" },
    description: {
      type: "plain_text" as const,
      text: "If the response takes longer than 60 seconds, post a follow-up so you get a Slack notification.",
    },
    value: "true",
  };
  const notifyOffOption = {
    text: { type: "plain_text" as const, text: "Off" },
    description: {
      type: "plain_text" as const,
      text: "No extra message — just the streamed answer.",
    },
    value: "false",
  };

  return {
    type: "modal",
    callback_id: "settings_modal",
    title: {
      type: "plain_text",
      text: "Settings",
    },
    submit: {
      type: "plain_text",
      text: "Save",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Reaction delivery*\nHow would you like to receive answers when you react with the trigger emoji?",
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
          text: "*Response notification*\nIf the response takes longer than 60 seconds, post a follow-up message so you get a Slack notification?",
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
      text: "Submit",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
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
          text: "Select User",
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
          text: `\`${file.filename}\`${label}\n_Too large for modal editor_`,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Chat to Edit",
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
            text: "Edit",
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
            text: "+ Create New File",
          },
          action_id: "create_config_file",
          value: dir,
        },
      ],
    });
  }

  const titleText = `${dir}/ Instructions`;
  const truncatedTitle = truncate(titleText, 24);

  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: truncatedTitle,
    },
    close: {
      type: "plain_text",
      text: "Close",
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
      elements: [{ type: "mrkdwn", text: "_Default — no custom override_" }],
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
      text: "Content",
    },
  });

  // Action buttons row
  const actionElements: object[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "Chat to Edit" },
      action_id: "chat_edit_config_file",
      value: `${dir}/${filename}`,
    },
  ];

  if (fileState === "has-override") {
    actionElements.push({
      type: "button",
      text: { type: "plain_text", text: "Reset to Default" },
      style: "danger",
      action_id: "delete_config_file",
      value: `${dir}/${filename}`,
    });
  } else if (fileState === "custom-only") {
    actionElements.push({
      type: "button",
      text: { type: "plain_text", text: "Delete File" },
      style: "danger",
      action_id: "delete_config_file",
      value: `${dir}/${filename}`,
    });
  }

  blocks.push({ type: "actions", elements: actionElements } as KnownBlock);

  const submitLabel = fileState === "default-only" ? "Create Override" : "Save";

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
      text: "Back",
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
      text: "Create New File",
    },
    submit: {
      type: "plain_text",
      text: "Create",
    },
    close: {
      type: "plain_text",
      text: "Back",
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
            text: "my-instructions",
          },
        },
        label: {
          type: "plain_text",
          text: "Filename",
        },
        hint: {
          type: "plain_text",
          text: ".md extension is added automatically",
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
            text: "Enter instruction content...",
          },
        },
        label: {
          type: "plain_text",
          text: "Content",
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
      text: "Remove",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Select a user to remove:`,
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
            text: "Select user to remove",
          },
          options,
        },
        label: {
          type: "plain_text",
          text: "User",
        },
      },
    ],
  };
}

// ============================================================================
// Auto-Respond Section
// ============================================================================

async function buildAutoRespondSection(
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<(KnownBlock | Block)[]> {
  const blocks: (KnownBlock | Block)[] = [];
  const rules = await deps.getRules();

  blocks.push({ type: "divider" });
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "Auto-Respond" },
  });

  if (rules.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No auto-respond rules configured._" },
    });
  } else {
    for (const rule of rules) {
      const channels = rule.channels.map((c) => `<#${c}>`).join(", ");
      const users = rule.userFilters?.length
        ? ` · ${rule.userFilters.map((u) => `<@${u}>`).join(", ")}`
        : "";
      const keywords = rule.keywords?.length
        ? ` · Keywords: ${rule.keywords.map((k) => `\`${k}\``).join(", ")}`
        : "";
      const preAnalysis = rule.preAnalysisContext ? " · Pre-analysis" : "";
      const status = rule.enabled ? "" : " _(paused)_";

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${channels}${users}${keywords}${preAnalysis}${status}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Edit" },
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
        text: { type: "plain_text", text: "+ Add Rule" },
        action_id: "ai_add_rule",
        style: "primary",
      },
    ],
  });

  return blocks;
}

export function buildAutoRespondModal(rule?: AutoRespondRule): View {
  const isEdit = !!rule;
  const blocks: (KnownBlock | Block)[] = [
    {
      type: "input",
      block_id: "channels_block",
      label: { type: "plain_text", text: "Channels" },
      element: {
        type: "multi_conversations_select",
        action_id: "channels",
        ...(rule?.channels && { initial_conversations: rule.channels }),
        filter: {
          include: ["public", "private"],
          exclude_bot_users: true,
        },
        placeholder: { type: "plain_text", text: "Select channels to watch" },
      },
    },
    {
      type: "input",
      block_id: "users_block",
      label: { type: "plain_text", text: "Filter by users/bots (optional)" },
      optional: true,
      element: {
        type: "multi_users_select",
        action_id: "users",
        ...(rule?.userFilters && { initial_users: rule.userFilters }),
        placeholder: {
          type: "plain_text",
          text: "Leave empty to match all messages",
        },
      },
    },
    {
      type: "input",
      block_id: "keywords_block",
      label: { type: "plain_text", text: "Keywords (optional)" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "keywords",
        ...(rule?.keywords && { initial_value: rule.keywords.join(", ") }),
        placeholder: {
          type: "plain_text",
          text: "e.g., CRITICAL, timeout, OOM — comma-separated",
        },
      },
    },
    {
      type: "input",
      block_id: "extra_context_block",
      label: { type: "plain_text", text: "Extra context (optional)" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "extra_context",
        multiline: true,
        ...(rule?.extraContext && { initial_value: rule.extraContext }),
        placeholder: {
          type: "plain_text",
          text: "e.g., This is a Sentry error alert. Focus on the stack trace and find the relevant code path.",
        },
      },
    },
    {
      type: "input",
      block_id: "pre_analysis_block",
      label: { type: "plain_text", text: "Pre-analysis context (optional)" },
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
          text: "e.g., Only respond if this is an actionable error — leave empty to skip pre-analysis",
        },
      },
      hint: {
        type: "plain_text",
        text: "When set, a fast AI check determines if the message is worth responding to before launching a full response.",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "The bot must be a member of selected channels to receive messages.",
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
            text: rule.enabled ? "Disable Rule" : "Enable Rule",
          },
          action_id: `ai_toggle_rule:${rule.id}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Delete Rule" },
          action_id: `ai_delete_rule:${rule.id}`,
          style: "danger",
          confirm: {
            title: { type: "plain_text", text: "Delete rule?" },
            text: {
              type: "plain_text",
              text: "This will permanently remove this auto-respond rule.",
            },
            confirm: { type: "plain_text", text: "Delete" },
            deny: { type: "plain_text", text: "Cancel" },
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
    title: { type: "plain_text", text: isEdit ? "Edit Rule" : "Add Rule" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

// ============================================================================
// SCHEDULED MESSAGES
// ============================================================================

async function buildScheduledMessagesSection(
  userId: string,
  isAdmin: boolean,
  deps: HomeTabDeps = defaultHomeTabDeps,
): Promise<(KnownBlock | Block)[]> {
  const jobs = isAdmin ? await deps.getJobs() : await deps.getJobsByUser(userId);
  if (jobs.length === 0) return [];

  const blocks: (KnownBlock | Block)[] = [];

  blocks.push({ type: "divider" });
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "Scheduled Messages", emoji: true },
  });

  for (const job of jobs) {
    const schedule = deps.humanReadableSchedule(job.cronExpression, job.timezone);
    const statusLabel = !job.enabled
      ? " _(paused)_"
      : job.lastRunStatus === "error"
        ? " :warning:"
        : job.lastRunStatus === "skipped"
          ? " _(last run skipped)_"
          : "";
    const typeLabel = job.oneShot ? " · _one-time_" : "";
    const creator = isAdmin && job.createdBy !== userId ? ` · <@${job.createdBy}>` : "";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<#${job.channel}> · ${schedule}${typeLabel}${creator}${statusLabel}`,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Edit" },
        action_id: `cron_edit_job:${job.id}`,
      },
    });
  }

  return blocks;
}

export function buildCronJobModal(job?: CronJob): View {
  const isEdit = !!job;
  const blocks: (KnownBlock | Block)[] = [
    {
      type: "input",
      block_id: "cron_channel_block",
      label: { type: "plain_text", text: "Channel" },
      element: {
        type: "conversations_select",
        action_id: "channel",
        ...(job?.channel && { initial_conversation: job.channel }),
        filter: {
          include: ["public", "private"],
          exclude_bot_users: true,
        },
        placeholder: { type: "plain_text", text: "Select a channel" },
      },
    },
    {
      type: "input",
      block_id: "cron_expression_block",
      label: { type: "plain_text", text: "Cron Expression" },
      element: {
        type: "plain_text_input",
        action_id: "cron_expression",
        ...(job?.cronExpression && { initial_value: job.cronExpression }),
        placeholder: {
          type: "plain_text",
          text: "e.g. 0 9 * * * (daily at 9am)",
        },
      },
      hint: {
        type: "plain_text",
        text: "5-field cron: minute hour day-of-month month day-of-week",
      },
    },
    {
      type: "input",
      block_id: "cron_prompt_block",
      label: { type: "plain_text", text: "Prompt (dynamic content)" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "prompt",
        multiline: true,
        ...(job?.prompt && { initial_value: job.prompt }),
        placeholder: {
          type: "plain_text",
          text: "What should Claude do? e.g. Summarize merged PRs from today",
        },
      },
    },
    {
      type: "input",
      block_id: "cron_skip_conditions_block",
      label: { type: "plain_text", text: "Skip conditions (optional)" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "skip_conditions",
        multiline: true,
        ...(job?.skipConditions && { initial_value: job.skipConditions }),
        placeholder: {
          type: "plain_text",
          text: "e.g. Skip if no PRs were merged in the last 24 hours",
        },
      },
      hint: {
        type: "plain_text",
        text: "When set, Claude evaluates these before each run and may skip posting. Leave empty to always post.",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Claude will generate content each time this runs. The bot must be a member of the selected channel.",
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
          text: { type: "plain_text", text: "Send Now" },
          action_id: `cron_run_job:${job.id}`,
          confirm: {
            title: { type: "plain_text", text: "Send now?" },
            text: {
              type: "plain_text",
              text: "This will execute the scheduled message immediately. The regular schedule is not affected.",
            },
            confirm: { type: "plain_text", text: "Send Now" },
            deny: { type: "plain_text", text: "Cancel" },
          },
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: job.enabled ? "Disable" : "Enable",
          },
          action_id: `cron_toggle_job:${job.id}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Delete" },
          action_id: `cron_delete_job:${job.id}`,
          style: "danger",
          confirm: {
            title: { type: "plain_text", text: "Delete scheduled message?" },
            text: {
              type: "plain_text",
              text: "This will permanently remove this scheduled message.",
            },
            confirm: { type: "plain_text", text: "Delete" },
            deny: { type: "plain_text", text: "Cancel" },
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
      text: isEdit ? "Edit Schedule" : "Add Schedule",
    },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}
