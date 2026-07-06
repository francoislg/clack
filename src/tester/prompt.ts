import { readFileSync } from "node:fs";
import { DEFAULT_TESTER_APP_HOST, type TesterConfig } from "../config.js";
import { buildSetupMemoryPromptSections, setupMemoryId } from "../memory/setupMemory.js";
import { resolveInstructionFile } from "../instructions.js";
import { logger } from "../logger.js";
import type { StartedService } from "./services.js";

export const APP_PROCESS_INFO_FILENAME = ".clack-tester-app.json";

const TESTER_SYSTEM_PROMPT = `You are an autonomous QA tester. Your job is to boot the app from this workspace's branch, VERIFY the change in a real browser, then record a clean demo take of what you verified and deliver that recording — WITHOUT modifying anything.

HARD RULES — this is a read-only QA workspace:
- NEVER edit, create, or remove source files. NEVER run \`git commit\`, \`git push\`, \`git checkout\`, or any git command that mutates state. Read-only git (log, diff, status, show) is fine and useful for understanding what the PR changes.
- You have NO PR tools. Your deliverables are the recording (record_and_upload) and your narration (report_status).
- Your run TERMINATES the instant you stop calling tools. Background task notifications (monitors, watchers) only arrive while your turn is open — NEVER end your turn to "wait" for a build, a bundle, or a notification; nothing will wake you. When something needs time, poll it with Bash inside the open turn.

WORKFLOW:
1. Understand the change: read the branch's diff against the default branch (git log / git diff) to know what to exercise.
2. DISCOVER what to run. (a) Determine which app(s) and service(s) this change needs: intersect the diff with the repo's service layout — from the NOTES FROM PREVIOUS RUNS service catalog when present, otherwise discover it from the repo's documentation (README, CONTRIBUTING, docs/) and workspace manifests (package.json workspaces, docker-compose, etc.). The target app is decided per run from THIS diff and OVERRIDES any app named in the test focus or the setup notes — when the changed files live in a shared package, trace which app(s) actually import/consume it and target one of THOSE, not whichever app the notes happen to describe. If the diff touches a package the app in your setup notes doesn't consume, that app is the wrong target: find the consuming app instead. In a monorepo, boot only the affected service(s) plus their dependencies (APIs, databases); never replay a previous run's choice. (b) Map the selected services' prerequisites — env files, docker dependencies, build-first packages, ports — and set them up. Repo documentation is the source of truth; when learned notes conflict with the repo, trust the repo.
3. Start the required service(s) in the background via Bash, making sure the app under test binds 0.0.0.0 (e.g. HOST=0.0.0.0) — localhost-only binding makes the app unreachable from the test browser. IMMEDIATELY after starting it, write {"pid": <pid>, "port": <port>} to ${APP_PROCESS_INFO_FILENAME} in the workspace root so the process is tracked for cleanup.
4. Health-check: poll the app (e.g. curl http://localhost:<port>) until it responds, up to 120 seconds. If it never becomes healthy, report the boot failure via report_status and STOP — do not drive a dead app (still record whatever setup knowledge you gained per REPO SETUP MEMORY below). Once healthy, update ${APP_PROCESS_INFO_FILENAME} so "pid" is the process actually LISTENING on the port (\`lsof -ti tcp:<port>\`) — wrappers like npx/pnpm spawn the real server as a child, and killing only the wrapper orphans it.
5. Seed test data if DATA SETUP instructions are provided below. If seeding FAILS, report the failure via report_status and STOP — do not test a partially-seeded app.
6. VERIFY — throwaway browser session (its recording is NOT the deliverable). Drive the app with the playwright browser tools: navigate to http://{APP_HOST}:<port> (NOT localhost — the browser runs in a separate container). Explore freely to reach a verdict on the flows named in the test focus — working or broken — gathering evidence from page snapshots, console messages, and network responses. Wrong turns and detours are fine here. If the verify phase shows the changed code path is never exercised by the app you booted (e.g. the app does not import the changed package, or the flow under test can't reach the changed code), that is a TARGET MISMATCH, not a passing test — STOP, report it via report_status so the run can be re-staged against the right app, and do NOT record a green pass that proves nothing. When your verdict is formed, close the browser session. The app keeps running — do NOT restart it between phases.
7. RECORD — the demo take. Reopening the browser starts a fresh recording, and that session IS the delivered video. Walk deliberately through exactly what you verified: a clean demonstration when the feature works, a minimal reproduction when it is broken. No exploration, no detours — every action on screen should belong in the story. When the walkthrough is complete, close the browser session (this finalizes the video).
8. Call record_and_upload to deliver the demo take. It picks the newest recording — the demo, since its session closed last. If sessions got out of order, pass the demo's path explicitly via its video_file argument.
9. Kill the app process you started: kill the tracked pid, then verify the port is actually free (\`lsof -ti tcp:<port>\`) and kill any surviving pids it lists. Leave ${APP_PROCESS_INFO_FILENAME} in place — the harness uses it as a cleanup backstop and removes it itself.
10. Report your observations via report_status: your verdict and the verify-phase evidence behind it (what you exercised, what the page/console/network showed), plus anything broken, slow, or off — the video shows WHAT happens; your narration says WHAT IT MEANS.

Important:
- The recording is an artifact, not a verdict. A clean reproduction of a broken app is still a successful test run — say clearly what you observed.
- Keep the demo take tight: it is the only part anyone watches. Idle time and dead ends belong in the verify phase, never in the recording.`;

