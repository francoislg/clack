/**
 * The bot scopes and event subscriptions each enabled feature needs. The manifest generator
 * and the running bot both derive their lists from here, so a feature that needs a new scope
 * is added in this one file.
 */

import type { Manifest } from "@slack/web-api/dist/types/request/manifest.js";
import type { DmType } from "../config.js";
import type { SlackFileMode } from "../configSchemas.js";

type ManifestBotScopes = NonNullable<
  NonNullable<NonNullable<Manifest["oauth_config"]>["scopes"]>["bot"]
>;
type ManifestBotEvents = NonNullable<
  NonNullable<NonNullable<Manifest["settings"]>["event_subscriptions"]>["bot_events"]
>;

// The scopes the Slack API accepts that @slack/web-api's manifest type does not list.
type UntypedBotScope =
  | "assistant:write"
  | "search:read.public"
  | "canvases:read"
  | "canvases:write"
  | "lists:read"
  | "lists:write";

export type BotScope = ManifestBotScopes[number] | UntypedBotScope;
export type ManifestEvent = ManifestBotEvents[number];

// Core scopes - always needed for basic reaction functionality and role management
export const CORE_SCOPES: BotScope[] = [
  "channels:history",
  "channels:read", // Needed for conversations.info (channel name resolution)
  "emoji:read", // Needed for find_emoji tool (custom emoji lookup)
  "files:read", // Needed for downloading images uploaded in Slack messages
  "files:write", // Needed for uploading files to Slack (upload_file tool, Chat to Edit)
  "groups:history",
  "groups:read", // Needed for conversations.info (private channel name resolution)
  "chat:write",
  "reactions:read",
  "reactions:write",
  "users:read", // Needed for role management (disabled user detection)
];

// Core events - always needed (including app_home_opened for role management Home tab)
export const CORE_EVENTS: ManifestEvent[] = ["app_home_opened", "reaction_added"];

export interface ManifestFeatures {
  directMessages: boolean;
  dmType: DmType;
  mentions: boolean;
  autoRespond: boolean;
  publicSearch: boolean;
  investigations: boolean;
  canvases: SlackFileMode;
  lists: SlackFileMode;
}

/**
 * The config keys the features are read from. Both the manifest config and the validated
 * `Config` satisfy it structurally.
 */
export interface ManifestFeatureSource {
  directMessages?: { enabled?: boolean; dmType?: DmType };
  mentions?: { enabled?: boolean };
  autoRespond?: { enabled?: boolean };
  allowPublicSearch?: boolean;
  investigations?: { enabled?: boolean };
  canvases?: { mode?: SlackFileMode };
  lists?: { mode?: SlackFileMode };
}

export function manifestFeatures(source: ManifestFeatureSource): ManifestFeatures {
  return {
    directMessages: source.directMessages?.enabled ?? false,
    dmType: source.directMessages?.dmType ?? "assistant",
    mentions: source.mentions?.enabled ?? false,
    autoRespond: source.autoRespond?.enabled ?? false,
    publicSearch: source.allowPublicSearch ?? false,
    investigations: source.investigations?.enabled ?? false,
    canvases: source.canvases?.mode ?? "off",
    lists: source.lists?.mode ?? "off",
  };
}

export function requiredBotScopes(features: ManifestFeatures): BotScope[] {
  const scopes: BotScope[] = [...CORE_SCOPES];

  if (features.directMessages) {
    scopes.push("im:history", "im:read", "mpim:history", "mpim:read");
    // Both the assistant (assistant_view) and agent (agent_view) DM experiences use the
    // assistant.threads.* API for status/title/prompts, so both need assistant:write.
    if (features.dmType === "assistant" || features.dmType === "agent") {
      scopes.push("assistant:write");
    }
  }

  if (features.mentions) {
    scopes.push("app_mentions:read");
  }

  // Workspace-wide keyword search (assistant.search.context). No matching bot_events change —
  // its action_token sources (message, app_mention) are already subscribed by the DM/mention features.
  if (features.publicSearch) {
    scopes.push("search:read.public");
  }

  // Canvas tools. "read" opens canvases; "write" also creates and edits them. No bot events.
  if (features.canvases !== "off") {
    scopes.push("canvases:read");
    if (features.canvases === "write") scopes.push("canvases:write");
  }

  // List tools. "read" opens Lists; "write" also creates them and changes their items. No bot events.
  if (features.lists !== "off") {
    scopes.push("lists:read");
    if (features.lists === "write") scopes.push("lists:write");
  }

  if (features.investigations) {
    scopes.push("channels:join");
  }

  // Always needed for DM delivery (per-user reaction preference)
  scopes.push("im:write");

  return [...new Set(scopes)].sort((a, b) => a.localeCompare(b));
}

export function requiredBotEvents(features: ManifestFeatures): ManifestEvent[] {
  const events: ManifestEvent[] = [...CORE_EVENTS];

  if (features.directMessages) {
    events.push("message.im");
    if (features.dmType === "assistant") {
      events.push("assistant_thread_started", "assistant_thread_context_changed");
    }
  }

  if (features.mentions) {
    events.push("app_mention");
  }

  if (features.autoRespond) {
    events.push("message.channels", "message.groups");
  }

  if (features.investigations) {
    events.push("message.channels", "message.groups");
  }

  return [...new Set(events)].sort((a, b) => a.localeCompare(b));
}
