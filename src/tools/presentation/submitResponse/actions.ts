import { randomBytes } from "node:crypto";
import type { IntentStore } from "../../server.js";
import type { Action, MessagePayload, ResponseSnapshot, StagedIntent } from "../../types.js";
import { readInstructionFile as _readInstructionFile } from "../../../configurationFiles.js";
import { t } from "../../../i18n/t.js";
import {
  getResponseActionBlocks as _getResponseActionBlocks,
  validateActionButtonLabels as _validateActionButtonLabels,
} from "../../../slack/blocks.js";
import { extractDisplayText } from "../../../slack/blockText.js";

/** Ref-based action types that must resolve against a staged intent. */
export const REF_ACTION_TYPES = new Set([
  "change",
  "config_update",
  "update",
  "skill_create",
  "skill_update",
  "skill_disable",
  "skill_restore",
  "skill_delete",
]);

/**
 * A single action paired with its batch path label and a sticky `parentIsPostTo` flag
 * (true once any ancestor in the walk is a `post_to`).
 */
export interface FlatAction {
  action: Action;
  path: string;
  parentIsPostTo: boolean;
}

function flattenActionsRecursive(
  actions: Action[],
  pathPrefix: string,
  parentIsPostTo: boolean,
  out: FlatAction[],
): void {
  actions.forEach((action, i) => {
    const path = `${pathPrefix}[${i}]`;
    out.push({ action, path, parentIsPostTo });
    if (action.type !== "post_to") return;
    // Inside a post_to subtree, every descendant has parentIsPostTo=true (sticky).
    if (action.actions && action.actions.length > 0) {
      flattenActionsRecursive(action.actions, `${path}.actions`, true, out);
    }
    if (action.additional_messages) {
      action.additional_messages.forEach((msg, mi) => {
        if (msg.actions && msg.actions.length > 0) {
          flattenActionsRecursive(
            msg.actions,
            `${path}.additional_messages[${mi}].actions`,
            true,
            out,
          );
        }
      });
    }
    if (action.thread_replies) {
      action.thread_replies.forEach((msg, mi) => {
        if (msg.actions && msg.actions.length > 0) {
          flattenActionsRecursive(msg.actions, `${path}.thread_replies[${mi}].actions`, true, out);
        }
      });
    }
  });
}

export function flattenActions(actions: Action[]): FlatAction[] {
  const flat: FlatAction[] = [];
  flattenActionsRecursive(actions, "actions", false, flat);
  return flat;
}

/**
 * Batch-aware walker: the top-level primary actions plus every
 * `additional_messages[*].actions` and `thread_replies[*].actions`, each routed through
 * the recursive walker so post_to subtrees are descended too.
 */
export function walkBatchActions(args: {
  actions?: Action[];
  additional_messages?: MessagePayload[];
  thread_replies?: MessagePayload[];
}): FlatAction[] {
  const flat: FlatAction[] = [];
  if (args.actions && args.actions.length > 0) {
    flattenActionsRecursive(args.actions, "actions", false, flat);
  }
  if (args.additional_messages) {
    args.additional_messages.forEach((msg, mi) => {
      if (msg.actions && msg.actions.length > 0) {
        flattenActionsRecursive(msg.actions, `additional_messages[${mi}].actions`, false, flat);
      }
    });
  }
  if (args.thread_replies) {
    args.thread_replies.forEach((msg, mi) => {
      if (msg.actions && msg.actions.length > 0) {
        flattenActionsRecursive(msg.actions, `thread_replies[${mi}].actions`, false, flat);
      }
    });
  }
  return flat;
}

/** Collect every ref-action whose `ref` is unknown or whose intent type disagrees. */
export function validateRefActions(flat: FlatAction[], intentStore: IntentStore): string[] {
  const errors: string[] = [];
  for (const { action, path } of flat) {
    if (!REF_ACTION_TYPES.has(action.type) || !("ref" in action)) continue;
    const intent = intentStore.resolve(action.ref);
    if (!intent) {
      errors.push(
        `${path}: Action type "${action.type}" references unknown ref "${action.ref}". Call the corresponding action tool first (e.g., propose_change, request_merge).`,
      );
      continue;
    }
    if (intent.type !== action.type) {
      errors.push(
        `${path}: Ref "${action.ref}" is a "${intent.type}" intent but action type is "${action.type}".`,
      );
    }
  }
  return errors;
}

/**
 * For each label-less `config_update` action backed by a delete intent, pick an
 * operation-aware label (revert-to-default when a shipped default exists, else delete-file).
 * Mutates `action.label` in place. Runs after validation so every ref is known to resolve.
 */
export function stampConfigUpdateLabels(
  flat: FlatAction[],
  intentStore: IntentStore,
  readInstructionFile: typeof _readInstructionFile,
): void {
  for (const { action } of flat) {
    if (action.type !== "config_update") continue;
    if (action.label) continue;
    const intent = intentStore.resolve(action.ref);
    if (!intent || intent.type !== "config_update") continue;
    if (intent.operation !== "delete") continue;
    const { default_content } = readInstructionFile(intent.file);
    action.label =
      default_content !== null
        ? t("blocks.action_label_config_revert")
        : t("blocks.action_label_config_delete");
  }
}

