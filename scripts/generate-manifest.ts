#!/usr/bin/env npx tsx
/**
 * Generate Slack app manifest from config.json
 *
 * Reads branding from config.json and merges with static defaults for scopes, events, and settings.
 * Output is written to slack-app-manifest.json.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Manifest } from "@slack/web-api/dist/types/request/manifest.js";

interface SlackAppConfig {
  name?: string;
  description?: string;
  backgroundColor?: string;
}

interface PartialConfig {
  slackApp?: SlackAppConfig;
}

const DEFAULTS: Required<SlackAppConfig> = {
  name: "Clack",
  description: "Ask questions about your codebase using reactions",
  backgroundColor: "#4A154B",
};

// Static manifest settings - not configurable
const BOT_SCOPES = [
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "chat:write",
  "reactions:read",
  "reactions:write",
  "users:read",
] as const;

const BOT_EVENTS = ["reaction_added"] as const;

function loadConfigForManifest(): SlackAppConfig {
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

  return parsed.slackApp ?? {};
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

function generateManifest(config: SlackAppConfig): Manifest {
  const name = config.name ?? DEFAULTS.name;
  const description = config.description ?? DEFAULTS.description;
  const backgroundColor = config.backgroundColor ?? DEFAULTS.backgroundColor;

  const manifest: Manifest = {
    display_information: {
      name,
      description,
      background_color: backgroundColor,
    },
    features: {
      bot_user: {
        display_name: name,
        always_online: true,
      },
    },
    oauth_config: {
      scopes: {
        bot: [...BOT_SCOPES],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: [...BOT_EVENTS],
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
  validateSlackAppConfig(config);

  const manifest = generateManifest(config);

  const outputPath = resolve(process.cwd(), "slack-app-manifest.json");
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`Manifest written to ${outputPath}`);
  console.log(`  Name: ${manifest.display_information.name}`);
  console.log(`  Description: ${manifest.display_information.description}`);
}

main();
