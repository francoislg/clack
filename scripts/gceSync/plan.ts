import type { Baseline } from "./baseline.js";
import { isUnder } from "./manifest.js";

/** Path → sha256 of one side's files. */
export type Inventory = ReadonlyMap<string, string>;

export type Classification =
  | "local-only"
  | "vm-only"
  | "in-sync"
  | "changed-local"
  | "changed-vm"
  | "changed-both";

export function classify(
  local: string | undefined,
  vm: string | undefined,
  base: string | undefined,
): Classification {
  if (local === undefined) return "vm-only";
  if (vm === undefined) return "local-only";
  if (local === vm) return "in-sync";
  if (vm === base) return "changed-local";
  if (local === base) return "changed-vm";
  return "changed-both";
}

export type DifferingClassification = Extract<
  Classification,
  "changed-local" | "changed-vm" | "changed-both"
>;

export interface ClassifiedFile {
  path: string;
  classification: Classification;
}

export interface DifferingFile {
  path: string;
  classification: DifferingClassification;
}

function unhandled(classification: string): Error {
  return new Error(`unhandled classification: ${classification}`);
}

function classifyAll(local: Inventory, vm: Inventory, baseline: Baseline): ClassifiedFile[] {
  const paths = [...new Set([...local.keys(), ...vm.keys()])].sort();
  return paths.map((path) => ({
    path,
    classification: classify(local.get(path), vm.get(path), baseline.get(path)),
  }));
}

function hashOf(inventory: Inventory, path: string): string {
  const hash = inventory.get(path);
  if (hash === undefined) throw new Error(`no hash for ${path}`);
  return hash;
}

export interface PullPlan {
  create: string[];
  /** `backup` is set when the local copy has edits of its own (it differs from the baseline). */
  replace: Array<{ path: string; backup: boolean }>;
  pendingPush: string[];
  localOnly: string[];
  inSync: string[];
  /** Baseline entries to record once the pull succeeds. */
  agreed: Map<string, string>;
}

export function planPull(local: Inventory, vm: Inventory, baseline: Baseline): PullPlan {
  const plan: PullPlan = {
    create: [],
    replace: [],
    pendingPush: [],
    localOnly: [],
    inSync: [],
    agreed: new Map(),
  };
  for (const { path, classification } of classifyAll(local, vm, baseline)) {
    switch (classification) {
      case "vm-only":
        plan.create.push(path);
        plan.agreed.set(path, hashOf(vm, path));
        break;
      case "local-only":
        plan.localOnly.push(path);
        break;
      case "in-sync":
        plan.inSync.push(path);
        plan.agreed.set(path, hashOf(vm, path));
        break;
      case "changed-local":
        plan.pendingPush.push(path);
        break;
      case "changed-vm":
        plan.replace.push({ path, backup: false });
        plan.agreed.set(path, hashOf(vm, path));
        break;
      case "changed-both":
        plan.replace.push({ path, backup: true });
        plan.agreed.set(path, hashOf(vm, path));
        break;
      default:
        throw unhandled(classification satisfies never);
    }
  }
  return plan;
}

export interface PushPlan {
  create: string[];
  replace: string[];
  /** Differing files not named with `--overwrite`: listed, never written. */
  skipped: DifferingFile[];
  /** Named with `--overwrite` but the VM copy changed since the last sync. */
  refused: DifferingFile[];
  vmOnly: string[];
  inSync: string[];
  agreed: Map<string, string>;
}

/**
 * `overwrite` entries are exact files or directories. An entry matching no file on either side
 * throws, so a typo can't pass for a no-op.
 */
export function planPush(
  local: Inventory,
  vm: Inventory,
  baseline: Baseline,
  overwrite: readonly string[],
): PushPlan {
  const targets = overwrite.map((o) => o.replace(/\/+$/, ""));
  const files = classifyAll(local, vm, baseline);
  const unmatched = targets.filter((t) => !files.some((f) => isUnder(f.path, t)));
  if (unmatched.length > 0) {
    throw new Error(`--overwrite matches no file: ${unmatched.join(", ")}`);
  }
  const named = (path: string) => targets.some((t) => isUnder(path, t));

  const plan: PushPlan = {
    create: [],
    replace: [],
    skipped: [],
    refused: [],
    vmOnly: [],
    inSync: [],
    agreed: new Map(),
  };
  for (const { path, classification } of files) {
    switch (classification) {
      case "local-only":
        plan.create.push(path);
        plan.agreed.set(path, hashOf(local, path));
        break;
      case "vm-only":
        plan.vmOnly.push(path);
        break;
      case "in-sync":
        plan.inSync.push(path);
        plan.agreed.set(path, hashOf(local, path));
        break;
      case "changed-local":
        if (named(path)) {
          plan.replace.push(path);
          plan.agreed.set(path, hashOf(local, path));
        } else {
          plan.skipped.push({ path, classification });
        }
        break;
      case "changed-vm":
      case "changed-both":
        (named(path) ? plan.refused : plan.skipped).push({ path, classification });
        break;
      default:
        throw unhandled(classification satisfies never);
    }
  }
  return plan;
}
