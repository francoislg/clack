import type {
  KnownBlock,
  Block as SlackRawBlock,
  ActionsBlock,
  Button,
  DividerBlock,
  SectionBlock,
} from "@slack/types";
import type { AuthoredTableBlock, Block } from "./blockSchema.js";
import { prepareBlocks, prepareTable } from "./blockPrepare.js";
import type { BlockValidationError } from "./blockValidate.js";
import type { SubmitResponsePayload, Action } from "../tools/types.js";
import { t } from "../i18n/t.js";

/** Slack Block Kit block array type — used by all block builders */
export type SlackBlocks = (KnownBlock | SlackRawBlock)[];

// ============================================================================
// Structured Response Rendering (new path — from submit_response tool)
// ============================================================================

/** Default button labels for each action type, resolved at call time so the
 * active language wins (helpers cannot be called at module init — `t()` reads
 * `getConfig()` which may not be loaded yet). */
function defaultActionLabel(actionType: Action["type"]): string {
  switch (actionType) {
    case "choice":
      return t("blocks.action_label_choice");
    case "followup":
      return t("blocks.action_label_followup");
    case "post_to":
      return t("blocks.action_label_post_to");
    case "change":
      return t("blocks.action_label_change");
    case "config_update":
      return t("blocks.action_label_config_update");
    case "update":
      return t("blocks.action_label_update");
  }
}

/** Button styles for action types */
const ACTION_STYLES: Record<string, "primary" | "danger" | undefined> = {
  post_to: "primary",
  change: "primary",
};

/** Map action type to Slack action_id */
function getActionId(action: Action): string {
  // Avoid collision with existing clack_update (Q&A context refresh)
  if (action.type === "update") return "clack_update_change";
  if (action.type === "post_to") return "clack_post_to";
  return `clack_${action.type}`;
}

