import type { Config, ThinkingFeedbackConfig, TriggerChangesWorkflowConfig } from "../../config.js";
import type { SchemaFor } from "./configSchemaTypes.js";

const thinkingBlock = (where: string): SchemaFor<ThinkingFeedbackConfig> => ({
  type: "object",
  description: `Thinking feedback shown during ${where} sessions.`,
  required: false,
  fields: {
    type: { type: "enum", description: "How to show progress.", enum: ["message", "emoji"] },
    emoji: { type: "string", description: "Emoji name when type is 'emoji'.", required: false },
  },
});

const triggerCwBlock = (where: string): SchemaFor<TriggerChangesWorkflowConfig> => ({
  type: "object",
  description: `Per-trigger Changes Workflow gate for ${where}.`,
  required: false,
  fields: { enabled: { type: "boolean", description: "Allow Changes Workflow via this trigger." } },
});

export const CONFIG_SCHEMA: SchemaFor<Config> = {
  type: "object",
  description: "Clack runtime configuration (data/config.json).",
  fields: {
    slack: {
      type: "object",
      description:
        "Slack workspace integration. botToken/appToken/signingSecret are loaded from data/auth/slack.json — only the two boolean toggles below come from config.json.",
      fields: {
        botToken: {
          type: "string",
          description: "Bot token (xoxb-…). Lives in data/auth/slack.json, NOT config.json.",
        },
        appToken: {
          type: "string",
          description: "App-level token (xapp-…). Lives in data/auth/slack.json.",
        },
        signingSecret: {
          type: "string",
          description: "Signing secret. Lives in data/auth/slack.json.",
        },
        fetchAndStoreUsername: {
          type: "boolean",
          description: "Cache real Slack display names in data/state/usernames.json.",
          default: false,
        },
        sendErrorsAsDM: {
          type: "boolean",
          description: "DM the triggering user when Clack errors out.",
          default: false,
        },
      },
    },
    slackApp: {
      type: "object",
      description: "Cosmetic metadata for the Slack app manifest used during setup.",
      required: false,
      fields: {
        name: { type: "string", description: "Display name.", default: "Clack" },
        description: {
          type: "string",
          description: "Slack app card tagline.",
          default: "Ask questions about your codebase using reactions",
        },
        backgroundColor: {
          type: "string",
          description: "Hex color for the Slack app card (e.g. #4A154B).",
          default: "#4A154B",
        },
      },
    },
    reactions: {
      type: "object",
      description: "Reaction trigger configuration.",
      fields: {
        trigger: {
          type: "string",
          description: "Emoji name (no colons) that triggers a Q&A session.",
          default: "robot_face",
        },
        stop: {
          type: "string",
          description: "Emoji that cancels in-flight Claude work. Null/empty disables.",
          default: "octagonal_sign",
          nullable: true,
          required: false,
        },
        queuedFollowup: {
          type: "string",
          description: "Emoji added when a follow-up is queued onto an in-flight run.",
          default: "eyes",
          nullable: true,
          required: false,
        },
        thinking: thinkingBlock("reaction-triggered"),
        changesWorkflow: {
          type: "object",
          description: "Per-trigger Changes Workflow gate for reactions.",
          required: false,
          fields: {
            enabled: { type: "boolean", description: "Allow Changes Workflow via reactions." },
            trigger: {
              type: "string",
              description: "Optional override emoji that triggers Changes Workflow vs Q&A.",
              required: false,
            },
          },
        },
      },
    },
    directMessages: {
      type: "object",
      description: "Direct-message trigger configuration.",
      fields: {
        enabled: { type: "boolean", description: "Enable DM trigger.", default: false },
        dmType: {
          type: "string",
          description:
            'Slack DM transport: "assistant" (default — uses the Agents & Assistants API) or "classic" (uses the low-level message.im event). Changing this requires a restart AND a manifest re-upload.',
          required: false,
        },
        thinking: thinkingBlock("DM-triggered"),
        changesWorkflow: triggerCwBlock("DMs"),
      },
    },
    mentions: {
      type: "object",
      description: "@mention trigger configuration.",
      fields: {
        enabled: { type: "boolean", description: "Enable @mention trigger.", default: false },
        thinking: thinkingBlock("@mention-triggered"),
        changesWorkflow: triggerCwBlock("@mentions"),
      },
    },
    autoRespond: {
      type: "object",
      description: "Workspace-global auto-respond toggle.",
      required: false,
      fields: {
        enabled: { type: "boolean", description: "Master switch for auto-respond." },
      },
    },
    assistant: {
      type: "object",
      description:
        "Optional overrides for the Slack Assistant pane greeting and suggested prompts.",
      required: false,
      fields: {
        greeting: {
          type: "string",
          description: "Greeting message. Falls back to t('assistant.greeting').",
          required: false,
        },
        suggestedPrompts: {
          type: "array",
          description: "Suggested-prompt chips. Max 4; fully replaces defaults.",
          required: false,
          items: {
            type: "object",
            description: "One suggested prompt.",
            fields: {
              title: { type: "string", description: "Chip label." },
              message: { type: "string", description: "Message sent when the chip is clicked." },
            },
          },
        },
      },
    },
    taskCards: {
      type: "object",
      description: "Tool task-card rendering options.",
      required: false,
      fields: {
        maxDetailsPerGroup: {
          type: "number",
          description: "Cap on detail lines per grouped tool task card.",
          default: 5,
          required: false,
        },
      },
    },
    repositories: {
      type: "array",
      description: "Git repositories Clack can read and (optionally) modify.",
      items: {
        type: "object",
        description: "One repository entry.",
        fields: {
          name: { type: "string", description: "Short id used in Slack and the Home Tab." },
          url: { type: "string", description: "Git URL (HTTPS or SSH)." },
          description: { type: "string", description: "One-line description shown to users." },
          branch: {
            type: "string",
            description: "Default branch to track.",
            default: "main",
            required: false,
          },
          access: {
            type: "object",
            description: "Per-repo role thresholds for read/write access.",
            required: false,
            fields: {
              read: {
                type: "enum",
                description: "Minimum role to read this repo.",
                enum: ["member", "dev", "admin", "owner"],
                required: false,
              },
              write: {
                type: "enum",
                description: "Minimum role to make changes in this repo.",
                enum: ["member", "dev", "admin", "owner"],
                required: false,
              },
            },
          },
          worktreeBasePath: {
            type: "string",
            description: "Override location for Changes Workflow worktrees.",
            required: false,
          },
          mergeStrategy: {
            type: "enum",
            description: "Merge strategy used when Clack merges PRs.",
            enum: ["squash", "merge", "rebase"],
            required: false,
          },
        },
      },
    },
    git: {
      type: "object",
      description: "Git fetch and clone behavior.",
      fields: {
        pullIntervalMinutes: {
          type: "number",
          description: "How often Clack pulls each tracked repo.",
          default: 60,
        },
        shallowClone: {
          type: "boolean",
          description: "Clone with --depth (cheaper, no history).",
          default: true,
        },
        cloneDepth: { type: "number", description: "Depth used when shallowClone.", default: 1 },
      },
    },
    sessions: {
      type: "object",
      description: "Q&A session lifecycle.",
      fields: {
        cleanupIntervalMinutes: {
          type: "number",
          description: "How often to sweep expired sessions.",
          default: 60,
        },
      },
    },
    claudeCode: {
      type: "object",
      description: "Claude Code SDK runtime options.",
      fields: {
        model: {
          type: "string",
          description: "Model alias ('sonnet', 'opus') or concrete model ID.",
          default: "sonnet",
          required: false,
        },
        workerModel: {
          type: "string",
          description:
            "Model for worker-mode (worktree) runs — alias or concrete model ID. Falls back to 'model' when unset.",
          required: false,
        },
        preAnalysisModel: {
          type: "string",
          description: [
            "Model for the auto-respond pre-analysis classifier — alias or concrete model ID.",
            "This gate runs on every message in a rule-covered channel, so it is the",
            "highest-frequency model call; a cheaper model cuts cost but can degrade",
            "respond/skip accuracy. Defaults to 'sonnet'.",
          ].join(" "),
          required: false,
        },
        watchMcpConfig: {
          type: "boolean",
          description: "Reload mcp.json on disk changes without restarting Clack.",
          default: false,
          required: false,
        },
      },
    },
    changesWorkflow: {
      type: "object",
      description: "Changes Workflow (Slack-driven PR creation) configuration.",
      required: false,
      fields: {
        enabled: { type: "boolean", description: "Master switch for the Changes Workflow." },
        timeoutMinutes: {
          type: "number",
          description: "Hard timeout for a single worker run.",
          required: false,
        },
        additionalAllowedTools: {
          type: "array",
          description: "Extra Claude Code tools to allow in the worker.",
          required: false,
          items: { type: "string", description: "Tool name (e.g. 'WebFetch')." },
        },
        sessionExpiryHours: {
          type: "number",
          description: "How long change-session records survive after completion.",
          required: false,
        },
        monitoringIntervalMinutes: {
          type: "number",
          description: "How often the background PR-status monitor runs.",
          required: false,
        },
        reusableFolders: {
          type: "object",
          description: "Reusable worker-pool model. Disabled → fresh worktree per change.",
          required: false,
          fields: {
            enabled: { type: "boolean", description: "Turn on the reusable pool." },
            minimumProvisioned: {
              type: "number",
              description: "Workers warmed at boot per repo.",
              default: 0,
              required: false,
            },
            maxConcurrent: {
              type: "number",
              description: "Hard cap on pool size per repo.",
              default: 3,
              required: false,
            },
            maxQueueDepth: {
              type: "number",
              description: "FIFO queue bound per repo before rejecting requests.",
              default: 5,
              required: false,
            },
            idleReleaseHours: {
              type: "number",
              description: "Detach idle session-bound workers after this many hours.",
              default: 24,
              required: false,
            },
            dirtyTrackedQuarantine: {
              type: "boolean",
              description: "Quarantine dirty workers instead of branch-switching.",
              default: true,
              required: false,
            },
          },
        },
        maxActiveChangesPerUser: {
          type: "number",
          description: "Cap on simultaneously-executing changes per user. 0 disables.",
          default: 1,
          required: false,
        },
        requirePRReviewers: {
          type: "boolean",
          description:
            "Request Claude-chosen reviewers on PRs the worker opens (excludes the author). Intent only — reviewer failures never fail PR creation.",
          default: false,
          required: false,
        },
      },
    },
    cron: {
      type: "object",
      description:
        "Cron scheduler + user-facing scheduling tools. The tick loop runs whenever 'enabled' is not false; user-facing MCP tools require 'userSchedules: true' on top of that.",
      required: false,
      fields: {
        enabled: {
          type: "boolean",
          description:
            "Master switch for the cron tick loop. When false, no job — user-created or plugin-managed — fires. Plugins that depend on the scheduler refuse to load.",
          default: true,
          required: false,
        },
        userSchedules: {
          type: "boolean",
          description:
            "Expose the user-facing scheduling MCP tools (create_scheduled_message, reminders, etc.) and the Home Tab user-schedules section. Requires 'enabled' to be true.",
          default: false,
          required: false,
        },
        maxRunHistory: {
          type: "number",
          description: "Max execution records retained per scheduled job in runs[].",
          default: 50,
          required: false,
        },
        catchUp: {
          type: "object",
          description:
            "Boot-time catch-up: plugins with a delayed-boot handler are dispatched after this settle delay so they can recover cron fires missed while Clack was down.",
          required: false,
          fields: {
            delayMinutes: {
              type: "number",
              description:
                "Minutes between cron-scheduler start and delayed-boot hook dispatch. Integer >= 0; 0 dispatches immediately.",
              default: 3,
              required: false,
            },
          },
        },
      },
    },
    backup: {
      type: "object",
      description:
        "Daily state backup. At local midnight a dedicated scheduler copies the configured folders into data/backups/{YYYY-MM-DD}/. Additive (never pruned).",
      required: false,
      fields: {
        enabled: {
          type: "boolean",
          description: "Master switch. When false, no scheduler is armed and nothing is written.",
          default: true,
          required: false,
        },
        folders: {
          type: "array",
          description:
            "Folders (relative to data/) to snapshot. Extensible; unsafe entries (empty, '.', absolute, or targeting the backups tree) are rejected at boot.",
          items: { type: "string", description: "A data/-relative folder name, e.g. 'state'." },
          default: ["state"],
          required: false,
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone for the midnight fire and the {date} label. Invalid zones fail boot.",
          default: "America/Montreal",
          required: false,
        },
      },
    },
    threadAutoRespond: {
      type: "boolean",
      description: "Auto-respond to thread replies in existing sessions.",
      default: true,
      required: false,
    },
    threadAutoRespondMaxAgeMinutes: {
      type: "number",
      description: "Disengage thread auto-respond if the trigger is older than N minutes.",
      default: 60,
      required: false,
    },
    plugins: {
      type: "array",
      description: "Clack plugin names to load at startup.",
      required: false,
      items: { type: "string", description: "Plugin name (matches src/plugins/<name>/)." },
    },
    mcpServers: {
      type: "record",
      description: "Clack-owned MCP server registry, keyed by server name.",
      required: false,
      entries: {
        type: "object",
        description: "One MCP server's Clack metadata.",
        fields: {
          alwaysLoad: {
            type: "boolean",
            description: "Attach at session start (true) vs. lazy-load via attach_integration.",
          },
          description: {
            type: "string",
            description: "One-line reason Claude should use this integration.",
          },
          toolMapping: {
            type: "object",
            description: "Override pointing several servers at one shared tool-mapping file.",
            required: false,
            fields: {
              name: { type: "string", description: "Bare tool-mapping filename (without .json)." },
              label: {
                type: "string",
                description: "Environment suffix appended to the group banner.",
                required: false,
              },
            },
          },
        },
      },
    },
    skillPlugins: {
      type: "record",
      description: "Skill-plugin registry, keyed by directory name under data/skill-plugins/.",
      required: false,
      entries: {
        type: "object",
        description: "One skill plugin's metadata.",
        fields: {
          lazyLoad: {
            type: "boolean",
            description: "true → discover/load on demand; false → eager-load at session start.",
          },
          description: {
            type: "string",
            description: "Catalog description (required when lazyLoad is true).",
          },
        },
      },
    },
    userSkills: {
      type: "object",
      description: "Toggle for the user-created skills feature.",
      required: false,
      fields: {
        enabled: {
          type: "boolean",
          description: "false (or absent) → fully inert (no tools, no Home Tab section).",
        },
      },
    },
    submitResponse: {
      type: "object",
      description: "Per-installation tuning for submit_response.",
      required: false,
      fields: {
        maxAdditionalMessages: {
          type: "number",
          description: "Cap on additional_messages[] length. Range [1, 10].",
          default: 5,
        },
      },
    },
    admin: {
      type: "object",
      description: "Admin-specific tuning.",
      required: false,
      fields: {
        additionalWords: {
          type: "array",
          description:
            "Extra keywords that, in a user's latest message, invoke admin authority (added to the built-in list). Each entry must be at least 3 characters.",
          items: { type: "string", description: "An admin-claim keyword (e.g. 'sudo')." },
        },
      },
    },
    tester: {
      type: "object",
      description:
        "Tester feature ('test this PR' runs). Fully inert when absent or disabled. Requires the Playwright MCP sidecar container to be deployed.",
      required: false,
      fields: {
        enabled: {
          type: "boolean",
          description: "Enable tester runs (run_test action tool + tester toolbelt).",
          default: false,
        },
        sidecarUrl: {
          type: "string",
          description:
            "URL of the Playwright MCP sidecar's HTTP endpoint (e.g. http://clack-playwright:8931/mcp). Required when enabled.",
          required: false,
        },
        recordingsDir: {
          type: "string",
          description:
            "Mount point of the shared recordings volume in the main container. Required when enabled.",
          required: false,
        },
        appHost: {
          type: "string",
          description:
            "Hostname of the main Clack container as seen from the sidecar (shared Docker network).",
          default: "clack",
          required: false,
        },
        maxConcurrent: {
          type: "number",
          description: "Max simultaneous tester runs (each adds a browser + app dev server).",
          default: 1,
          required: false,
        },
        dockerProxyUrl: {
          type: "string",
          description:
            "URL of the restricted docker-socket-proxy used to run per-repo tester services (e.g. http://clack-docker-proxy:2375). Required only when a repo declares tester_services.json.",
          required: false,
        },
        servicesBudgetMb: {
          type: "number",
          description:
            "Ceiling on the summed memoryMb of a repo's declared tester services; runs exceeding it abort before provisioning. Deploy scripts reserve this amount out of the clack container's memory cap.",
          default: 0,
          required: false,
        },
        serviceImageAllowlist: {
          type: "array",
          description:
            "Exact-match allowlist of images tester services may run. A declared service whose image is not listed aborts the run.",
          items: { type: "string", description: "An allowed image reference (e.g. mysql:8)." },
          required: false,
        },
      },
    },
    language: {
      type: "enum",
      description: "Workspace-global user-facing language (BCP-47 short code).",
      enum: ["en", "fr"],
      default: "en",
      required: false,
    },
    allowPublicSearch: {
      type: "boolean",
      description:
        "Opt-in workspace keyword search. Adds the search:read.public bot scope and the search_messages tool. Enabling requires re-uploading the manifest AND reinstalling the app to the workspace.",
      default: false,
      required: false,
    },
  },
};
