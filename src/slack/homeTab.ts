import type { View, KnownBlock, Block } from "@slack/types";
import { getConfig } from "../config.js";
import { getConfiguredMcpServerNames } from "../mcp.js";
import {
  loadRoles,
  getRole,
  hasOwner,
  type UserRole,
} from "../roles.js";
import { canEditConfig, canManageRoles, canRequestChanges } from "../permissions.js";
import { getActiveWorkers } from "../changes/session.js";
import { listInstructionFiles } from "../configurationFiles.js";
import { getUserPreference } from "../userPreferences.js";
import { getVisibleRepos, canWriteRepo } from "../repoAccess.js";

interface HomeViewOptions {
  userId: string;
  ownerDisabled?: boolean;
}

export async function buildHomeView(options: HomeViewOptions): Promise<View> {
  const { userId, ownerDisabled } = options;
  const role = await getRole(userId);
  const userIsAdmin = canManageRoles(role);
  const userCanEdit = canEditConfig(role);
  const userIsDev = canRequestChanges(role);
  const hasAnOwner = await hasOwner();

  const blocks: (KnownBlock | Block)[] = [];

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
    blocks.push(...(await buildRoleManagementSection(userId, role)));
  }

  // Configuration section (only for admins/owner)
  if (userCanEdit) {
    blocks.push(...buildConfigurationSection());
  }

  // Active workers section (only for devs and higher)
  if (userIsDev) {
    blocks.push(...buildActiveWorkersSection());
  }

  // Settings section (visible to all, conditionally has content)
  blocks.push(...(await buildSettingsSection(userId)));

  // Status section (visible to all)
  blocks.push(...buildStatusSection(role));

  // Help section (visible to all)
  blocks.push(...buildHelpSection());

  // Spacer to prevent Slack client from cutting off the last block
  blocks.push(
    { type: "divider" },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: " " }],
    }
  );

  return {
    type: "home",
    blocks,
  };
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
  role: UserRole
): Promise<KnownBlock[]> {
  const roles = await loadRoles();
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
    roles.admins.length > 0
      ? roles.admins.map((id) => `<@${id}>`).join(", ")
      : "_None_";

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
  const devList =
    roles.devs.length > 0
      ? roles.devs.map((id) => `<@${id}>`).join(", ")
      : "_None_";

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

export function buildConfigurationSection(): KnownBlock[] {
  const files = listInstructionFiles();
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "Configuration",
      emoji: true,
    },
  });

  for (const file of files) {
    let statusLabel: string;
    let buttonLabel: string;

    if (file.hasOverride) {
      statusLabel = "Customized";
      buttonLabel = "Edit";
    } else if (file.hasDefault) {
      statusLabel = "Default";
      buttonLabel = "Customize";
    } else {
      statusLabel = "Not created";
      buttonLabel = "Create";
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:page_facing_up: \`${file.filename}\` — _${statusLabel}_`,
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: buttonLabel,
          emoji: true,
        },
        action_id: "edit_config_file",
        value: file.filename,
      },
    });
  }

  blocks.push({ type: "divider" });

  return blocks;
}

// Modal builders for configuration editing

const MAX_MODAL_TEXT_LENGTH = 3000;
const MAX_MODAL_TITLE_LENGTH = 24;

function truncateTitle(text: string): string {
  if (text.length <= MAX_MODAL_TITLE_LENGTH) return text;
  return text.slice(0, MAX_MODAL_TITLE_LENGTH - 1) + "…";
}

export function buildEditFileModal(filename: string, content: string): View {
  const title = truncateTitle(filename);

  if (content.length > MAX_MODAL_TEXT_LENGTH) {
    return {
      type: "modal",
      title: {
        type: "plain_text",
        text: title,
      },
      close: {
        type: "plain_text",
        text: "Close",
      },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:warning: This file is ${content.length} characters, which exceeds Slack's ${MAX_MODAL_TEXT_LENGTH} character limit for text inputs.\n\nPlease edit this file directly on the server at \`data/configuration/${filename}\`.`,
          },
        },
      ],
    };
  }

  return {
    type: "modal",
    callback_id: "edit_config_file_modal",
    private_metadata: filename,
    title: {
      type: "plain_text",
      text: title,
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
        type: "input",
        block_id: "file_content_block",
        element: {
          type: "plain_text_input",
          action_id: "file_content",
          multiline: true,
          initial_value: content,
        },
        label: {
          type: "plain_text",
          text: "File Content",
        },
      },
    ],
  };
}

