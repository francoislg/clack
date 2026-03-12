import type { KnownBlock, Block } from "@slack/types";
import { convertMarkdownToSlack, splitForSlack } from "../claude/formatting.js";
import type { SubmitResponsePayload, Action, ResponseSection } from "../tools/types.js";

/** Slack Block Kit block array type — used by all block builders */
export type SlackBlocks = (KnownBlock | Block)[];

function answerSections(answer: string) {
  return splitForSlack(convertMarkdownToSlack(answer)).map((chunk) => ({
    type: "section" as const,
    text: { type: "mrkdwn" as const, text: chunk },
  }));
}

// ============================================================================
// Structured Response Rendering (new path — from submit_response tool)
// ============================================================================

/** Default button labels for each action type */
const DEFAULT_LABELS: Record<string, string> = {
  choice: "Select",
  followup: "Continue",
  send_to_thread: "Send to thread",
  change: "Start Change",
  config_update: "Apply Update",
  update: "Update",
};

/** Button styles for action types */
const ACTION_STYLES: Record<string, "primary" | "danger" | undefined> = {
  send_to_thread: "primary",
  change: "primary",
};

/** Map action type to Slack action_id */
function getActionId(action: Action): string {
  // Avoid collision with existing clack_update (Q&A context refresh)
  if (action.type === "update") return "clack_update_change";
  // Map to existing DM-first handler
  if (action.type === "send_to_thread") return "clack_dm_send_to_thread";
  return `clack_${action.type}`;
}

/** Encode button value with session ID and action-specific data */
function encodeActionValue(sessionId: string, action: Action): string {
  switch (action.type) {
    case "send_to_thread":
      return JSON.stringify({
        s: sessionId,
        ...(action.channel && { c: action.channel }),
        ...(action.thread_ts && { t: action.thread_ts }),
        ...(action._snapshotId && { sn: action._snapshotId }),
      });
    case "choice":
      return JSON.stringify({ s: sessionId, v: action.value, ...(action.workMode && { w: true }) });
    case "followup":
      return JSON.stringify({ s: sessionId, p: action.prompt });
    case "change":
    case "config_update":
    case "update":
      return JSON.stringify({ s: sessionId, r: action.ref });
  }
}

/** Decode a button value to extract sessionId */
export function decodeActionValue(value: string): { sessionId: string; ref?: string; choiceValue?: string; prompt?: string; hint?: string; workMode?: boolean; targetChannel?: string; targetThreadTs?: string; snapshotId?: string } {
  // Try JSON first
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.s === "string") {
        return {
          sessionId: obj.s,
          ref: typeof obj.r === "string" ? obj.r : undefined,
          choiceValue: typeof obj.v === "string" ? obj.v : undefined,
          prompt: typeof obj.p === "string" ? obj.p : undefined,
          hint: typeof obj.h === "string" ? obj.h : undefined,
          workMode: obj.w === true ? true : undefined,
          targetChannel: typeof obj.c === "string" ? obj.c : undefined,
          targetThreadTs: typeof obj.t === "string" ? obj.t : undefined,
          snapshotId: typeof obj.sn === "string" ? obj.sn : undefined,
        };
      }
    }
  } catch {
    // Not JSON — plain sessionId (backward compat)
  }
  return { sessionId: value };
}

/** Render sections from SubmitResponsePayload into Slack blocks */
function renderSections(sections: ResponseSection[]) {
  const blocks: Record<string, unknown>[] = [];
  for (const section of sections) {
    const text = section.title
      ? `*${section.title}*\n${section.body}`
      : section.body;
    // Split long sections to fit Slack limits
    const chunks = splitForSlack(convertMarkdownToSlack(text));
    for (const chunk of chunks) {
      blocks.push({
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: chunk },
      });
    }
  }
  return blocks;
}

/** Map an Action to a Slack button element */
function actionToButton(action: Action, sessionId: string, index: number) {
  const label = ("label" in action && action.label) || DEFAULT_LABELS[action.type] || action.type;
  const style = ACTION_STYLES[action.type];

  // Append index to action_id to guarantee uniqueness within a message.
  // Handlers use regex matching (e.g. /^clack_followup/) to route all variants.
  const button: Record<string, unknown> = {
    type: "button" as const,
    text: {
      type: "plain_text" as const,
      text: label,
      emoji: true,
    },
    action_id: `${getActionId(action)}_${index}`,
    value: encodeActionValue(sessionId, action),
  };

  if (style) {
    button.style = style;
  }

  return button;
}

/**
 * Build Slack blocks from a structured SubmitResponsePayload.
 * This is the new rendering path — Claude controls sections and actions.
 */
/**
 * Cast block builder output to the Slack API block array type.
 * Our block builders use Record<string, unknown> for flexibility; Slack's API
 * expects (KnownBlock | Block)[]. This centralizes the boundary cast.
 */
