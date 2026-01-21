import type { View, KnownBlock, Block } from "@slack/types";
import { getConfig } from "../config.js";
import { getConfiguredMcpServerNames } from "../mcp.js";
import {
  loadRoles,
  getRole,
  hasOwner,
  isAdmin,
  type UserRole,
} from "../roles.js";

interface HomeViewOptions {
  userId: string;
  ownerDisabled?: boolean;
}

export async function buildHomeView(options: HomeViewOptions): Promise<View> {
  const { userId, ownerDisabled } = options;
  const role = await getRole(userId);
  const userIsAdmin = await isAdmin(userId);
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

  // Status section (visible to all)
  blocks.push(...buildStatusSection());

  // Help section (visible to all)
  blocks.push(...buildHelpSection());

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

export function buildStatusSection(): KnownBlock[] {
  const config = getConfig();
  const mcpServers = getConfiguredMcpServerNames();

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

  // Repositories
  const repoList = config.repositories
    .map((r) => `• *${r.name}*: ${r.description}`)
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
