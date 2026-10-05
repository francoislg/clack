import { z } from "zod";
import { getFileLedgerPath, type ManagedRootName } from "../config.js";
import { createArrayStore } from "../state/resilientStore.js";

// Graceful (permissive) reader: persisted state, so no `.strict()` and no date coercion.
export const fileLedgerEntryZod = z.object({
  root: z.enum(["downloads", "recordings"]),
  path: z.string(),
  owner: z.string(),
  createdAt: z.string(),
  uploadedAt: z.string().optional(),
  fileId: z.string().optional(),
  permalink: z.string().optional(),
  channel: z.string().optional(),
  threadTs: z.string().optional(),
});

export type FileLedgerEntry = z.infer<typeof fileLedgerEntryZod>;

const ledgerStore = createArrayStore<FileLedgerEntry>({
  storeId: "file-ledger",
  label: "file ledger",
  getPath: getFileLedgerPath,
  entrySchema: fileLedgerEntryZod,
  collectionKey: "files",
});

let writeChain: Promise<void> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function loadLedger(): Promise<FileLedgerEntry[]> {
  return ledgerStore.load();
}

export async function updateLedger(
  mutate: (entries: FileLedgerEntry[]) => FileLedgerEntry[],
): Promise<void> {
  await serialize(async () => {
    const current = await ledgerStore.load();
    const next = mutate([...current]);
    const saved = await ledgerStore.save(next);
    if (!saved) {
      throw new Error("Failed to save the file ledger");
    }
  });
}

export function entryKey(root: ManagedRootName, relPath: string): string {
  return `${root}:${relPath}`;
}

export function clearLedgerCache(): void {
  ledgerStore.clearCache();
}
