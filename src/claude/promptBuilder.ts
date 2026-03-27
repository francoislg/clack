import { getConfig } from "../config.js";
import { loadInstructions } from "../instructions.js";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { SlackImageFile, SlackFile } from "../slack/slackFileBase.js";
/** Subset of AskClaudeOptions needed for prompt construction. */
export interface PromptOptions {
  role?: UserRole;
  changesWorkflowEnabled?: boolean;
  workMode?: boolean;
  availableImages?: Map<string, SlackImageFile>;
  availableFiles?: Map<string, SlackFile>;
}

export function buildSystemPrompt(options?: PromptOptions): string {
  const role: UserRole = options?.role ?? "member";
  const changesWorkflowEnabled = options?.changesWorkflowEnabled ?? false;
  const config = getConfig();

  const variables: Record<string, string> = {
    BOT_NAME: config.slackApp?.name || "Clack",
  };

  return loadInstructions(role, {
    changesWorkflowEnabled,
    variables,
  });
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
  return messages.map((msg) => {
    let line = `${formatSpeaker(msg)}: ${msg.text}`;
    if (msg.imageFiles?.length) {
      const tags = msg.imageFiles.map((f) => `${f.name} (file_id: ${f.id})`).join(", ");
      line += `\n[attached images: ${tags}]`;
    }
    if (msg.files?.length) {
      const tags = msg.files.map((f) => `${f.name} (file_id: ${f.id}, type: ${f.mimetype})`).join(", ");
      line += `\n[attached files: ${tags}]`;
    }
    return line;
  }).join("\n\n");
}

