import { getConfig } from "../config.js";
import type { McpServerRegistry, SkillPluginRegistry } from "../config.js";
import { LANGUAGE_METADATA, type Lang } from "../i18n/languages.js";
import { loadInstructions } from "../instructions.js";
import type { UserRole } from "../roles.js";
import { isChannellessChannelId } from "../channelless.js";
import type { SessionContext } from "../sessions.js";
import { triggerText, userContinuations } from "../sessions/selectors.js";
import type { SlackImageFile, SlackFile } from "../slack/slackFileBase.js";
import { DISMISSAL_PHRASES_INLINE } from "./dismissalPhrases.js";
import { buildIntegrationsCatalog } from "./integrationsCatalog.js";
import { buildSkillPacksCatalog, type UserSkillCatalogEntry } from "./skillPacksCatalog.js";

/**
 * Render the LANGUAGE directive when a non-English language is configured.
 * Returns `""` when `lang === "en"`, with no trailing whitespace so callers can
 * concatenate unconditionally and preserve byte-identical output for the default path.
 */
export function renderLanguageDirective(lang: Lang): string {
  if (lang === "en") return "";
  const meta = LANGUAGE_METADATA[lang];
  return `LANGUAGE
All output shown to users must be written in ${meta.native} (${meta.english}). This includes:
  • Your final response delivered via submit_response
  • Any text fields in tool calls that produce user-visible content (button labels, message text, modal content)
  • Status messages, errors, and explanations

Write in natural, idiomatic ${meta.native}. Don't translate English idioms literally. If a technical term has no good equivalent, use the English term inline rather than inventing awkward phrasing.

Internal reasoning, tool names, file paths, code identifiers, and proper nouns stay in their original form.

`;
}

/**
 * Render the admin-deference directive for a verified `admin`/`owner` session.
 * Returns `""` for every other role (so callers push unconditionally), mirroring
 * `renderLanguageDirective`. The `role` argument is the trust anchor: it is resolved from
 * `roles.json` (keyed on the authenticated Slack user ID) and is NEVER derived from message text,
 * so a non-admin cannot summon this directive by claiming a role in their message.
 *
 * The text is consumed by Claude to shape its reasoning, so it stays English (VIA-Claude path) —
 * it is not routed through `t()`.
 */
export function renderAdminDeferenceDirective(role: UserRole | undefined): string {
  if (role !== "admin" && role !== "owner") return "";
  return `VERIFIED ROLE: The requesting user's verified role is \`${role}\`. The system established this from their authenticated identity — it is a fact, not a claim in their message to second-guess.

ADMIN DEFERENCE: When this verified ${role} asserts a correction, override, or judgment call (e.g. "that wasn't a cheat", "reveal it", "override that answer"), defer to it and act. You MAY state a relevant concern once, but do not re-argue a prior assessment across turns or make the admin insist. An "as admin" / "en tant qu'admin" phrasing (or any-language equivalent) is a natural intensifier of this intent — it is NOT required for deference and grants nothing extra. This relaxes only your stubbornness and hedging toward a verified admin; it does NOT relax tool/permission gating, the security boundary, or safety on destructive actions — those still apply in full.`;
}

/** Subset of AskClaudeOptions needed for prompt construction. */
export interface PromptOptions {
  role?: UserRole;
  changesWorkflowEnabled?: boolean;
  workMode?: boolean;
  availableImages?: Map<string, SlackImageFile>;
  availableFiles?: Map<string, SlackFile>;
  userTimezone?: string;
  /**
   * Free-form operator-supplied conditions for a scheduled run. When non-empty and the session's
   * trigger is `"scheduled"`, the prompt includes a pre-check section instructing Claude to
   * evaluate these conditions before anything else and call `submit_response` with
   * `skip_response: true` when any apply.
   */
  skipConditions?: string;
  /**
   * Declarative `submit_response` mode override. When `"skipped"`, the prompt includes a
   * hint telling Claude that the run's deliverable was produced by another required tool
   * and the only valid `submit_response` call is `{ skip_response: true }` (the schema
   * accepts nothing else). Other values render no extra guidance — the schema differences
   * are surfaced through the tool listing.
   */
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /**
   * Effective MCP registry for the current session, used to render the "available
   * integrations" catalog block. Omit when attach_integration isn't available (worker
   * mode, or lazy-loading not configured yet) — the catalog is skipped entirely.
   */
  mcpRegistry?: McpServerRegistry;
  /**
   * Skill-plugin registry (from `config.skillPlugins`) used to render the
   * "AVAILABLE SKILL PACKS" catalog block. Omit to skip the section entirely.
   */
  skillPluginsRegistry?: SkillPluginRegistry;
  /**
   * Enabled user-authored skills (from `discoverUserSkills()` minus disabled entries)
   * rendered inline as a `USER SKILLS:` subsection of the "AVAILABLE SKILL PACKS"
   * catalog. Omit when the `userSkills` feature is disabled — the subsection is
   * skipped entirely.
   */
  userSkills?: ReadonlyArray<UserSkillCatalogEntry>;
  /**
   * Topic names to pre-attach for this session — surfaces `topics/<topic>/*.md` instruction
   * files (including plugin virtual defaults) in the assembled system prompt from turn 1.
   * Threaded from `AskClaudeOptions.preAttachedTopics`. See the `plugin-topic-instructions`
   * capability.
   */
  preAttachedTopics?: string[];
}

