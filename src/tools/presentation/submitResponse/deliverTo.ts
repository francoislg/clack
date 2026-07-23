import type { IntentStore } from "../../server.js";
import type { Action, DeliverToEntry, StagedIntent } from "../../types.js";
import {
  getResponseActionBlocks as _getResponseActionBlocks,
  validateActionButtonLabels as _validateActionButtonLabels,
} from "../../../slack/blocks.js";
import {
  validateBlocks as _validateBlocks,
  validateTable as _validateTable,
  validateChart as _validateChart,
} from "../../../slack/blockValidate.js";
import { validateSingleMessage } from "./messageValidation.js";
import { flattenActions, persistReferencedIntents, validateRefActions } from "./actions.js";

export interface ValidateDeliverToDeps {
  intentStore: IntentStore;
  sessionId: string;
  validateBlocks: typeof _validateBlocks;
  validateTable: typeof _validateTable;
  validateChart: typeof _validateChart;
  validateActionButtonLabels: typeof _validateActionButtonLabels;
  getResponseActionBlocks: typeof _getResponseActionBlocks;
}

/**
 * Validate every `deliver_to` entry's `response` payload, reusing the same per-message
 * building blocks as the primary path: block/table/length validation, ref-action resolution,
 * and button-label limits. Adds the deliver_to-only rule that a `post_to` action is rejected
 * anywhere in an entry's `actions` (this message is already delivered to an explicit channel,
 * so a cross-post-from-a-cross-post has no meaning). Returns path-prefixed error strings.
 */
export function validateDeliverToEntries(
  entries: DeliverToEntry[],
  deps: ValidateDeliverToDeps,
): string[] {
  const errors: string[] = [];

  entries.forEach((entry, i) => {
    const base = `deliver_to[${i}]`;
    const { response } = entry;

    errors.push(
      ...validateSingleMessage({
        blocks: response.blocks,
        ...(response.table && { table: response.table }),
        ...(response.chart && { chart: response.chart }),
        pathPrefix: `${base}.response`,
        validateBlocks: deps.validateBlocks,
        validateTable: deps.validateTable,
        validateChart: deps.validateChart,
      }),
    );

    response.thread_replies?.forEach((reply, ri) => {
      errors.push(
        ...validateSingleMessage({
          blocks: reply.blocks,
          ...(reply.table && { table: reply.table }),
          ...(reply.chart && { chart: reply.chart }),
          pathPrefix: `${base}.response.thread_replies[${ri}]`,
          validateBlocks: deps.validateBlocks,
          validateTable: deps.validateTable,
          validateChart: deps.validateChart,
        }),
      );
    });

    errors.push(...validateEntryActions(entry, base, deps));
  });

  return errors;
}

/** Reject `post_to`, resolve refs, and check button labels for one entry's actions. */
function validateEntryActions(
  entry: DeliverToEntry,
  base: string,
  deps: ValidateDeliverToDeps,
): string[] {
  const errors: string[] = [];
  const { response } = entry;

  const actionGroups: { actions: Action[]; path: string }[] = [];
  if (response.actions && response.actions.length > 0) {
    actionGroups.push({ actions: response.actions, path: `${base}.response.actions` });
  }
  response.thread_replies?.forEach((reply, ri) => {
    if (reply.actions && reply.actions.length > 0) {
      actionGroups.push({
        actions: reply.actions,
        path: `${base}.response.thread_replies[${ri}].actions`,
      });
    }
  });

  for (const group of actionGroups) {
    const flat = flattenActions(group.actions);
    for (const { action } of flat) {
      if (action.type === "post_to") {
        errors.push(
          `${group.path}: post_to is not allowed inside a deliver_to entry's actions — this message is already delivered to an explicit channel.`,
        );
      }
    }
    errors.push(...validateRefActions(flat, deps.intentStore));
    const rendered = deps.getResponseActionBlocks(group.actions, deps.sessionId);
    for (const e of deps.validateActionButtonLabels(rendered)) {
      errors.push(`${group.path}: ${e.message}`);
    }
  }

  return errors;
}

/** Persist staged intents referenced by any deliver_to entry's actions before delivery. */
export async function persistDeliverToIntents(
  entries: DeliverToEntry[],
  intentStore: IntentStore,
  sessionId: string,
  appendStagedIntents: (sessionId: string, intents: Record<string, StagedIntent>) => Promise<void>,
): Promise<void> {
  for (const entry of entries) {
    const actions = entry.response.actions;
    if (actions && actions.length > 0) {
      await persistReferencedIntents(actions, intentStore, sessionId, appendStagedIntents);
    }
    for (const reply of entry.response.thread_replies ?? []) {
      if (reply.actions && reply.actions.length > 0) {
        await persistReferencedIntents(reply.actions, intentStore, sessionId, appendStagedIntents);
      }
    }
  }
}