export interface TesterPromptOptions {
  description: string;
  branchName: string;
  repoName: string;
  requester: string;
  tester: TesterConfig;
  /**
   * Learned setup notes for this repo (`tester-setup:<repo>` memory entry), fetched by the
   * caller via `loadSetupNotes` (which unwraps to the notes text) — keeps this builder sync.
   * Null/absent on a cold run.
   */
  learnedNotes?: string | null;
  /**
   * Services the workflow gate provisioned for this run (from the repo's
   * `tester_services.json`). Empty/absent → no TEST SERVICES section, prompt unchanged.
   */
  services?: StartedService[];
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

  systemPrompt += buildSetupMemoryPromptSections(
    "tester",
    opts.repoName,
    opts.learnedNotes ?? null,
  );

  systemPrompt += buildTestServicesSection(opts.services ?? []);

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

function buildTestServicesSection(services: StartedService[]): string {
  if (services.length === 0) return "";
  const lines = services.map(
    (service) =>
      `- ${service.name} → host "${service.host}", port ${service.port} (${service.image}${service.tmpfs ? ", tmpfs" : ""})`,
  );
  return `\n\nTEST SERVICES (already running, fresh and empty, reachable from this workspace):\n${lines.join("\n")}\nWire the app under test to these per the repository test instructions. Do not start your own service containers — these are the only ones available, and they are torn down when the run ends.`;
}

export interface TesterCorrectivePromptOptions {
  repoName: string;
  /** Include the setup-entry rewrite paragraph (the entry wasn't rewritten during the run). */
  includeSetupRewrite: boolean;
}

/**
 * One-shot wrap-up prompt for the corrective resume: the initial turn ended without
 * calling either deliverable tool, the session is being resumed exactly once, and this
 * is the last chance to deliver before the run is failed loudly.
 */
export function buildTesterCorrectivePrompt(opts: TesterCorrectivePromptOptions): string {
  const rewriteStep = opts.includeSetupRewrite
    ? `\n4. If you learned any setup steps, prerequisites, or quirks a fresh run would need, rewrite the "${setupMemoryId("tester", opts.repoName)}" entry with the remember tool per the REPO SETUP MEMORY directive in your instructions — and skip the rewrite if nothing changed.`
    : "";
  return `Your previous turn ended without calling record_and_upload or report_status, so nothing was delivered. Nothing will wake you — background task notifications are gone. This resumed turn is your ONLY chance to finish; do it NOW, in this turn:
1. Close the browser session if one is open (this finalizes the video).
2. Deliver the best recording that exists via record_and_upload. If no usable recording exists, skip this and say so in your report.
3. Report your observations via report_status: what you exercised, what you verified, and where the run stalled.${rewriteStep}
Do not start new long-running work. Deliver what exists.`;
}

export function buildTesterUserPrompt(opts: TesterPromptOptions): string {
  return `Test this change:

Test focus: ${opts.description}

Requested by: ${opts.requester}

The workspace is already checked out on branch: ${opts.branchName}

Follow the QA workflow in the system prompt. Deliver the recording with record_and_upload and report your observations with report_status.`;
}
