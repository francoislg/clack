#!/usr/bin/env npx tsx
/**
 * Test script for running a tester Claude session (QA + video recording) against a
 * local app checkout — the same prompts, toolbelt, and Playwright MCP attachment as a
 * real "test this PR" run, without Slack or the worker pool.
 *
 * Usage:
 *   npx tsx scripts/askClaudeTester.ts [options]
 *
 * Options:
 *   --cwd <path>         App checkout to test (default: current directory)
 *   --focus <text>       What to exercise (default: simple smoke focus)
 *   --repo <name>        Repo name for per-repo test instructions (default: basename of cwd)
 *   --sidecar <url>      Playwright MCP sidecar URL (default: config.tester.sidecarUrl, else http://localhost:8931/mcp)
 *   --recordings <dir>   Recordings dir (default: config.tester.recordingsDir, else data/tester/recordings)
 *   --app-host <host>    Hostname the sidecar browser uses to reach the app (default: config.tester.appHost, else host.docker.internal)
 *   --timeout <min>      Timeout in minutes (default: 15)
 *
 * Requires the sidecar:
 *   docker compose -f docker-compose.tester.yml up -d
 *
 * Examples:
 *   npx tsx scripts/askClaudeTester.ts --cwd ../my-app --focus "log in and click around the dashboard"
 */

import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { runClaude } from "../src/changes/execution.js";
import { buildTesterSystemPrompt, buildTesterUserPrompt } from "../src/tester/prompt.js";
import { teardownAppProcess } from "../src/tester/processTeardown.js";
import { buildPlaywrightMcpServerConfig, checkSidecarReachable } from "../src/tester/sidecar.js";
import { buildWorkerContext } from "../src/tools/context.js";
import { buildClackTools } from "../src/tools/server.js";
import { findLatestRecording } from "../src/tools/worker/recordAndUpload.js";
import { truncate } from "../src/text.js";

const LOCAL_MODE_NOTE = `

LOCAL SMOKE MODE — you are running outside Slack:
- Do NOT call record_and_upload (there is no Slack thread to deliver to); the recording is collected from the volume after your run.
- report_status is acknowledged but not posted anywhere; keep using it to narrate.
- Everything else applies unchanged, including the teardown of the app process you start.`;

async function main() {
  // Load config before anything else
  const config = loadConfig();
  const args = process.argv.slice(2);

  // Parse arguments
  let cwd = process.cwd();
  let focus = "Boot the app, open its home page, and record a short walkthrough of what you see.";
  let repoName: string | undefined;
  let sidecarUrl = config.tester?.sidecarUrl ?? "http://localhost:8931/mcp";
  let recordingsDir = config.tester?.recordingsDir ?? "data/tester/recordings";
  let appHost = config.tester?.appHost ?? "host.docker.internal";
  let timeout = 15;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--cwd":
        cwd = args[++i];
        break;
      case "--focus":
        focus = args[++i];
        break;
      case "--repo":
        repoName = args[++i];
        break;
      case "--sidecar":
        sidecarUrl = args[++i];
        break;
      case "--recordings":
        recordingsDir = args[++i];
        break;
      case "--app-host":
        appHost = args[++i];
        break;
      case "--timeout":
        timeout = parseInt(args[++i], 10);
        break;
      case "--help":
      case "-h":
        console.log(`
Test script for running a tester Claude session against a local app checkout

Usage:
  npx tsx scripts/askClaudeTester.ts [options]

Options:
  --cwd <path>         App checkout to test (default: current directory)
  --focus <text>       What to exercise (default: simple smoke focus)
  --repo <name>        Repo name for per-repo test instructions (default: basename of cwd)
  --sidecar <url>      Playwright MCP sidecar URL
  --recordings <dir>   Recordings dir (shared volume)
  --app-host <host>    Hostname the sidecar browser uses to reach the app
  --timeout <min>      Timeout in minutes (default: 15)
  --help, -h           Show this help message

Requires the sidecar: docker compose -f docker-compose.tester.yml up -d
`);
        process.exit(0);
    }
  }

  cwd = resolve(cwd);
  repoName = repoName ?? basename(cwd);

  console.log("=".repeat(60));
  console.log("Claude Tester Test");
  console.log("=".repeat(60));
  console.log(`Working directory: ${cwd}`);
  console.log(`Test focus: ${truncate(focus, 100)}`);
  console.log(`Repo name: ${repoName}`);
  console.log(`Sidecar: ${sidecarUrl}`);
  console.log(`App host (from sidecar): ${appHost}`);
  console.log(`Recordings dir: ${recordingsDir}`);
  console.log(`Timeout: ${timeout} minutes`);
  console.log("=".repeat(60));

  if (!(await checkSidecarReachable(sidecarUrl))) {
    console.error(
      `\nPlaywright sidecar unreachable at ${sidecarUrl}.\nStart it with: docker compose -f docker-compose.tester.yml up -d`,
    );
    process.exit(1);
  }

  const tester = { enabled: true, sidecarUrl, recordingsDir, appHost };
  const promptOpts = {
    description: focus,
    branchName: "local-checkout",
    repoName,
    requester: "local smoke test (askClaudeTester)",
    tester,
  };

  // silent: true — report_status acks without posting (there is no Slack here)
  const testerTools = buildClackTools(
    buildWorkerContext({
      worktreePath: cwd,
      branchName: promptOpts.branchName,
      repoName,
      repoUrl: "",
      channelId: "local",
      threadTs: "0",
      sessionId: "local-tester",
      kind: "test",
      silent: true,
      config: { ...config, tester },
    }),
  );

  console.log("\nRunning tester Claude session...\n");
  const startTime = Date.now();

  let result: Awaited<ReturnType<typeof runClaude>>;
  try {
    result = await runClaude({
      prompt: buildTesterUserPrompt(promptOpts),
      cwd,
      systemPrompt: buildTesterSystemPrompt(promptOpts) + LOCAL_MODE_NOTE,
      allowedTools: ["Read", "Glob", "Grep", "Bash", "ToolSearch"],
      disallowedTools: ["Task", "TaskOutput", "Write", "Edit"],
      mcpServers: {
        clack: testerTools.mcpServer,
        playwright: buildPlaywrightMcpServerConfig(sidecarUrl),
      },
      timeout,
      onProgress: (message) => {
        console.log(`[Progress] ${message}`);
      },
    });
  } finally {
    await teardownAppProcess(cwd);
  }

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

  const webm = findLatestRecording(resolve(recordingsDir));
  if (webm && statSync(webm).mtimeMs >= startTime) {
    console.log(`Recording: ${webm}`);
    console.log(`Transcode: ffmpeg -y -i "${webm}" "${webm.replace(/\.webm$/, ".mp4")}"`);
  } else {
    console.log(`No fresh recording found under ${resolve(recordingsDir)}`);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
