import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface VmTarget {
  instance: string;
  zone: string;
  mount: string;
}

/** Noise every VM round-trip prints; dropped before an error surfaces its stderr tail. */
const IGNORED_STDERR = /known_hosts|LIBARCHIVE\.xattr|Warning: Permanently added/;

/** Reads GCE_INSTANCE, GCE_ZONE, GCE_DATA_MOUNT; throws an Error naming the missing ones. */
export function vmTargetFromEnv(env: NodeJS.ProcessEnv = process.env): VmTarget {
  const instance = env.GCE_INSTANCE;
  const zone = env.GCE_ZONE;
  const mount = env.GCE_DATA_MOUNT;
  const missing = [
    ["GCE_INSTANCE", instance],
    ["GCE_ZONE", zone],
    ["GCE_DATA_MOUNT", mount],
  ].flatMap(([name, value]) => (value ? [] : [name]));
  if (!instance || !zone || !mount) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
  return { instance, zone, mount };
}

/** Resolves once the process closes (or fails to spawn), with its exit code and collected stderr. */
function waitForClose(child: ChildProcess): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      resolve({ code: 1, stderr });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stderr });
    });
  });
}

/** An Error naming the failed process, followed by the last 20 meaningful stderr lines. */
export function processError(label: string, code: number, stderr: string): Error {
  const lines = stderr
    .split("\n")
    .filter((line) => line.trim() !== "" && !IGNORED_STDERR.test(line))
    .slice(-20);
  return new Error(`${label} exited with code ${code}\n${lines.join("\n")}`);
}

/** Spawns `gcloud compute ssh` against `target`, running `command` on the VM. */
function spawnSsh(target: VmTarget, command: string): ChildProcess {
  return spawn("gcloud", [
    "compute",
    "ssh",
    target.instance,
    `--zone=${target.zone}`,
    "--quiet",
    `--command=${command}`,
  ]);
}

/** Runs `command` on the VM; resolves with stdout (utf-8). */
export async function runSsh(target: VmTarget, command: string, input?: string): Promise<string> {
  const ssh = spawnSsh(target, command);
  let stdout = "";
  ssh.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  // A reader that exits early (EPIPE) is reported through its exit code, not this stream.
  ssh.stdin?.on("error", () => {});
  if (input !== undefined) ssh.stdin?.write(input);
  ssh.stdin?.end();
  const { code, stderr } = await waitForClose(ssh);
  if (code !== 0) throw processError("ssh", code, stderr);
  return stdout;
}

/**
 * Pipes `producer`'s stdout into `consumer`'s stdin and waits for both. A consumer that exits
 * first kills the producer, which would otherwise block forever on a pipe nobody drains. The
 * failure reported is the consumer's when it ended the transfer, ssh's otherwise.
 */
async function runTransfer(
  producer: ChildProcess,
  consumer: ChildProcess,
  ssh: ChildProcess,
): Promise<void> {
  consumer.stdin?.on("error", () => {});
  if (producer.stdout && consumer.stdin) producer.stdout.pipe(consumer.stdin);
  let consumerEndedFirst = false;
  consumer.once("close", () => {
    if (producer.exitCode === null && producer.signalCode === null) {
      consumerEndedFirst = true;
      producer.kill();
    }
  });
  const results = new Map(
    await Promise.all(
      [producer, consumer].map(async (child) => [child, await waitForClose(child)] as const),
    ),
  );
  const first = consumerEndedFirst ? consumer : ssh;
  for (const child of [first, first === producer ? consumer : producer]) {
    const result = results.get(child);
    if (result && result.code !== 0) {
      throw processError(child === ssh ? "ssh" : "local tar", result.code, result.stderr);
    }
  }
}

/** Streams a local tar of `files` (paths relative to projectDir) into `remoteCommand`'s stdin on the VM. */
export async function pushArchive(
  target: VmTarget,
  projectDir: string,
  files: readonly string[],
  remoteCommand: string,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "gce-sync-"));
  const listFile = join(dir, "list.txt");
  try {
    writeFileSync(listFile, `${files.join("\n")}\n`);
    const tar = spawn("tar", ["--no-mac-metadata", "--no-xattrs", "-cf", "-", "-T", listFile], {
      cwd: projectDir,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    const ssh = spawnSsh(target, remoteCommand);
    await runTransfer(tar, ssh, ssh);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Sends `files` (newline-separated) to `remoteCommand`'s stdin and extracts the tar it writes to stdout into projectDir. */
export async function pullArchive(
  target: VmTarget,
  projectDir: string,
  files: readonly string[],
  remoteCommand: string,
): Promise<void> {
  const ssh = spawnSsh(target, remoteCommand);
  ssh.stdin?.on("error", () => {});
  ssh.stdin?.write(`${files.join("\n")}\n`);
  ssh.stdin?.end();
  const tar = spawn("tar", ["-xf", "-"], { cwd: projectDir });
  await runTransfer(ssh, tar, ssh);
}
