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
import { fileURLToPath } from "node:url";
import type { Manifest } from "@slack/web-api/dist/types/request/manifest.js";
import { manifestConfigZod, type ManifestConfig } from "../src/configSchemas.js";
import { en } from "../src/i18n/strings/en.js";
import {
  manifestFeatures,
  requiredBotEvents,
  requiredBotScopes,
  type ManifestFeatures,
} from "../src/slack/requiredScopes.js";

/**
 * Static suggested prompts for `agent_view`. Under agent_view, prompts are a manifest
 * property rendered atop the Messages tab (not a per-thread runtime `setSuggestedPrompts`
 * call as in assistant_view). Sourced from the i18n defaults to avoid drift; the
 * channel-context prompt is omitted — it has no meaning without a viewed channel.
 */
const AGENT_SUGGESTED_PROMPTS: Array<{ title: string; message: string }> = [
  {
    title: en["assistant.prompt_capabilities_title"],
    message: en["assistant.prompt_capabilities_message"],
  },
  { title: en["assistant.prompt_debug_title"], message: en["assistant.prompt_debug_message"] },
  { title: en["assistant.prompt_funny_title"], message: en["assistant.prompt_funny_message"] },
];

const DEFAULTS = {
  name: "Clack",
  description: "Ask questions about your codebase using reactions",
  backgroundColor: "#4A154B",
};

function loadConfigForManifest(): unknown {
  const configPath = resolve(process.cwd(), "data", "config.json");

  if (!existsSync(configPath)) {
    console.log("No config.json found, using defaults for manifest generation.");
    return {};
  }

  const content = readFileSync(configPath, "utf-8");
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Config file is not valid JSON: ${configPath}`);
  }
}

/** Validates the manifest-relevant config keys; the thrown error lists every invalid value. */
export function parseManifestConfig(raw: unknown): ManifestConfig {
  const result = manifestConfigZod.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid config for manifest generation: ${issues}`);
  }
  return result.data;
}

function buildManifest(config: ManifestConfig, features: ManifestFeatures): Manifest {
  const slackApp = config.slackApp ?? {};
  const name = slackApp.name ?? DEFAULTS.name;
  const description = slackApp.description ?? DEFAULTS.description;
  const backgroundColor = slackApp.backgroundColor ?? DEFAULTS.backgroundColor;

  const scopes = requiredBotScopes(features);
  const events = requiredBotEvents(features);

  // Type assertion: @slack/web-api types lag behind the Slack API (missing assistant_view, assistant:write, etc.)
  type ManifestBotScopes = NonNullable<NonNullable<Manifest["oauth_config"]>["scopes"]>["bot"];

  const manifest: Manifest = {
    display_information: {
      name,
      description,
      background_color: backgroundColor,
    },
    features: {
      app_home: {
        home_tab_enabled: true,
        messages_tab_enabled: features.directMessages,
        messages_tab_read_only_enabled: false,
      },
      bot_user: {
        display_name: name,
        always_online: true,
      },
      ...(features.directMessages &&
        features.dmType === "assistant" && {
          assistant_view: {
            assistant_description: description,
            suggested_prompts: [],
          },
        }),
      ...(features.directMessages &&
        features.dmType === "agent" && {
          agent_view: {
            agent_description: description,
            suggested_prompts: AGENT_SUGGESTED_PROMPTS,
          },
        }),
    },
    oauth_config: {
      scopes: {
        bot: scopes as ManifestBotScopes,
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

export function generateManifest(config: unknown): Manifest {
  const parsed = parseManifestConfig(config);
  return buildManifest(parsed, manifestFeatures(parsed));
}

function main(): void {
  console.log("Generating Slack app manifest...");

  const config = parseManifestConfig(loadConfigForManifest());
  const features = manifestFeatures(config);
  const manifest = buildManifest(config, features);

  const outputPath = resolve(process.cwd(), "slack-app-manifest.json");
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`Manifest written to ${outputPath}`);
  console.log(`  Name: ${manifest.display_information.name}`);
  console.log(`  Description: ${manifest.display_information.description}`);
  console.log(`  Features enabled:`);
  console.log(
    `    - Direct messages: ${features.directMessages}${features.directMessages ? ` (dmType: ${features.dmType})` : ""}`,
  );
  console.log(`    - Mentions: ${features.mentions}`);
  console.log(`    - Auto-respond: ${features.autoRespond}`);
  console.log(`    - Fetch usernames: ${config.slack?.fetchAndStoreUsername ?? false}`);
  console.log(`    - Scheduled messages: ${config.allowScheduledMessages ?? false}`);
  console.log(`    - Public message search: ${features.publicSearch}`);
  console.log(`    - Investigations: ${features.investigations}`);
  console.log(`    - Canvases: ${features.canvases}`);
  console.log(`  Scopes: ${manifest.oauth_config?.scopes?.bot?.join(", ")}`);
  console.log(`  Events: ${manifest.settings?.event_subscriptions?.bot_events?.join(", ")}`);

  if (features.directMessages) {
    console.log(
      `\nNote: switching directMessages.dmType between "assistant" and "classic" requires re-uploading this manifest (the bot events subscribed differ between modes).`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