export function buildSystemPrompt(options?: PromptOptions): string {
  const role: UserRole = options?.role ?? "member";
  const changesWorkflowEnabled = options?.changesWorkflowEnabled ?? false;
  const config = getConfig();

  const variables: Record<string, string> = {
    BOT_NAME: config.slackApp?.name || "Clack",
  };

  const cascaded = loadInstructions(role, {
    changesWorkflowEnabled,
    variables,
    topics: options?.preAttachedTopics,
  });

  return renderLanguageDirective(config.language ?? "en") + cascaded;
}

function formatSpeaker(msg: { userId: string; username?: string; displayName?: string }): string {
  if (msg.displayName && msg.username) {
    return `[${msg.displayName} (@${msg.username} - ID: ${msg.userId})]`;
  }
  if (msg.displayName) return `[${msg.displayName} (ID: ${msg.userId})]`;
  if (msg.username) return `[@${msg.username} (ID: ${msg.userId})]`;
  return `[ID: ${msg.userId}]`;
}

function formatThreadContext(messages: SessionContext["threadContext"]): string {
  if (messages.length === 0) return "";
  return messages
    .map((msg) => {
      let line = `${formatSpeaker(msg)}: ${msg.text}`;
      if (msg.attachments?.length) {
        const parts = msg.attachments
          .map((a) => [a.pretext, a.title, a.text || a.fallback].filter(Boolean).join(" — "))
          .filter(Boolean);
        if (parts.length) {
          line += `\n[attachments: ${parts.join("; ")}]`;
        }
      }
      if (msg.imageFiles?.length) {
        const tags = msg.imageFiles.map((f) => `${f.name} (file_id: ${f.id})`).join(", ");
        line += `\n[attached images: ${tags}]`;
      }
      if (msg.files?.length) {
        const tags = msg.files
          .map((f) => `${f.name} (file_id: ${f.id}, type: ${f.mimetype})`)
          .join(", ");
        line += `\n[attached files: ${tags}]`;
      }
      if (msg.reactions?.length) {
        const parts = msg.reactions.map((r) => {
          const humanUsers: string[] = [];
          const botUsers: string[] = [];
          for (let i = 0; i < r.userIds.length; i++) {
            const label = r.usernames?.[i] ? `@${r.usernames[i]} (${r.userIds[i]})` : r.userIds[i];
            if (r.isBot?.[i]) {
              botUsers.push(label);
            } else {
              humanUsers.push(label);
            }
          }
          let desc = `:${r.emoji}:`;
          if (humanUsers.length > 0) desc += ` by ${humanUsers.join(", ")}`;
          if (botUsers.length > 0) desc += ` (bot: ${botUsers.join(", ")})`;
          if (humanUsers.length === 0 && botUsers.length === 0)
            desc += ` by ${r.userIds.join(", ")}`;
          return desc;
        });
        line += `\n[reactions: ${parts.join("; ")}]`;
      }
      return line;
    })
    .join("\n\n");
}

/** Guidance lines for the `submit_response.attention_level` dial: states the thread's current
 *  level and how to raise, lower, or disengage it. Used by tracking-capable triggers. */
