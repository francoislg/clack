import type { ConversationsRepliesResponse } from "@slack/web-api";
import type { KnownBlock, RichTextBlockElement, RichTextElement } from "@slack/types";
import type { ThreadMessage, SlackAttachment, SlackBlock, MessageReaction } from "../sessions.js";
import type { UserInfo } from "./userCache.js";
import { extractAttachments } from "./fileExtractor.js";

export type SlackMessage = NonNullable<ConversationsRepliesResponse["messages"]>[number];

// The auto-generated response types use `declare enum BlockType` which is
// nominally typed and rejects string literals. We use a union so that:
// - KnownBlock members suppress excess-property checking for typed block literals
// - The { type?: string } fallback accepts the auto-generated response types
type BlockLike = KnownBlock | { type?: string };

type MessageTextInput = Pick<SlackMessage, "text" | "attachments"> & {
  blocks?: BlockLike[];
};

const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set<KnownBlock["type"]>([
  "actions",
  "context",
  "context_actions",
  "divider",
  "file",
  "header",
  "image",
  "input",
  "markdown",
  "rich_text",
  "section",
  "table",
  "task_card",
  "plan",
  "video",
]);

function isKnownBlock(block: BlockLike): block is KnownBlock {
  return typeof block.type === "string" && KNOWN_BLOCK_TYPES.has(block.type);
}

function extractRichTextLeaf(el: RichTextElement): string {
  switch (el.type) {
    case "text":
      return el.text;
    case "link":
      return el.text ?? el.url;
    case "emoji":
      return `:${el.name}:`;
    case "user":
      return `<@${el.user_id}>`;
    case "channel":
      return `<#${el.channel_id}>`;
    case "usergroup":
      return `<!subteam^${el.usergroup_id}>`;
    case "broadcast":
      return `@${el.range}`;
    case "color":
      return el.value;
    case "date":
      return el.fallback ?? "";
    default:
      return "";
  }
}

function extractRichTextBlockElement(el: RichTextBlockElement): string {
  switch (el.type) {
    case "rich_text_section":
      return el.elements.map(extractRichTextLeaf).join("");
    case "rich_text_list":
      return el.elements
        .map((item, i) => {
          const text = item.elements.map(extractRichTextLeaf).join("");
          return el.style === "ordered" ? `${i + 1}. ${text}` : `• ${text}`;
        })
        .join("\n");
    case "rich_text_quote":
      return el.elements
        .map(extractRichTextLeaf)
        .join("")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "rich_text_preformatted":
      return "```\n" + el.elements.map((e) => ("text" in e ? e.text : "")).join("") + "\n```";
    default:
      return "";
  }
}

function extractBlockText(block: KnownBlock): string {
  switch (block.type) {
    case "section":
      return [block.text?.text, ...(block.fields?.map((f) => f.text) ?? [])]
        .filter(Boolean)
        .join("\n");
    case "header":
      return block.text.text;
    case "markdown":
      return block.text;
    case "rich_text":
      return block.elements.map(extractRichTextBlockElement).filter(Boolean).join("\n");
    case "context":
      return block.elements
        .filter(
          (e): e is Extract<(typeof block.elements)[number], { text: string }> =>
            "text" in e && typeof e.text === "string",
        )
        .map((e) => e.text)
        .join(" ");
    case "image":
      return block.alt_text;
    case "video":
      return block.title.text;
    default:
      return "";
  }
}

function extractBlocksText(blocks: BlockLike[]): string {
  return blocks.filter(isKnownBlock).map(extractBlockText).filter(Boolean).join("\n");
}

export function extractMessageText(msg: MessageTextInput): string {
  // Prefer blocks when present — they carry the full structured content.
  // msg.text is often a simplified notification fallback when blocks exist.
  if (msg.blocks?.length) {
    const blocksText = extractBlocksText(msg.blocks);
    if (blocksText) return blocksText;
  }
  return (
    msg.text ||
    msg.attachments
      ?.map((a) => a.text || a.fallback)
      .filter(Boolean)
      .join("\n") ||
    ""
  );
}

function extractReactions(rawReactions: SlackMessage["reactions"]): ThreadMessage["reactions"] {
  if (!rawReactions?.length) return undefined;
  const reactions: NonNullable<ThreadMessage["reactions"]> = [];
  for (const r of rawReactions) {
    if (r.name && r.users?.length) {
      reactions.push({ emoji: r.name, userIds: r.users });
    }
  }
  return reactions.length ? reactions : undefined;
}

export function buildThreadMessage(msg: SlackMessage, botUserId: string): ThreadMessage | null {
  if (
    !(msg.text || msg.blocks?.length || msg.attachments?.length || msg.files?.length) ||
    !(msg.user || msg.bot_id) ||
    !msg.ts
  ) {
    return null;
  }

  const blocks: SlackBlock[] | undefined = msg.blocks?.filter(
    (b): b is typeof b & SlackBlock => typeof b.type === "string",
  );
  const attachments: SlackAttachment[] | undefined = msg.attachments?.length
    ? msg.attachments.map((a) => ({
        ...(a.text && { text: a.text }),
        ...(a.fallback && { fallback: a.fallback }),
        ...(a.title && { title: a.title }),
        ...(a.pretext && { pretext: a.pretext }),
        ...(a.author_name && { author_name: a.author_name }),
        ...(a.fields?.length && {
          fields: a.fields.map((f) => ({
            ...(f.title && { title: f.title }),
            ...(f.value && { value: f.value }),
          })),
        }),
      }))
    : undefined;
  const reactions = extractReactions(msg.reactions);

  return {
    text: extractMessageText(msg) || "[attachment]",
    userId: (msg.user || msg.bot_id) as string,
    isBot: msg.user === botUserId || msg.bot_id !== undefined,
    ts: msg.ts as string,
    ...(blocks?.length && { blocks }),
    ...(attachments && { attachments }),
    ...extractAttachments(msg.files),
    ...(reactions && { reactions }),
  };
}

export function resolveReactionUsernames(
  reactions: MessageReaction[],
  userInfoMap: Map<string, UserInfo>,
): void {
  for (const r of reactions) {
    r.usernames = r.userIds.map((id) => {
      const info = userInfoMap.get(id);
      return info?.displayName ?? info?.username ?? id;
    });
  }
}

export interface ToolReactionEntry {
  emoji: string;
  users: string[];
}

export interface ToolMessageEntry {
  user: string;
  text: string;
  ts: string;
  is_bot: boolean;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  images?: Array<{ file_id: string; name: string }>;
  files?: Array<{ file_id: string; name: string; type: string }>;
  reactions?: ToolReactionEntry[];
}

export function threadMessageToToolOutput(m: ThreadMessage): ToolMessageEntry {
  return {
    user: m.displayName ?? m.username ?? m.userId,
    text: m.text,
    ts: m.ts,
    is_bot: m.isBot,
    ...(m.blocks?.length && { blocks: m.blocks }),
    ...(m.attachments?.length && { attachments: m.attachments }),
    ...(m.imageFiles?.length && {
      images: m.imageFiles.map((f) => ({ file_id: f.id, name: f.name })),
    }),
    ...(m.files?.length && {
      files: m.files.map((f) => ({
        file_id: f.id,
        name: f.name,
        type: f.mimetype,
      })),
    }),
    ...(m.reactions?.length && {
      reactions: m.reactions.map((r) => ({
        emoji: r.emoji,
        users: r.usernames ?? r.userIds,
      })),
    }),
  };
}
