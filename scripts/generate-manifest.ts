#!/usr/bin/env npx tsx
/**
 * Generate Slack app manifest from config.json
 *
 * Reads config and generates manifest with only the scopes and events
 * needed for the enabled features.
 * Output is written to slack-app-manifest.json.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Manifest } from "@slack/web-api/dist/types/request/manifest.js";

// Extract BotScope and ManifestEvent types from Manifest (they're not exported directly)
type ArrayElement<T> = T extends readonly (infer U)[] ? U : T extends (infer U)[] ? U : never;
type BotScope = ArrayElement<NonNullable<NonNullable<NonNullable<Manifest["oauth_config"]>["scopes"]>["bot"]>>;
type ManifestEvent = ArrayElement<NonNullable<NonNullable<Manifest["settings"]>["event_subscriptions"]>["bot_events"]>;

interface SlackAppConfig {
  name?: string;
  description?: string;
  backgroundColor?: string;
}

interface SlackConfig {
  fetchAndStoreUsername?: boolean;
  notifyHiddenThread?: boolean;
}

interface DirectMessagesConfig {
  enabled?: boolean;
}

interface MentionsConfig {
  enabled?: boolean;
}

interface PartialConfig {
  slackApp?: SlackAppConfig;
  slack?: SlackConfig;
  directMessages?: DirectMessagesConfig;
  mentions?: MentionsConfig;
}

const DEFAULTS: Required<SlackAppConfig> = {
  name: "Clack",
  description: "Ask questions about your codebase using reactions",
  backgroundColor: "#4A154B",
};

// Core scopes - always needed for basic reaction functionality and role management
const CORE_SCOPES: BotScope[] = [
  "channels:history",
  "groups:history",
  "chat:write",
  "reactions:read",
  "reactions:write",
  "users:read", // Needed for role management (disabled user detection)
];

// Core events - always needed (including app_home_opened for role management Home tab)
const CORE_EVENTS: ManifestEvent[] = ["app_home_opened", "reaction_added"];

function loadConfigForManifest(): PartialConfig {
  const configPath = resolve(process.cwd(), "data", "config.json");

  if (!existsSync(configPath)) {
    console.log("No config.json found, using defaults for manifest generation.");
    return {};
  }

  const content = readFileSync(configPath, "utf-8");
  let parsed: PartialConfig;
  try {
    parsed = JSON.parse(content) as PartialConfig;
  } catch {
    throw new Error(`Config file is not valid JSON: ${configPath}`);
  }

  return parsed;
}

function validateSlackAppConfig(config: SlackAppConfig): void {
  if (config.name !== undefined && (typeof config.name !== "string" || config.name.length === 0)) {
    throw new Error("slackApp.name must be a non-empty string");
  }

  if (config.backgroundColor !== undefined) {
    if (typeof config.backgroundColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(config.backgroundColor)) {
      throw new Error("slackApp.backgroundColor must be a hex color (e.g., #4A154B)");
    }
  }
}

interface ConfigFeatures {
  directMessages: boolean;
  mentions: boolean;
  notifyHiddenThread: boolean;
  fetchUsernames: boolean;
}

function getEnabledFeatures(config: PartialConfig): ConfigFeatures {
  return {
    directMessages: config.directMessages?.enabled ?? false,
    mentions: config.mentions?.enabled ?? false,
    notifyHiddenThread: config.slack?.notifyHiddenThread ?? true,
    fetchUsernames: config.slack?.fetchAndStoreUsername ?? false,
  };
}

function buildScopes(features: ConfigFeatures): BotScope[] {
  const scopes: BotScope[] = [...CORE_SCOPES];

  if (features.directMessages) {
    scopes.push("im:history", "mpim:history");
  }

  if (features.mentions) {
    scopes.push("app_mentions:read");
  }

  if (features.notifyHiddenThread) {
    scopes.push("im:write");
  }

  // users:read is now in CORE_SCOPES (needed for role management)
  // fetchUsernames feature doesn't need additional scopes

  return scopes.sort();
}

function buildEvents(features: ConfigFeatures): ManifestEvent[] {
  const events: ManifestEvent[] = [...CORE_EVENTS];

  if (features.directMessages) {
    events.push("message.im");
  }

  if (features.mentions) {
    events.push("app_mention");
  }

  return events.sort();
}

function generateManifest(config: PartialConfig): Manifest {
  const slackApp = config.slackApp ?? {};
  const name = slackApp.name ?? DEFAULTS.name;
  const description = slackApp.description ?? DEFAULTS.description;
  const backgroundColor = slackApp.backgroundColor ?? DEFAULTS.backgroundColor;

  const features = getEnabledFeatures(config);
  const scopes = buildScopes(features);
  const events = buildEvents(features);

  const manifest: Manifest = {
    display_information: {
      name,
      description,
      background_color: backgroundColor,
    },
    features: {
      app_home: {
        home_tab_enabled: true,
        messages_tab_enabled: false,
        messages_tab_read_only_enabled: false,
      },
      bot_user: {
        display_name: name,
        always_online: true,
      },
    },
    oauth_config: {
      scopes: {
        bot: scopes,
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: events,
      },
      interactivity: {
        is_enabled: true,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };

  return manifest;
}

function main(): void {
  console.log("Generating Slack app manifest...");

  const config = loadConfigForManifest();
  validateSlackAppConfig(config.slackApp ?? {});

  const features = getEnabledFeatures(config);
  const manifest = generateManifest(config);

  const outputPath = resolve(process.cwd(), "slack-app-manifest.json");
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`Manifest written to ${outputPath}`);
  console.log(`  Name: ${manifest.display_information.name}`);
  console.log(`  Description: ${manifest.display_information.description}`);
  console.log(`  Features enabled:`);
  console.log(`    - Direct messages: ${features.directMessages}`);
  console.log(`    - Mentions: ${features.mentions}`);
  console.log(`    - Notify hidden thread: ${features.notifyHiddenThread}`);
  console.log(`    - Fetch usernames: ${features.fetchUsernames}`);
  console.log(`  Scopes: ${manifest.oauth_config?.scopes?.bot?.join(", ")}`);
  console.log(`  Events: ${manifest.settings?.event_subscriptions?.bot_events?.join(", ")}`);
}

main();