function attentionLevelGuidance(session: SessionContext): string[] {
  const current = session.attentionLevel ?? "medium";
  return [
    `- This thread's current attention level is "${current}" — how eagerly you auto-respond to its future messages. You can adjust it via \`attention_level\` on submit_response: "always" (reply to everything), "high" (reply to nearly anything), "medium" (reply when plausibly relevant), "low" (reply only to direct address / clear follow-ups), or "off" (disengage — stop tracking entirely). Omit it to keep the level unchanged.`,
    `- Prefer to STAY: leave the level unchanged (omit \`attention_level\`) unless the conversation gives you a clear, concrete reason to move it. Raise it when the user is in a tight back-and-forth; lower it only when the thread is genuinely trailing off (slowing cadence, topic drift, replies no longer aimed at you). A single brief or one-shot reply is NOT a reason to lower — when in doubt, stay put.`,
    `- If the user's message reads as a conversation-ending dismissal (${DISMISSAL_PHRASES_INLINE}) or the conversation has clearly moved on, set \`attention_level: "off"\` to disengage. Err toward it — the user can @mention you to re-engage, so a false positive is cheap. A normal reply + \`attention_level: "off"\` (reply and disengage in one turn) is the natural pattern; it may also accompany \`skip_response: true\`.`,
    `- When you disengage, keep the reply short and avoid phrases like "just holler!" or "let me know anytime" — those contradict the disengage signal.`,
  ];
}