export function validatePostToActions(
  flat: FlatAction[],
  topLevelDeliveryChannel?: string,
): string[] {
  const errors: string[] = [];
  for (const { action, path, parentIsPostTo } of flat) {
    if (action.type !== "post_to") continue;
    // Nested post_to is rejected — a cross-post that itself triggers another cross-post has
    // no useful semantics. The sticky `parentIsPostTo` flag catches post_to nested through
    // follower subtrees too.
    if (parentIsPostTo) {
      errors.push(
        `${path}: Nested post_to is not supported. Use a separate top-level post_to action instead.`,
      );
      continue;
    }
    if (action.auto && !action.channel) {
      errors.push(
        `${path}: post_to with auto: true requires an explicit channel ID. Provide the target channel (e.g., "C0APQ9JU865"). Use list_repositories or check the conversation context for channel IDs.`,
      );
    }
    if (action.blocks.length === 0) {
      errors.push(`${path}: post_to action has empty blocks. Provide at least one block to post.`);
    }
    // When submit_response already delivers top-level to the target channel, a post_to to
    // the same channel without a thread would duplicate the message.
    if (
      topLevelDeliveryChannel &&
      action.channel === topLevelDeliveryChannel &&
      !action.thread_ts
    ) {
      errors.push(
        `${path}: submit_response already posts top-level to channel ${topLevelDeliveryChannel}. Remove this post_to action — it would duplicate the message. Use post_to only for a DIFFERENT channel or a specific thread.`,
      );
    }
  }
  return errors;
}

export function validateStagedIntentsCoverage(
  flat: FlatAction[],
  intentStore: IntentStore,
): string | null {
  const allIntents = intentStore.getAll();
  if (allIntents.size === 0) return null;

  const actionRefs = new Set<string>();
  for (const { action } of flat) {
    if ("ref" in action && action.ref) {
      actionRefs.add(action.ref);
    }
  }

  for (const [ref, intent] of allIntents) {
    if (!REF_ACTION_TYPES.has(intent.type)) continue;
    if (!actionRefs.has(ref)) {
      return (
        `You staged a "${intent.type}" intent (ref: ${ref}) but didn't include it in the response actions. ` +
        `Either add it as an action button or, if you changed your mind, explain why in your response instead.`
      );
    }
  }
  return null;
}

/**
 * Run every batch-wide action validator and return the collected errors plus the flattened
 * action list (so the caller can `stampConfigUpdateLabels` without re-walking).
 */
export function collectActionErrors(
  args: {
    actions?: Action[];
    additional_messages?: MessagePayload[];
    thread_replies?: MessagePayload[];
  },
  intentStore: IntentStore,
  topLevelDeliveryChannel: string | undefined,
): { errors: string[]; flat: FlatAction[] } {
  const flat = walkBatchActions(args);
  const errors: string[] = [];
  errors.push(...validateRefActions(flat, intentStore));
  errors.push(...validatePostToActions(flat, topLevelDeliveryChannel));
  const coverage = validateStagedIntentsCoverage(flat, intentStore);
  if (coverage) errors.push(coverage);
  return { errors, flat };
}

/**
 * Persist a replayable snapshot for every `post_to` action so deferred (button-click or
 * auto) delivery can reproduce its blocks/table/actions/reactions after an arbitrary delay.
 * Mutates each post_to action's `_snapshotId` in place.
 */
export async function persistPostToSnapshots(
  actions: Action[],
  persistSnapshot: (id: string, snapshot: ResponseSnapshot) => Promise<void>,
): Promise<void> {
  for (const action of actions) {
    if (action.type !== "post_to") continue;
    const snapshotId = randomBytes(6).toString("hex");
    await persistSnapshot(snapshotId, {
      text: extractDisplayText(action.blocks),
      blocks: action.blocks,
      ...(action.table && { table: action.table }),
      ...(action.actions && action.actions.length > 0 && { actions: action.actions }),
      ...(action.reactions && action.reactions.length > 0 && { reactions: action.reactions }),
      ...(action.suppress_unfurls === true && { suppressUnfurls: true }),
      ...(action.additional_messages &&
        action.additional_messages.length > 0 && {
          additional_messages: action.additional_messages,
        }),
      ...(action.thread_replies &&
        action.thread_replies.length > 0 && { thread_replies: action.thread_replies }),
    });
    action._snapshotId = snapshotId;
  }
}

/**
 * Validate the Slack 75-char button-label limit on buttons rendered on each post_to's
 * cross-posted message. Returns path-prefixed error strings (empty when all valid).
 */
export function validateNestedPostToButtonLabels(
  actions: Action[],
  sessionId: string,
  getResponseActionBlocks: typeof _getResponseActionBlocks,
  validateActionButtonLabels: typeof _validateActionButtonLabels,
): string[] {
  const errors: string[] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.type !== "post_to" || !action.actions || action.actions.length === 0) continue;
    const nestedBlocks = getResponseActionBlocks(action.actions, sessionId);
    for (const e of validateActionButtonLabels(nestedBlocks)) {
      errors.push(`actions[${i}].${e.field}: ${e.message}`);
    }
  }
  return errors;
}

/**
 * Persist every staged intent referenced by an action (top-level or nested) BEFORE
 * delivery, so a fast button click can't outrun the writeback.
 */
export async function persistReferencedIntents(
  actions: Action[],
  intentStore: IntentStore,
  sessionId: string,
  appendStagedIntents: (sessionId: string, intents: Record<string, StagedIntent>) => Promise<void>,
): Promise<void> {
  const referenced: Record<string, StagedIntent> = {};
  for (const { action } of flattenActions(actions)) {
    if (!("ref" in action) || !action.ref) continue;
    const intent = intentStore.resolve(action.ref);
    if (intent) referenced[action.ref] = intent;
  }
  if (Object.keys(referenced).length > 0) {
    await appendStagedIntents(sessionId, referenced);
  }
}