/** Encode button value with session ID and action-specific data */
function encodeActionValue(sessionId: string, action: Action): string {
  switch (action.type) {
    case "post_to":
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

/** Wire shape produced by encodeActionValue; all fields optional at the wire level. */
interface EncodedActionValue {
  s?: string;
  r?: string;
  v?: string;
  p?: string;
  h?: string;
  w?: boolean;
  c?: string;
  t?: string;
  sn?: string;
}

function tryParseEncodedActionValue(value: string): EncodedActionValue | null {
  try {
    const raw = JSON.parse(value);
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      return raw;
    }
  } catch {
    // Not JSON — fall through
  }
  return null;
}

/** Decode a button value to extract sessionId */
export function decodeActionValue(value: string): {
  sessionId: string;
  ref?: string;
  choiceValue?: string;
  prompt?: string;
  hint?: string;
  workMode?: boolean;
  targetChannel?: string;
  targetThreadTs?: string;
  snapshotId?: string;
} {
  const obj = tryParseEncodedActionValue(value);
  if (obj && typeof obj.s === "string") {
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
  return { sessionId: value };
}

/** Map an Action to a Slack button element */
function actionToButton(action: Action, sessionId: string, index: number): Button {
  const label = ("label" in action && action.label) || defaultActionLabel(action.type);
  const style = ACTION_STYLES[action.type];

  // Append index to action_id to guarantee uniqueness within a message.
  // Handlers use regex matching (e.g. /^clack_followup/) to route all variants.
  const button: Button = {
    type: "button",
    text: {
      type: "plain_text",
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
 * Bridge cast at the Slack API boundary for places that still build block
 * arrays as record-shaped values. New code should type blocks properly and
 * pass them directly.
 */
export function asSlackBlocks(blocks: SlackBlocks): SlackBlocks {
  return blocks;
}

/**
 * Build only the action button blocks for a response (no answer content).
 * Used by streaming to append buttons without duplicating the answer text,
 * and by the main renderer to append buttons after content blocks.
 */
export function getResponseActionBlocks(actions: Action[], sessionId: string): ActionsBlock[] {
  // Filter out auto-executed actions — they fire immediately, no button needed
  const buttonActions = actions.filter(
    (a) => !("auto" in a && (a as { auto?: boolean }).auto === true),
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
  return actionChunks.map(
    (chunk): ActionsBlock => ({
      type: "actions",
      elements: chunk.map((action) => actionToButton(action, sessionId, globalIndex++)),
    }),
  );
}

// ============================================================================
// Claude-authored block rendering (new path — blocks-based)
// ============================================================================

/**
 * Build the Slack Block Kit output for a submit_response payload:
 *   - Prepend `message` preamble as a section block (if present).
 *   - Include Claude-authored `blocks` (after markdown conversion + splits).
 *   - Append the optional `table` (sibling parameter — Slack always renders
 *     tables at the bottom of the message, so we place it after content but
 *     before action buttons; either ordering renders identically).
 *   - Append action buttons with a divider separator.
 *
 * Validation is the caller's responsibility and should run on this output
 * (so the 50-block total includes action blocks).
 */
export function getStructuredResponseBlocks(
  payload: SubmitResponsePayload,
  sessionId: string,
): SlackBlocks {
  const out: SlackBlocks = [];

  if (payload.message) {
    const preamble: SectionBlock = {
      type: "section",
      text: { type: "mrkdwn", text: payload.message },
    };
    out.push(preamble);
  }

  for (const b of prepareBlocks(payload.blocks)) {
    out.push(b);
  }

  if (payload.table) {
    out.push(prepareTable(payload.table));
  }

  const actionBlocks = getResponseActionBlocks(payload.actions, sessionId);
  if (actionBlocks.length === 0) {
    return out;
  }

  const divider: DividerBlock = { type: "divider" };
  return [...out, divider, ...actionBlocks];
}

/**
 * Build blocks for the accepted (shareable, post_to) payload — just the
 * authored blocks after markdown conversion + splitting, plus the optional
 * `table` appended at the end. Excludes the conversational `message`
 * preamble by contract.
 */
export function getStructuredAcceptedBlocks(
  blocks: Block[],
  table?: AuthoredTableBlock,
): SlackBlocks {
  const out: SlackBlocks = prepareBlocks(blocks);
  if (table) {
    out.push(prepareTable(table));
  }
  return out;
}

export function getErrorBlocks(message: string): SlackBlocks {
  const block: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `:x: ${message}`,
    },
  };
  return [block];
}

export function getErrorBlocksWithRetry(sessionId: string): SlackBlocks {
  const section: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: t("blocks.crash_error"),
    },
  };
  const actions: ActionsBlock = {
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: t("blocks.try_again_button"),
          emoji: true,
        },
        action_id: "clack_retry",
        value: sessionId,
      },
    ],
  };
  return [section, actions];
}

// ============================================================================
// Button-label validation (kept here since action-button rendering lives here)
// ============================================================================

const SLACK_BUTTON_LABEL_LIMIT = 75;

/** Re-exported for callers that only need the button-label validator. */
export type ButtonLabelValidationError = BlockValidationError;

/**
 * Validate action-button labels against Slack's 75-char limit. Returns an
 * empty array if valid. Call after `getResponseActionBlocks` builds the
 * action blocks, since label length is determined at that point.
 */
export function validateActionButtonLabels(
  actionBlocks: ActionsBlock[],
): ButtonLabelValidationError[] {
  const errors: ButtonLabelValidationError[] = [];
  actionBlocks.forEach((block, bi) => {
    block.elements.forEach((el, ei) => {
      if (el.type !== "button") return;
      const label = el.text.text;
      if (label.length > SLACK_BUTTON_LABEL_LIMIT) {
        errors.push({
          field: `actions[${bi}].button[${ei}]`,
          message: `Button label "${label}" (${label.length} chars) exceeds the ${SLACK_BUTTON_LABEL_LIMIT}-char limit.`,
          currentLength: label.length,
          limit: SLACK_BUTTON_LABEL_LIMIT,
        });
      }
    });
  });
  return errors;
}