function buildDeliveryContext(session: SessionContext): string | null {
  if (!session.triggerType) return null;

  const lines: string[] = ["DELIVERY CONTEXT:"];

  // Skip the channel preamble for DMs (no channel context to mention) and for channelless
  // scheduled runs (the synthetic sentinel isn't a real channel — exposing it would just
  // confuse Claude).
  if (session.triggerType !== "directMessages" && !isChannellessChannelId(session.channelId)) {
    if (session.channelName) {
      lines.push(`- Channel: #${session.channelName} (ID: ${session.channelId})`);
    } else {
      lines.push(`- Channel ID: ${session.channelId}`);
    }
  }

  // DM-first: session has DM coordinates and an origin channel
  if (session.dmChannel && session.originChannel) {
    lines.push("- Mode: DM-first (reaction triggered, answer delivered via direct message)");
    lines.push("- The user sees your response in a private DM thread. They can reply to refine.");
    lines.push(
      "- The response is NOT visible in the original channel — only the user can see it in this DM.",
    );
    if (session.channelPostTs) {
      lines.push("- An answer was already shared to the original channel thread.");
    }
    lines.push(
      "- `post_to` shares this DM answer to the original channel thread the reaction was on. `reject` dismisses.",
    );
    lines.push(
      "- You can also include `post_to` with explicit `channel` and `thread_ts` to share findings to a different thread (e.g., one the user shared via a Slack URL).",
    );
    lines.push(
      "- If the user asks to share/post to the channel (not the thread), use `post_to` with `auto: true` and no `thread_ts` — this posts as a top-level channel message.",
    );
    lines.push(
      "- Choose actions appropriate to your response. If your answer investigates or summarizes the thread content, include `post_to` so the user can share the findings back.",
    );
  } else if (session.assistantOriginChannelId && !session.originChannel) {
    // Assistant side-panel: private chat panel, can share to channel
    lines.push("- Mode: Assistant side-panel");
    lines.push(
      "- You are in the Slack assistant side-panel. The user sees your response in a private panel on the RIGHT side of their screen. On the LEFT side, they see a Slack channel.",
    );
    lines.push("- The response is NOT visible in any channel — only the user can see it.");
    if (session.assistantCurrentChannelId) {
      const channelRef = session.channelName
        ? `#${session.channelName}`
        : session.assistantCurrentChannelId;
      lines.push(
        `- The user is currently viewing channel ${channelRef}. When they say "here", "this channel", "latest messages", "what's being discussed", "summarize", "what do you see", etc., they are referring to that channel.`,
      );
      lines.push(
        `- IMPORTANT: You CANNOT see the channel content unless you call \`fetch_channel_messages\` with channel ID ${session.assistantCurrentChannelId}. Always call it proactively when the user's question relates to the channel — do NOT tell the user to ask you to fetch it.`,
      );
    }
    lines.push(
      "- `post_to` shares this answer to the channel the user is viewing, as a top-level message.",
    );
    lines.push(
      "- You can also include `post_to` with explicit `channel` and `thread_ts` to share findings to a specific thread (e.g., one the user shared via a Slack URL).",
    );
    lines.push(
      "- If the user asks to post in the channel, use `post_to` with `auto: true` — this posts immediately without a button click.",
    );
    lines.push(
      "- Choose actions appropriate to your response. If your answer investigates or summarizes content from a channel or thread, include `post_to` so the user can share the findings back.",
    );
  } else if (session.triggerType === "scheduled") {
    // Scheduled: cron-triggered. Branch on whether the underlying cron job had a bound
    // channel (real Slack ID) or is channelless (delivery decided at fire time via post_to).
    if (isChannellessChannelId(session.channelId)) {
      lines.push(
        "- Mode: Scheduled message — channelless (this run has NO bound delivery channel)",
      );
      lines.push(
        "- Deliver via `submit_response({ deliver_to: [...] })`. Each entry is `{ channel, thread_ts?, response: { blocks } }` with an explicit `channel` — there is no bound channel to fall back to. Post to whichever channel makes sense based on the prompt's instructions.",
      );
      lines.push(
        "- Send the same content to several channels with repeated entries; post several messages to one channel with multiple entries sharing a `channel`; reply into a thread by setting `thread_ts`.",
      );
      lines.push(
        "- If no channel is a good fit, end with `submit_response({ skip_response: true })` and no `deliver_to` — that is a legitimate decision-not-to-post outcome, not an error. Do NOT set both `deliver_to` and `skip_response`.",
      );
    } else {
      lines.push("- Mode: Scheduled message (this is an automated cron-triggered execution)");
      lines.push(
        "- Your response is posted as a top-level message in the target channel via submit_response.",
      );
      lines.push(
        "- Do NOT include `post_to` for the target channel — submit_response already posts there top-level.",
      );
      lines.push("- Do NOT include `accept` or `reject` actions — they have no meaning here.");
      lines.push(
        "- You MAY include `post_to` ONLY if you need to post to a DIFFERENT channel or thread than the target.",
      );
    }
  } else if (session.triggerType === "autoRespond" || session.triggerType === "threadReply") {
    // Auto-respond / thread reply: automatically triggered response
    if (session.triggerType === "autoRespond") {
      lines.push(
        "- Mode: Auto-respond (you have been automatically tasked to respond to this message)",
      );
      lines.push(
        "- Read the message carefully. It might be an alert to investigate, a question to answer, a notification to analyze, or something else entirely.",
      );
      lines.push(
        "- By default, your response is posted as a thread reply on the triggering message.",
      );
      lines.push(
        "- If the auto-respond rule's extra context says to post directly to the channel (or if the answer is broadcast-style content meant for channel members), set `post_top_level: true` on submit_response. This delivers the response as a top-level channel message instead of a thread reply and deletes the thinking indicator. Use this instead of a `post_to` action for the simple top-level case — they would duplicate each other.",
      );
      lines.push(
        "- Reserve `post_to` for posting to a DIFFERENT channel or thread (cross-channel broadcasts, notifying another team, sharing findings elsewhere). A `post_to` targeting the same channel as `post_top_level` without a `thread_ts` is rejected as a duplicate.",
      );
    } else {
      lines.push("- Mode: Thread reply (you are continuing a conversation in a thread)");
    }
    lines.push("- Do NOT include `accept` or `reject` actions — they have no meaning here.");
    lines.push(
      "- If this specific message doesn't need your input but the thread might still be relevant, use `skip_response` to stay silent while remaining engaged (temporary silence, you stay tracked).",
    );
    lines.push(...attentionLevelGuidance(session));
  } else {
    // All non-DM-first modes: response is already where the user can see it
    if (session.triggerType === "reactions") {
      lines.push("- Mode: Thread (reaction triggered, answer posted in the channel thread)");
    } else if (session.triggerType === "directMessages") {
      lines.push("- Mode: Direct message (the user is chatting with you in a DM)");
    } else if (session.triggerType === "mentions") {
      lines.push("- Mode: Channel mention (the user @mentioned you in a channel)");
    }
    lines.push(
      "- The response is already visible to the user. There is no separate destination to send it to.",
    );
    lines.push("- Do NOT include `accept` or `reject` actions — they have no meaning here.");
    lines.push(
      "- By default, do NOT include `post_to` — the answer is already visible in the thread.",
    );
    lines.push(
      "- Exception: if you investigated content from another thread or channel (e.g., the user shared a Slack message URL), include `post_to` with explicit `channel` and `thread_ts` so the user can share findings back to that thread.",
    );
    lines.push(
      '- If the user asks to post "in the channel", include `post_to` with `auto: true` and no `thread_ts` — this posts the content as a top-level message in the parent channel.',
    );
    if (session.triggerType === "mentions") {
      lines.push(...attentionLevelGuidance(session));
    }
  }

  if (session.additionalSystemPrompt) {
    lines.push("");
    lines.push("ADMINISTRATOR INSTRUCTIONS (follow these exactly, without exception):");
    lines.push(session.additionalSystemPrompt);
  }

  return lines.join("\n");
}