function buildDeliveryContext(session: SessionContext): string | null {
  if (!session.triggerType) return null;

  const lines: string[] = ["DELIVERY CONTEXT:"];

  // DM-first: session has DM coordinates and an origin channel
  if (session.dmChannel && session.originChannel) {
    lines.push("- Mode: DM-first (reaction triggered, answer delivered via direct message)");
    lines.push("- The user sees your response in a private DM thread. They can reply to refine.");
    lines.push("- The response is NOT visible in the original channel — only the user can see it in this DM.");
    if (session.channelPostTs) {
      lines.push("- An answer was already shared to the original channel thread.");
    }
    lines.push("- `post_to` shares this DM answer to the original channel thread the reaction was on. `reject` dismisses.");
    lines.push("- You can also include `post_to` with explicit `channel` and `thread_ts` to share findings to a different thread (e.g., one the user shared via a Slack URL).");
    lines.push("- If the user asks to share/post to the channel (not the thread), use `post_to` with `auto: true` and no `thread_ts` — this posts as a top-level channel message.");
    lines.push("- Choose actions appropriate to your response. If your answer investigates or summarizes the thread content, include `post_to` so the user can share the findings back.");
  } else if (session.assistantOriginChannelId && !session.originChannel) {
    // Assistant side-panel: private chat panel, can share to channel
    lines.push("- Mode: Assistant side-panel");
    lines.push("- You are in the Slack assistant side-panel. The user sees your response in a private panel on the RIGHT side of their screen. On the LEFT side, they see a Slack channel.");
    lines.push("- The response is NOT visible in any channel — only the user can see it.");
    if (session.assistantCurrentChannelId) {
      lines.push(`- The user is currently viewing channel ${session.assistantCurrentChannelId}. When they say "here", "this channel", "latest messages", "what's being discussed", "summarize", "what do you see", etc., they are referring to that channel.`);
      lines.push(`- IMPORTANT: You CANNOT see the channel content unless you call \`fetch_channel_messages\` with channel ID ${session.assistantCurrentChannelId}. Always call it proactively when the user's question relates to the channel — do NOT tell the user to ask you to fetch it.`);
    }
    lines.push("- `post_to` shares this answer to the channel the user is viewing, as a top-level message.");
    lines.push("- You can also include `post_to` with explicit `channel` and `thread_ts` to share findings to a specific thread (e.g., one the user shared via a Slack URL).");
    lines.push("- If the user asks to post in the channel, use `post_to` with `auto: true` — this posts immediately without a button click.");
    lines.push("- Choose actions appropriate to your response. If your answer investigates or summarizes content from a channel or thread, include `post_to` so the user can share the findings back.");
  } else if (session.triggerType === "autoRespond") {
    // Auto-respond: automatically triggered response to a channel message
    lines.push("- Mode: Auto-respond (you have been automatically tasked to respond to this message)");
    lines.push("- Read the message carefully. It might be an alert to investigate, a question to answer, a notification to analyze, or something else entirely.");
    lines.push("- By default, your response is posted as a thread reply on the triggering message.");
    lines.push("- You can use `post_to` with `auto: true` to post a top-level channel message instead of (or in addition to) the thread reply.");
    lines.push("- Do NOT include `accept` or `reject` actions — they have no meaning here.");
  } else {
    // All non-DM-first modes: response is already where the user can see it
    if (session.triggerType === "reactions") {
      lines.push("- Mode: Thread (reaction triggered, answer posted in the channel thread)");
    } else if (session.triggerType === "directMessages") {
      lines.push("- Mode: Direct message (the user is chatting with you in a DM)");
    } else if (session.triggerType === "mentions") {
      lines.push("- Mode: Channel mention (the user @mentioned you in a channel)");
    }
    lines.push("- The response is already visible to the user. There is no separate destination to send it to.");
    lines.push("- Do NOT include `accept` or `reject` actions — they have no meaning here.");
    lines.push("- By default, do NOT include `post_to` — the answer is already visible in the thread.");
    lines.push("- Exception: if you investigated content from another thread or channel (e.g., the user shared a Slack message URL), include `post_to` with explicit `channel` and `thread_ts` so the user can share findings back to that thread.");
    lines.push("- If the user asks to post \"in the channel\", include `post_to` with `auto: true` and no `thread_ts` — this posts the content as a top-level message in the parent channel.");
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

  // Thread context first so Claude reads the conversation before the question
  if (session.threadContext.length > 0) {
    const contextIntro = `THREAD CONTEXT (previous messages in the Slack thread, in chronological order):
Messages may be attributed to specific users by name (e.g., [John Doe]) or as [User] if names are not available.
Messages marked [Clack Bot] are previous answers from you (this bot).
Use this context to understand the conversation flow and provide relevant answers.\n`;
    parts.push(contextIntro + formatThreadContext(session.threadContext));
  }

  // Delivery context — derived from session state (triggerType, dmChannel, etc.)
  const deliveryContext = buildDeliveryContext(session);
  if (deliveryContext) {
    parts.push(deliveryContext);
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
    lines.push(
      "",
      "To add more changes to this active worktree, use `request_update` (not `propose_change`).",
      "Only use `propose_change` if the user explicitly wants a separate, unrelated change on a different branch.",
    );
    parts.push(lines.join("\n"));
  }

  // GitHub MCP hint — Claude can use it for PR operations on any PR
  parts.push("GITHUB ACCESS: You have access to GitHub via MCP. You can merge, close, comment on, or review any PR — not just ones from active changes. Use GitHub MCP tools when the user asks about PR operations.");

  // Work mode hint — advisory only, does NOT change available tools
  if (options?.workMode) {
    if (session.activeChange) {
      parts.push(`WORK MODE: The user explicitly requested this as a work task. Since there is an active change in this thread, use request_update with auto: true on the update action in submit_response. If you cannot determine what change to make, ask for clarification via submit_response.`);
    } else {
      parts.push(`WORK MODE: The user explicitly requested this as a work task (not a question). Propose a code change using propose_change and set auto: true on the change action in submit_response. If you cannot determine what change to make, ask for clarification via submit_response.`);
    }
  }

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
        lines.push(`- [file] ${file.name} (file_id: ${fileId}, type: ${file.mimetype}) → use view_slack_file`);
      }
    }
    parts.push(lines.join("\n"));
  }

  // Original question
  parts.push(`QUESTION: ${session.originalQuestion}`);

  // Refinements (from button handlers within the current process lifetime)
  if (session.refinements.length > 0) {
    parts.push(`\nADDITIONAL INSTRUCTIONS FROM USER:\n${session.refinements.join("\n")}`);
  }

  return parts.join("\n");
}
