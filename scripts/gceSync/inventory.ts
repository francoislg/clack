import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, type Stats } from "node:fs";
import { join } from "node:path";
import { isUnder } from "./manifest.js";
import { shellQuote, shellWords } from "./shell.js";
import type { Inventory } from "./plan.js";

/** macOS metadata files, skipped in both directions. */
function isIgnoredName(name: string): boolean {
  return name === ".DS_Store" || name.startsWith("._");
}

function statOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

/**
 * sha256 of every regular file under `roots` (paths relative to `projectDir`). Symlinks are
 * skipped, matching the VM side's `find -type f`.
 */
export function localInventory(
  projectDir: string,
  roots: readonly string[],
  pruned: readonly string[] = [],
): Inventory {
  const inventory = new Map<string, string>();
  const visit = (path: string): void => {
    if (pruned.some((p) => isUnder(path, p))) return;
    const stat = statOrUndefined(join(projectDir, path));
    if (stat?.isDirectory()) {
      for (const name of readdirSync(join(projectDir, path))) {
        if (!isIgnoredName(name)) visit(`${path}/${name}`);
      }
    } else if (stat?.isFile()) {
      const hash = createHash("sha256").update(readFileSync(join(projectDir, path)));
      inventory.set(path, hash.digest("hex"));
    }
  };
  for (const root of roots) visit(root);
  return inventory;
}

/** Shell run on the VM that prints `sha256sum` lines for every regular file under `roots`. */
export function remoteInventoryCommand(
  mount: string,
  roots: readonly string[],
  pruned: readonly string[] = [],
): string {
  const prunes = [
    "-name '._*'",
    "-name '.DS_Store'",
    ...pruned.map((p) => `-path ${shellQuote(p)}`),
  ].join(" -o ");
  return [
    `cd ${shellQuote(mount)} || exit 0`,
    `for p in ${shellWords(roots)}; do`,
    `  sudo test -e "$p" || continue`,
    `  sudo find "$p" \\( ${prunes} \\) -prune -o -type f -exec sha256sum {} +`,
    `done`,
  ].join("\n");
}

/**
 * Parses `sha256sum` output. A line starting with `\` is sha256sum's escaped form for a name
 * holding a backslash or newline; those come back as `unsupported` rather than guessed at.
 */
export function parseSha256sum(output: string): { inventory: Inventory; unsupported: string[] } {
  const inventory = new Map<string, string>();
  const unsupported: string[] = [];
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (match) inventory.set(match[2], match[1]);
    else unsupported.push(line);
  }
  return { inventory, unsupported };
}
