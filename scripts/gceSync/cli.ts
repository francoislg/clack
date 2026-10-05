import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parseBaseline, serializeBaseline, withAgreement, type Baseline } from "./baseline.js";
import { localInventory, parseSha256sum, remoteInventoryCommand } from "./inventory.js";
import {
  PULL_ALL_PRUNED_PATHS,
  isUnder,
  parseManifest,
  selectRoots,
  unpushableEntries,
} from "./manifest.js";
import { planPull, planPush, type Inventory, type PushPlan } from "./plan.js";
import {
  containerReadCheckCommand,
  NO_CONTAINER_MARKER,
  pullArchiveCommand,
  pushApplyCommand,
  readRemoteFileCommand,
} from "./remoteCommands.js";
import { formatPullPlan, formatPushPlan, localStamp } from "./report.js";
import { pullArchive, pushArchive, runSsh, vmTargetFromEnv, type VmTarget } from "./vm.js";

const HELP = `gce-sync — sync ./data between this clone and the VM.

Usage: npx tsx scripts/gceSync/cli.ts <pull|push> [flags]

Flags:
  --dry-run              Show the plan; write nothing.
  --show <file>          Diff one file (VM vs local) and exit; makes no changes.
  --path <path>          Limit the sync to a manifest path (repeatable).
  --all                  (pull only) Sweep all of data/, minus caches and clones.
  --overwrite <path>     (push only) Allow replacing this file/dir (repeatable).
  -h, --help             Show this help.

push creates files missing on the VM, replaces only files named with --overwrite
whose VM copy is unchanged since the last sync, and never deletes.

pull replaces local files the VM changed, backs up local copies that had their own
edits, keeps local-only changes, and never deletes.`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function usageError(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function writeBaseline(baselinePath: string, baseline: Baseline): void {
  writeFileSync(baselinePath, serializeBaseline(baseline));
}

function readBaselineText(baselinePath: string): string | undefined {
  try {
    return readFileSync(baselinePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Diffs one file (VM copy vs local copy) to the terminal. */
async function runShow(
  target: VmTarget,
  projectDir: string,
  roots: readonly string[],
  file: string,
): Promise<void> {
  if (!roots.some((root) => isUnder(file, root))) {
    usageError(`✗ --show path is outside the sync scope: ${file}`);
    return;
  }
  const content = await runSsh(target, readRemoteFileCommand(target.mount, file));
  const dir = mkdtempSync(join(tmpdir(), "gce-show-"));
  try {
    const vmCopy = join(dir, "vm-copy");
    writeFileSync(vmCopy, content);
    const localPath = join(projectDir, file);
    const localArg = existsSync(localPath) ? localPath : "/dev/null";
    spawnSync(
      "diff",
      ["-u", "--label", `vm/${file}`, "--label", `local/${file}`, vmCopy, localArg],
      { stdio: "inherit" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function applyPush(
  target: VmTarget,
  projectDir: string,
  plan: PushPlan,
  remote: Inventory,
  baseline: Baseline,
  baselinePath: string,
): Promise<void> {
  if (plan.refused.length > 0) {
    usageError("✗ Nothing pushed: resolve the refused files first.");
    return;
  }
  if (plan.create.length === 0 && plan.replace.length === 0) {
    console.log("Nothing to push.");
    writeBaseline(baselinePath, withAgreement(baseline, plan.agreed));
    return;
  }

  const stamp = localStamp(new Date());
  const replaced = plan.replace.map((path) => {
    const expectedVmHash = remote.get(path);
    if (expectedVmHash === undefined) throw new Error(`no VM hash for ${path}`);
    return { path, expectedVmHash };
  });
  const written = [...plan.replace, ...plan.create];
  await pushArchive(
    target,
    projectDir,
    written,
    pushApplyCommand(target.mount, stamp, replaced, plan.create),
  );
  console.log(`✓ Pushed ${written.length} file(s)`);
  if (replaced.length > 0) {
    console.log(`  VM copies backed up to ${target.mount}/.gce-sync-backups/push-${stamp}/`);
  }

  writeBaseline(baselinePath, withAgreement(baseline, plan.agreed));

  let output: string;
  try {
    output = await runSsh(target, containerReadCheckCommand(written));
  } catch (error) {
    console.log(
      `⚠ Could not verify container read access (the push itself succeeded): ${errorMessage(error)}`,
    );
    return;
  }
  if (output.includes(NO_CONTAINER_MARKER)) {
    console.log("  (clack container not running — read-access check skipped)");
    return;
  }
  const unreadable = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (unreadable.length > 0) {
    console.error("✗ The container user cannot read:");
    for (const line of unreadable) console.error(`  • ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log("✓ Container read-access verified");
}

async function runPush(
  target: VmTarget,
  projectDir: string,
  dryRun: boolean,
  overwrite: readonly string[],
  local: Inventory,
  remote: Inventory,
  baseline: Baseline,
  baselinePath: string,
): Promise<void> {
  let plan: PushPlan;
  try {
    plan = planPush(local, remote, baseline, overwrite);
  } catch (error) {
    usageError(`✗ ${errorMessage(error)}`);
    return;
  }
  console.log(formatPushPlan(plan));

  if (dryRun) {
    console.log("(dry run — nothing written)");
    return;
  }
  await applyPush(target, projectDir, plan, remote, baseline, baselinePath);
}

export async function runPull(
  target: VmTarget,
  projectDir: string,
  dryRun: boolean,
  local: Inventory,
  remote: Inventory,
  baseline: Baseline,
  baselinePath: string,
): Promise<void> {
  const plan = planPull(local, remote, baseline);
  console.log(formatPullPlan(plan));

  if (dryRun) {
    console.log("(dry run — nothing written)");
    return;
  }

  const stamp = localStamp(new Date());
  const backedUp = plan.replace.filter((entry) => entry.backup);
  for (const entry of backedUp) {
    const dest = join(projectDir, "data/.gce-sync-backups", `pull-${stamp}`, entry.path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(projectDir, entry.path), dest);
  }
  if (backedUp.length > 0) {
    console.log(`  Local copies backed up to data/.gce-sync-backups/pull-${stamp}/`);
  }

  const files = [...plan.create, ...plan.replace.map((r) => r.path)];
  if (files.length === 0) {
    console.log("Nothing to pull.");
    writeBaseline(baselinePath, withAgreement(baseline, plan.agreed));
    return;
  }

  await pullArchive(target, projectDir, files, pullArchiveCommand(target.mount));
  console.log(`✓ Pulled ${files.length} file(s)`);
  writeBaseline(baselinePath, withAgreement(baseline, plan.agreed));
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      "dry-run": { type: "boolean" },
      show: { type: "string" },
      path: { type: "string", multiple: true },
      overwrite: { type: "string", multiple: true },
      all: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const cmd = positionals[0];
  if (positionals.length !== 1 || (cmd !== "pull" && cmd !== "push")) {
    usageError("Usage: npx tsx scripts/gceSync/cli.ts <pull|push> [flags]  (see --help)");
    return;
  }
  if (values.overwrite && cmd !== "push") {
    usageError("--overwrite is only valid with push.");
    return;
  }
  if (values.all && cmd !== "pull") {
    usageError("--all is only valid with pull.");
    return;
  }
  if (values.all && values.path) {
    usageError("--all and --path cannot be combined.");
    return;
  }

  const projectDir = process.env.GCE_PROJECT_DIR ?? process.cwd();
  const target = vmTargetFromEnv();

  let manifest: string[];
  try {
    manifest = parseManifest(readFileSync(join(projectDir, "data/.deploy-include"), "utf8"));
  } catch {
    usageError(
      "✗ Manifest not found: data/.deploy-include (cp data/.deploy-include.example data/.deploy-include)",
    );
    return;
  }

  if (cmd === "push") {
    const problems = unpushableEntries(manifest);
    if (problems.length > 0) {
      console.error("✗ Manifest has paths push never writes:");
      for (const problem of problems) console.error(`  • ${problem}`);
      process.exitCode = 1;
      return;
    }
  }

  let roots: string[];
  let pruned: string[];
  if (cmd === "pull" && values.all) {
    roots = ["data"];
    pruned = [...PULL_ALL_PRUNED_PATHS];
  } else {
    try {
      roots = selectRoots(manifest, values.path ?? []);
    } catch (error) {
      usageError(`✗ ${errorMessage(error)}`);
      return;
    }
    pruned = [];
  }

  if (values.show !== undefined) {
    await runShow(target, projectDir, roots, values.show);
    return;
  }

  const baselinePath = join(projectDir, "data/.gce-sync-baseline.json");
  const { baseline, warning } = parseBaseline(readBaselineText(baselinePath));
  if (warning) console.log(`⚠ ${warning}`);

  const local = localInventory(projectDir, roots, pruned);
  const remote = parseSha256sum(
    await runSsh(target, remoteInventoryCommand(target.mount, roots, pruned)),
  );
  if (remote.unsupported.length > 0) {
    console.log(`⚠ Skipped ${remote.unsupported.length} VM file(s) with unsupported names:`);
    for (const line of remote.unsupported) console.log(`  • ${line}`);
  }

  console.log(`=== gce-${cmd} — local ./data ⇄ ${target.instance}:${target.mount} ===`);

  if (cmd === "push") {
    await runPush(
      target,
      projectDir,
      Boolean(values["dry-run"]),
      values.overwrite ?? [],
      local,
      remote.inventory,
      baseline,
      baselinePath,
    );
  } else {
    await runPull(
      target,
      projectDir,
      Boolean(values["dry-run"]),
      local,
      remote.inventory,
      baseline,
      baselinePath,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`✗ ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