function formatAccessTag(role: UserRole): string {
  return role === "member" ? "all" : `${role}+`;
}

export function buildStatusSection(role: UserRole): KnownBlock[] {
  const config = getConfig();
  const mcpServers = getConfiguredMcpServerNames();
  const showAccessTags = canRequestChanges(role); // dev+

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
  const visibleRepos = getVisibleRepos(role, config.repositories);
  const repoList = visibleRepos
    .map((r) => {
      let line = `• *${r.name}*: ${r.description}`;
      if (showAccessTags) {
        const readTag = formatAccessTag(r.access?.read ?? "member");
        if (canWriteRepo(role, r)) {
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

  // MCP Servers
  if (mcpServers.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:electric_plug: *MCP Servers:* ${mcpServers.join(", ")}`,
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

export function buildActiveWorkersSection(): KnownBlock[] {
  const workers = getActiveWorkers();
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
    };

    for (const worker of workers) {
      const emoji = statusEmoji[worker.status] || ":hourglass:";
      const statusLabel = worker.status.charAt(0).toUpperCase() + worker.status.slice(1);

      let text = `${emoji} *${worker.description}*\n`;
      text += `• Status: ${statusLabel}\n`;
      text += `• Branch: \`${worker.branch}\`\n`;
      text += `• Repo: ${worker.repo}\n`;
      text += `• By: <@${worker.userId}>`;

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

export function buildHelpSection(): KnownBlock[] {
  const config = getConfig();

  const triggerInstructions: string[] = [];

  triggerInstructions.push(
    `• *Reaction:* React to any message with :${config.reactions.trigger}: to ask about it`
  );

  if (config.directMessages.enabled) {
    triggerInstructions.push(
      "• *Direct Message:* Send me a DM with your question"
    );
  }

  if (config.mentions.enabled) {
    triggerInstructions.push(
      "• *Mention:* @mention me in any channel with your question"
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

async function buildSettingsSection(userId: string): Promise<KnownBlock[]> {
  const config = getConfig();

  // Only show settings button if there are configurable options
  if (config.reactions.responseType !== "directMessage") {
    return [];
  }

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Settings",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":gear: Manage your personal preferences.",
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "Settings",
          emoji: true,
        },
        action_id: "open_settings",
      },
    },
    { type: "divider" },
  ];
}

export async function buildSettingsModal(userId: string): Promise<View> {
  const config = getConfig();
  const dmOptOut = await getUserPreference(userId, "dmOptOut");

  const blocks: (KnownBlock | Block)[] = [];

  if (config.reactions.responseType === "directMessage") {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Response delivery*\nHow would you like to receive answers when you react with the trigger emoji?",
        },
      },
      {
        type: "actions",
        block_id: "response_delivery_block",
        elements: [
          {
            type: "radio_buttons",
            action_id: "response_delivery",
            initial_option: dmOptOut
              ? {
                  text: { type: "plain_text", text: "Ephemeral messages" },
                  description: { type: "plain_text", text: "Answers appear inline, visible only to you." },
                  value: "ephemeral",
                }
              : {
                  text: { type: "plain_text", text: "Direct Message (recommended)" },
                  description: { type: "plain_text", text: "Get a private DM thread to refine before sharing." },
                  value: "directMessage",
                },
            options: [
              {
                text: { type: "plain_text", text: "Direct Message (recommended)" },
                description: { type: "plain_text", text: "Get a private DM thread to refine before sharing." },
                value: "directMessage",
              },
              {
                text: { type: "plain_text", text: "Ephemeral messages" },
                description: { type: "plain_text", text: "Answers appear inline, visible only to you." },
                value: "ephemeral",
              },
            ],
          },
        ],
      }
    );
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No configurable settings available._",
      },
    });
  }

  return {
    type: "modal",
    callback_id: "settings_modal",
    title: {
      type: "plain_text",
      text: "Settings",
    },
    ...(config.reactions.responseType === "directMessage" && {
      submit: {
        type: "plain_text",
        text: "Save",
      },
    }),
    close: {
      type: "plain_text",
      text: config.reactions.responseType === "directMessage" ? "Cancel" : "Close",
    },
    blocks,
  };
}

// Modal builders for user selection

export function buildUserSelectModal(
  title: string,
  actionId: string,
  placeholder: string
): View {
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

export function buildRemoveUserModal(
  title: string,
  actionId: string,
  users: string[]
): View {
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