export function asSlackBlocks(blocks: Record<string, unknown>[]): SlackBlocks {
  return blocks as unknown as SlackBlocks;
}

export function getStructuredResponseBlocks(payload: SubmitResponsePayload, sessionId: string) {
  const blocks: Record<string, unknown>[] = [];

  // Prepend conversational preamble if present (shown to user, excluded from send_to_thread)
  if (payload.message) {
    const messageChunks = splitForSlack(convertMarkdownToSlack(payload.message));
    for (const chunk of messageChunks) {
      blocks.push({
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: chunk },
      });
    }
  }

  blocks.push(...renderSections(payload.sections));

  const actionBlocks = getResponseActionBlocks(payload.actions, sessionId);
  if (actionBlocks.length === 0) {
    return blocks;
  }

  return [
    ...blocks,
    { type: "divider" as const },
    ...actionBlocks,
  ];
}

/**
 * Build only the action button blocks for a response (no answer sections).
 * Used by streaming to append buttons without duplicating the answer text.
 */
export function getResponseActionBlocks(actions: Action[], sessionId: string) {
  // Filter out auto-executed actions — they fire immediately, no button needed
  const buttonActions = actions.filter(
    (a) => !("auto" in a && (a as { auto?: boolean }).auto === true)
  );

  if (buttonActions.length === 0) {
    return [];
  }

  // Slack allows max 5 buttons per actions block — split if needed
  const actionChunks: Action[][] = [];
  for (let i = 0; i < buttonActions.length; i += 5) {
    actionChunks.push(buttonActions.slice(i, i + 5));
  }

  let globalIndex = 0;
  return actionChunks.map((chunk) => ({
    type: "actions" as const,
    elements: chunk.map((action) => actionToButton(action, sessionId, globalIndex++)),
  }));
}


/**
 * Build Slack blocks for the accepted (public) response from structured sections.
 */
export function getStructuredAcceptedBlocks(sections: ResponseSection[]) {
  return renderSections(sections);
}

export function getAcceptedBlocks(answer: string) {
  return answerSections(answer);
}

export function getErrorBlocks(message: string) {
  return [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: `:x: ${message}`,
      },
    },
  ];
}

export function getErrorBlocksWithRetry(sessionId: string) {
  return [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: ":warning: Claude seems to have crashed, maybe try again?",
      },
    },
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          text: {
            type: "plain_text" as const,
            text: "🔄 Try Again",
            emoji: true,
          },
          action_id: "clack_retry",
          value: sessionId,
        },
      ],
    },
  ];
}


// ============================================================================
// Block Validation
// ============================================================================

const SLACK_SECTION_TEXT_LIMIT = 3000;
const SLACK_BUTTON_LABEL_LIMIT = 75;
const SLACK_MAX_BLOCKS = 50;

export interface BlockValidationError {
  field: string;
  message: string;
  currentLength: number;
  limit: number;
}

/**
 * Validate rendered Slack blocks against known Block Kit constraints.
 * Returns an empty array if valid, or an array of errors describing each violation.
 */
export function validateSlackBlocks(blocks: Record<string, unknown>[]): BlockValidationError[] {
  const errors: BlockValidationError[] = [];

  // Check total block count
  if (blocks.length > SLACK_MAX_BLOCKS) {
    errors.push({
      field: "blocks",
      message: `Total block count (${blocks.length}) exceeds the ${SLACK_MAX_BLOCKS}-block limit. Reduce the number of sections.`,
      currentLength: blocks.length,
      limit: SLACK_MAX_BLOCKS,
    });
  }

  let sectionIndex = 0;
  let actionsBlockIndex = 0;

  for (const block of blocks) {
    if (block.type === "section") {
      const textObj = block.text as { text?: string } | undefined;
      const text = textObj?.text ?? "";
      if (text.length > SLACK_SECTION_TEXT_LIMIT) {
        errors.push({
          field: `section[${sectionIndex}]`,
          message: `Section text (${text.length} chars) exceeds the ${SLACK_SECTION_TEXT_LIMIT}-char limit. Shorten the content.`,
          currentLength: text.length,
          limit: SLACK_SECTION_TEXT_LIMIT,
        });
      }
      sectionIndex++;
    } else if (block.type === "actions") {
      const elements = (block.elements ?? []) as Record<string, unknown>[];
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.type === "button") {
          const textObj = el.text as { text?: string } | undefined;
          const label = textObj?.text ?? "";
          if (label.length > SLACK_BUTTON_LABEL_LIMIT) {
            errors.push({
              field: `actions[${actionsBlockIndex}].button[${i}]`,
              message: `Button label "${label}" (${label.length} chars) exceeds the ${SLACK_BUTTON_LABEL_LIMIT}-char limit.`,
              currentLength: label.length,
              limit: SLACK_BUTTON_LABEL_LIMIT,
            });
          }
        }
      }
      actionsBlockIndex++;
    }
  }

  return errors;
}
