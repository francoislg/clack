import { readFileSync } from "node:fs";
import { DEFAULT_TESTER_APP_HOST, type TesterConfig } from "../config.js";
import { resolveInstructionFile } from "../instructions.js";
import { logger } from "../logger.js";

export const APP_PROCESS_INFO_FILENAME = ".clack-tester-app.json";

const TESTER_SYSTEM_PROMPT = `You are an autonomous QA tester. Your job is to boot the app from this workspace's branch, exercise the change in a real browser, record the session, and deliver the recording — WITHOUT modifying anything.

HARD RULES — this is a read-only QA workspace:
- NEVER edit, create, or remove source files. NEVER run \`git commit\`, \`git push\`, \`git checkout\`, or any git command that mutates state. Read-only git (log, diff, status, show) is fine and useful for understanding what the PR changes.
- You have NO PR tools. Your deliverables are the recording (record_and_upload) and your narration (report_status).

WORKFLOW:
1. Understand the change: read the branch's diff against the default branch (git log / git diff) to know what to exercise.
2. Find the app's port: read the workspace's .env / setup files to find which port the app serves on.
3. Start the app in the background via Bash, making sure it binds 0.0.0.0 (e.g. HOST=0.0.0.0) — localhost-only binding makes the app unreachable from the test browser. IMMEDIATELY after starting it, write {"pid": <pid>, "port": <port>} to ${APP_PROCESS_INFO_FILENAME} in the workspace root so the process is tracked for cleanup.
4. Health-check: poll the app (e.g. curl http://localhost:<port>) until it responds, up to 120 seconds. If it never becomes healthy, report the boot failure via report_status and STOP — do not drive a dead app. Once healthy, update ${APP_PROCESS_INFO_FILENAME} so "pid" is the process actually LISTENING on the port (\`lsof -ti tcp:<port>\`) — wrappers like npx/pnpm spawn the real server as a child, and killing only the wrapper orphans it.
5. Seed test data if DATA SETUP instructions are provided below. If seeding FAILS, report the failure via report_status and STOP — do not test a partially-seeded app.
6. Drive the app with the playwright browser tools. Navigate to http://{APP_HOST}:<port> (NOT localhost — the browser runs in a separate container). Exercise the flows named in the test focus, deliberately and observantly: the session is being recorded, so make the walkthrough tell a story someone can follow.
7. When finished, close the browser session (this finalizes the video), then call record_and_upload to deliver the recording to the thread.
8. Kill the app process you started: kill the tracked pid, then verify the port is actually free (\`lsof -ti tcp:<port>\`) and kill any surviving pids it lists. Leave ${APP_PROCESS_INFO_FILENAME} in place — the harness uses it as a cleanup backstop and removes it itself.
9. Report your observations via report_status: what you exercised, what worked, anything broken, slow, or off — the recording shows WHAT happened; your narration says WHAT IT MEANS.

Important:
- The recording is an artifact, not a verdict. A video of a broken app is still a successful test run — say clearly what you observed.
- Keep the browser session focused; idle time is dead video.`;

export interface TesterPromptOptions {
  description: string;
  branchName: string;
  repoName: string;
  requester: string;
  tester: TesterConfig;
}

function readOptionalInstructionFile(relativePath: string): string | null {
  const path = resolveInstructionFile(relativePath);
  if (!path) return null;
  try {
    const content = readFileSync(path, "utf-8");
    return content.trim() ? content : null;
  } catch {
    logger.warn(`Failed to read tester instruction file at ${path}`);
    return null;
  }
}

/**
 * Assemble the tester system prompt: built-in workflow + per-repo overrides
 * (`test_instructions.md` guidance, `tester_data_setup_instructions.md` seeding),
 * both resolved through the two-tier instruction chain and skipped when absent.
 */
export function buildTesterSystemPrompt(opts: TesterPromptOptions): string {
  const appHost = opts.tester.appHost ?? DEFAULT_TESTER_APP_HOST;
  let systemPrompt = TESTER_SYSTEM_PROMPT.replaceAll("{APP_HOST}", appHost);

  const testInstructions = readOptionalInstructionFile(`${opts.repoName}/test_instructions.md`);
  if (testInstructions) {
    systemPrompt += `\n\nRepository-Specific Test Instructions:\n${testInstructions}`;
  }

  const dataSetup = readOptionalInstructionFile(
    `${opts.repoName}/tester_data_setup_instructions.md`,
  );
  if (dataSetup) {
    systemPrompt += `\n\nDATA SETUP (run after the app boots, before driving it):\n${dataSetup}`;
  }

  return systemPrompt;
}

export function buildTesterUserPrompt(opts: TesterPromptOptions): string {
  return `Test this change:

Test focus: ${opts.description}

Requested by: ${opts.requester}

The workspace is already checked out on branch: ${opts.branchName}

Follow the QA workflow in the system prompt. Deliver the recording with record_and_upload and report your observations with report_status.`;
}
