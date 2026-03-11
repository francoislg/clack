#!/usr/bin/env npx tsx
/**
 * Test script for running Claude CLI in a worktree
 *
 * Usage:
 *   npx tsx src/changes/askClaudeWorktree.ts [options]
 *
 * Options:
 *   --cwd <path>      Working directory (default: current directory)
 *   --prompt <text>   Prompt to send to Claude (default: simple test prompt)
 *   --system <text>   System prompt (optional)
 *   --timeout <min>   Timeout in minutes (default: 2)
 *   --branch <name>   Branch name for logging (enables execution.log)
 *
 * Examples:
 *   npx tsx src/changes/askClaudeWorktree.ts
 *   npx tsx src/changes/askClaudeWorktree.ts --prompt "What files are in this directory?"
 *   npx tsx src/changes/askClaudeWorktree.ts --cwd ./data/worktrees/my-repo/my-branch --branch my-branch
 */

import { loadConfig } from "../config.js";
import { runClaude } from "./execution.js";

async function main() {
  // Load config before anything else
  loadConfig();
  const args = process.argv.slice(2);

  // Parse arguments
  let cwd = process.cwd();
  let prompt = "List the files in the current directory and describe what this project does in one sentence.";
  let systemPrompt: string | undefined;
  let timeout = 2;
  let branchName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--cwd":
        cwd = args[++i];
        break;
      case "--prompt":
        prompt = args[++i];
        break;
      case "--system":
        systemPrompt = args[++i];
        break;
      case "--timeout":
        timeout = parseInt(args[++i], 10);
        break;
      case "--branch":
        branchName = args[++i];
        break;
      case "--help":
      case "-h":
        console.log(`
Test script for running Claude CLI in a worktree

Usage:
  npx tsx src/changes/askClaudeWorktree.ts [options]

Options:
  --cwd <path>      Working directory (default: current directory)
  --prompt <text>   Prompt to send to Claude (default: simple test prompt)
  --system <text>   System prompt (optional)
  --timeout <min>   Timeout in minutes (default: 2)
  --branch <name>   Branch name for logging (enables execution.log)
  --help, -h        Show this help message
`);
        process.exit(0);
    }
  }

  console.log("=".repeat(60));
  console.log("Claude Worktree Test");
  console.log("=".repeat(60));
  console.log(`Working directory: ${cwd}`);
  console.log(`Prompt: ${prompt.length > 100 ? prompt.substring(0, 100) + "..." : prompt}`);
  console.log(`Prompt length: ${prompt.length} chars`);
  if (systemPrompt) {
    console.log(`System prompt: ${systemPrompt.length > 50 ? systemPrompt.substring(0, 50) + "..." : systemPrompt}`);
  }
  console.log(`Timeout: ${timeout} minutes`);
  if (branchName) {
    console.log(`Branch (for logging): ${branchName}`);
  }
  console.log("=".repeat(60));
  console.log("\nRunning Claude CLI...\n");

  const startTime = Date.now();

  const result = await runClaude({
    prompt,
    cwd,
    systemPrompt,
    timeout,
    branchName,
    onProgress: (message) => {
      console.log(`[Progress] ${message}`);
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("Result");
  console.log("=".repeat(60));
  console.log(`Success: ${result.success}`);
  console.log(`Elapsed: ${elapsed}s`);

  if (result.error) {
    console.log(`Error: ${result.error}`);
  }

  if (result.lastMessage) {
    console.log(`Last progress: ${result.lastMessage}`);
  }

  console.log("\n--- Response Text ---");
  console.log(result.text || "(empty)");
  console.log("--- End Response ---\n");

  if (branchName) {
    console.log(`Check execution log: data/worktree-sessions/${branchName.replace(/\//g, "-")}/execution.log`);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
