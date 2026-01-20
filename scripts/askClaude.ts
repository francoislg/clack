#!/usr/bin/env node
/**
 * Simple CLI to test Claude with the current configuration.
 * Uses the same askClaude function as the Slack bot.
 *
 * Usage:
 *   npm run ask "Your question here"
 *   npm run ask "Can you test the Sentry MCP?"
 *   npm run ask --session <session-id> "Follow-up question"
 */

import { config as dotenvConfig } from "dotenv";
import { join } from "path";
import { loadConfig } from "../dist/config.js";
import { askClaude } from "../dist/claude.js";
import { getSession } from "../dist/sessions.js";
import type { SessionContext } from "../dist/sessions.js";

// Load environment variables
dotenvConfig({ path: join(process.cwd(), ".env") });
dotenvConfig({ path: join(process.cwd(), "data", "auth", ".env") });

function parseArgs(): { sessionId?: string; prompt: string } {
  const args = process.argv.slice(2);
  let sessionId: string | undefined;
  let promptArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) {
      sessionId = args[i + 1];
      i++; // Skip the next arg
    } else {
      promptArgs.push(args[i]);
    }
  }

  return {
    sessionId,
    prompt: promptArgs.join(" "),
  };
}

async function main(): Promise<void> {
  const { sessionId, prompt } = parseArgs();

  if (!prompt) {
    console.error("Usage:");
    console.error("  npm run ask \"Your question here\"");
    console.error("  npm run ask --session <session-id> \"Follow-up question\"");
    process.exit(1);
  }

  // Load config (required by askClaude)
  try {
    loadConfig();
  } catch (error) {
    console.error("Failed to load config:", error);
    process.exit(1);
  }

  let session: SessionContext;

  if (sessionId) {
    // Load existing session
    const existingSession = await getSession(sessionId);
    if (!existingSession) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
    // Add the new prompt as a refinement
    existingSession.refinements.push(prompt);
    session = existingSession;
    console.log(`\n📂 Using session: ${sessionId}\n`);
  } else {
    // Create a minimal session context
    session = {
      sessionId: `cli-${Date.now()}`,
      channelId: "CLI",
      messageTs: Date.now().toString(),
      threadTs: Date.now().toString(),
      userId: "cli-user",
      originalQuestion: prompt,
      threadContext: [],
      refinements: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
  }

  console.log("🤖 Asking Claude...\n");
  console.log(`📝 Prompt: ${prompt}\n`);
  console.log("---\n");

  const response = await askClaude(session);

  console.log("---\n");

  if (response.success) {
    console.log("💬 Response:\n");
    console.log(response.answer);
  } else {
    console.error("❌ Error:", response.error);
    process.exit(1);
  }

  console.log();
}

main();