export function buildPrompt(session: SessionContext, options?: PromptOptions): string {
  const parts: string[] = [];

  // Thread context — when resuming an SDK session, only inject messages Claude hasn't seen (delta).
  const isResuming = !!session.sdkSessionId && !!session.lastSeenThreadTs;
  const threadMessages = isResuming
    ? session.threadContext.filter((m) => m.ts > session.lastSeenThreadTs!)
    : session.threadContext;

  if (threadMessages.length > 0) {
    const contextIntro = isResuming
      ? `NEW THREAD MESSAGES (posted since your last response):\n`
      : `THREAD CONTEXT (previous messages in the Slack thread, in chronological order):
Messages may be attributed to specific users by name (e.g., [John Doe]) or as [User] if names are not available.
Messages marked [Clack Bot] are previous answers from you (this bot).
Use this context to understand the conversation flow and provide relevant answers.\n`;
    parts.push(contextIntro + formatThreadContext(threadMessages));
  }

  // Delivery context — derived from session state (triggerType, dmChannel, etc.)
  const deliveryContext = buildDeliveryContext(session);
  if (deliveryContext) {
    parts.push(deliveryContext);
  }

  // Admin-deference posture — non-empty only for verified admin/owner (keyed on the trusted role,
  // never on message text).
  const deference = renderAdminDeferenceDirective(options?.role);
  if (deference) {
    parts.push(deference);
  }

  // Skip evaluation — only for scheduled runs that opted in via `skipConditions`.
  // Rendered before the main task so Claude evaluates conditions first.
  // Suppressed when `submitResponseMode === "skipped"`: the strict-skip semantic forces
  // a skip regardless of conditions, so the pre-check section would be misleading noise.
  if (
    session.triggerType === "scheduled" &&
    options?.skipConditions &&
    options.skipConditions.length > 0 &&
    options.submitResponseMode !== "skipped"
  ) {
    parts.push(
      [
        "SKIP EVALUATION (run this FIRST before any other work):",
        "The operator has supplied skip conditions for this scheduled run. Evaluate each one — if ANY applies, decline to post by calling `submit_response` with `skip_response: true` and the required acknowledgment message. If NONE applies, proceed with the main task below as normal.",
        "",
        "Skip conditions:",
        options.skipConditions,
      ].join("\n"),
    );
  }

  // Skipped-mode hint — rendered when the cron job declares submitResponseMode: "skipped".
  // Tells Claude the run's deliverable was produced by another required tool and
  // `submit_response` is purely a run terminator. The schema enforces this structurally;
  // the hint is for Claude's situational understanding (and to discourage Claude from
  // attempting to "say something to the user" via blocks the schema would reject).
  if (session.triggerType === "scheduled" && options?.submitResponseMode === "skipped") {
    parts.push(
      [
        "RUN TERMINATOR — `submit_response` ONLY ACCEPTS `{ skip_response: true }`:",
        "This run's actual deliverable is produced by one of the required tools listed elsewhere in this prompt (e.g. a plugin's posting tool). `submit_response` here is purely the run terminator — its schema accepts ONLY `{ skip_response: true }` and rejects every other field (`blocks`, `actions`, `table`, `reactions`, `message`, `post_top_level`, `disengage`).",
        "Do NOT attempt to write a user-facing reply. After every required tool has been called, call `submit_response({ skip_response: true })` to end the run cleanly.",
      ].join("\n"),
    );
  }

  // Active change context — derived from the unified session's runtime state
  if (session.activeChange) {
    const ac = session.activeChange;
    const lines = [
      "ACTIVE CHANGE: There is an active code change in this thread.",
      `- Branch: ${ac.branch}`,
      `- Repository: ${ac.repo}`,
      `- Status: ${ac.status}`,
    ];
    if (ac.prUrl) {
      lines.push(`- PR: ${ac.prUrl}`);
    }
    if (options?.changesWorkflowEnabled) {
      lines.push(
        "",
        "To add more changes to this active worktree, use `request_update` (not `propose_change`).",
        "Only use `propose_change` if the user explicitly wants a separate, unrelated change on a different branch.",
      );
    } else {
      lines.push(
        "",
        "The Changes Workflow is not available in this context, so you cannot modify the change from here — the `request_update` and `propose_change` tools are not registered. Treat this block as read-only context: answer questions about the change, but if the user wants to modify it, tell them to @mention or DM the bot to request the update there.",
      );
    }
    parts.push(lines.join("\n"));
  }

  // GitHub access hint — always-available Changes Workflow tools (worker mode, Octokit-backed)
  // plus the lazy `github` MCP for broader ops. The MCP is listed in AVAILABLE INTEGRATIONS
  // below; attach it when the user needs ad-hoc read access (files, commits, issues) that the
  // built-in tools don't cover.
  parts.push(
    'GITHUB ACCESS: Clack\'s built-in tools (find_pull_requests, resolve_review_thread, worker-mode merge_pr / close_pr / ensure_pr) always work on any PR — use them first. For broader GitHub operations (reading files, commits, issues, comments), call `attach_integration("github")` to load the GitHub MCP on demand.',
  );

  // Work mode hint — advisory only, does NOT change available tools
  if (options?.workMode) {
    if (!options.changesWorkflowEnabled) {
      parts.push(
        `WORK MODE: The user explicitly requested this as a work task, but the Changes Workflow is not available in this context — \`propose_change\` and \`request_update\` are not registered here. Answer the user with submit_response, explain that they need to @mention or DM the bot to start a code change, and stop there.`,
      );
    } else if (session.activeChange) {
      parts.push(
        `WORK MODE: The user explicitly requested this as a work task. Since there is an active change in this thread, use request_update with auto: true on the update action in submit_response. If you cannot determine what change to make, ask for clarification via submit_response.`,
      );
    } else {
      parts.push(
        `WORK MODE: The user explicitly requested this as a work task (not a question). Propose a code change using propose_change and set auto: true on the change action in submit_response. If you cannot determine what change to make, ask for clarification via submit_response.`,
      );
    }
  }

  // Current date/time and user timezone — for time-aware responses
  const now = new Date();
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const tzParts = [
    `CURRENT DATE: ${dayOfWeek}, ${now.toISOString().slice(0, 10)} (${now.toISOString()})`,
  ];
  if (options?.userTimezone) {
    tzParts.push(`USER TIMEZONE: ${options.userTimezone}`);
    tzParts.push(
      "Use this timezone when interpreting local times the user mentions. Each tool that accepts times specifies its own timezone expectation in its description — follow that, not a blanket rule.",
    );
  }
  parts.push(tzParts.join("\n"));

  // Attachment metadata — let Claude know what images and files are available
  const hasImages = !!options?.availableImages?.size;
  const hasFiles = !!options?.availableFiles?.size;
  if (hasImages || hasFiles) {
    const lines = [
      "ATTACHED FILES:",
      "The following file(s) are available from the current message or thread. You MUST view each attachment listed below BEFORE answering — do not skip or summarize without viewing first.",
      "Use `view_slack_image` for images and `view_slack_file` for other files (PDFs, text, etc.).",
      "Note: When you fetch Slack messages (via fetch_slack_message or fetch_channel_messages), those results may also contain attachments — use the appropriate viewing tool on their file_id.",
    ];
    if (hasImages) {
      for (const [fileId, img] of options!.availableImages!) {
        lines.push(`- [image] ${img.name} (file_id: ${fileId}) → use view_slack_image`);
      }
    }
    if (hasFiles) {
      for (const [fileId, file] of options!.availableFiles!) {
        lines.push(
          `- [file] ${file.name} (file_id: ${fileId}, type: ${file.mimetype}) → use view_slack_file`,
        );
      }
    }
    parts.push(lines.join("\n"));
  }

  if (options?.mcpRegistry) {
    const catalog = buildIntegrationsCatalog(options.mcpRegistry);
    if (catalog.length > 0) parts.push(catalog);
  }

  if (options?.skillPluginsRegistry || options?.userSkills) {
    const catalog = buildSkillPacksCatalog(options.skillPluginsRegistry, options.userSkills);
    if (catalog.length > 0) parts.push(catalog);
  }

  parts.push(`QUESTION: ${triggerText(session)}`);

  // Continuations (refinements / choices / followups). `source: "choice"` messages
  // render as "The user chose: ${text}" — preserved from the pre-unified-log format.
  const continuations = userContinuations(session);
  if (continuations.length > 0) {
    const rendered = continuations.map((m) =>
      m.source === "choice" ? `The user chose: ${m.text}` : m.text,
    );
    parts.push(`\nADDITIONAL INSTRUCTIONS FROM USER:\n${rendered.join("\n")}`);
  }

  return parts.join("\n");
}
