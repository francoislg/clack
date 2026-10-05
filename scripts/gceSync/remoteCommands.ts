import { dirname } from "node:path";
import { shellQuote, shellWords } from "./shell.js";

/** The container user (uid/gid 1001 per the Dockerfile) must own everything it reads or edits. */
const CONTAINER_OWNER = "1001:1001";

export const NO_CONTAINER_MARKER = "__NOCONTAINER__";

export const EXTRACT_FAILED_EXIT = 4;

/** Every ancestor directory of `paths` below `data/`, deepest first, deduplicated. */
export function ancestorDirs(paths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const path of paths) {
    for (
      let dir = dirname(path);
      dir !== "data" && dir !== "." && dir !== "/";
      dir = dirname(dir)
    ) {
      dirs.add(dir);
    }
  }
  return [...dirs].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export interface ReplacedFile {
  path: string;
  /** The VM hash the plan was made against; the push aborts if the file changed since. */
  expectedVmHash: string;
}

/**
 * Runs on the VM with a tar archive on stdin. Before extracting, it re-checks that every file
 * to replace still has the hash the plan saw and that every file to create still doesn't exist,
 * so an edit landing between planning and pushing aborts the whole push. It then backs up the
 * files to replace to `<mount>/.gce-sync-backups/push-<stamp>/` (outside `data/`), extracts,
 * and hands the written files and any directories tar created to the container user.
 */
export function pushApplyCommand(
  mount: string,
  stamp: string,
  replaced: readonly ReplacedFile[],
  created: readonly string[],
): string {
  const replacedPaths = replaced.map((r) => r.path);
  const written = [...replacedPaths, ...created];
  const lines = ["set -e", `cd ${shellQuote(mount)}`];
  if (replaced.length > 0) {
    const checks = replaced.map((r) => `${r.expectedVmHash}  ${r.path}`).join("\n");
    lines.push(
      `printf '%s\\n' ${shellQuote(checks)} | sudo sha256sum -c --quiet - >/dev/null 2>&1 || { echo 'A file to replace changed on the VM since the plan was made; nothing pushed.' >&2; exit 3; }`,
    );
  }
  if (created.length > 0) {
    lines.push(
      `for f in ${shellWords(created)}; do [ ! -e "$f" ] || { echo "$f appeared on the VM since the plan was made; nothing pushed." >&2; exit 3; }; done`,
    );
  }
  if (replaced.length > 0) {
    lines.push(
      `B=${shellQuote(`${mount}/.gce-sync-backups/push-${stamp}`)}`,
      `for f in ${shellWords(replacedPaths)}; do`,
      `  sudo mkdir -p "$B/$(dirname "$f")"`,
      `  sudo cp -p "$f" "$B/$f"`,
      `done`,
    );
  }
  const handOver = [
    `sudo chown ${CONTAINER_OWNER} ${shellWords(written)}`,
    `sudo chmod u+rw,go+r ${shellWords(written)}`,
  ];
  const dirs = ancestorDirs(written);
  if (dirs.length > 0) {
    handOver.push(
      `sudo chown ${CONTAINER_OWNER} ${shellWords(dirs)}`,
      `sudo chmod u+rwx,go+rx ${shellWords(dirs)}`,
    );
  }
  // A partial extraction still hands over what it wrote, so the bot can read it.
  const salvage = [
    ...handOver.map((command) => `{ ${command} 2>/dev/null || true; }`),
    "echo 'Extraction failed partway; the files written so far were handed to the container user.' >&2",
    `exit ${EXTRACT_FAILED_EXIT}`,
  ].join("; ");
  lines.push(`sudo tar -xf - || { ${salvage}; }`, ...handOver);
  return lines.join("\n");
}

/** Runs on the VM with a newline-separated path list on stdin; writes a tar of them to stdout. */
export function pullArchiveCommand(mount: string): string {
  return `cd ${shellQuote(mount)} && sudo tar -cf - -T -`;
}

export function readRemoteFileCommand(mount: string, path: string): string {
  return `sudo cat ${shellQuote(`${mount}/${path}`)} 2>/dev/null || true`;
}

/**
 * Lists the paths (relative, e.g. `data/config.json`) the running container's user can't read.
 * Prints the no-container marker when clack isn't running, since there is nothing to check.
 */
export function containerReadCheckCommand(paths: readonly string[]): string {
  const inner = `for p in ${shellWords(paths.map((p) => `/app/${p}`))}; do [ -r "$p" ] || echo "\${p#/app/}"; done`;
  return [
    `docker ps --format '{{.Names}}' | grep -q '^clack$' || { echo ${NO_CONTAINER_MARKER}; exit 0; }`,
    `docker exec clack sh -c ${shellQuote(inner)}`,
  ].join("\n");
}
