import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ArrayStoreHandle } from "../state/resilientStore.js";
import type { FileLedgerEntry } from "./ledger.js";

const store = vi.hoisted(() => ({
  load: vi.fn<ArrayStoreHandle<FileLedgerEntry>["load"]>(),
  save: vi.fn<ArrayStoreHandle<FileLedgerEntry>["save"]>(),
  clearCache: vi.fn<ArrayStoreHandle<FileLedgerEntry>["clearCache"]>(),
  isFrozen: vi.fn<ArrayStoreHandle<FileLedgerEntry>["isFrozen"]>(),
}));

vi.mock("../state/resilientStore.js", () => ({
  createArrayStore: vi.fn(() => store),
}));

vi.mock("../config.js", () => ({
  getFileLedgerPath: vi.fn(() => "/data/state/file-ledger.json"),
}));

import { clearLedgerCache, entryKey, loadLedger, updateLedger } from "./ledger.js";

function entry(path: string): FileLedgerEntry {
  return { root: "downloads", path, owner: "s", createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("file ledger", () => {
  let persisted: FileLedgerEntry[];

  beforeEach(() => {
    persisted = [];
    store.load.mockImplementation(async () => persisted);
    store.save.mockImplementation(async (items) => {
      persisted = items;
      return true;
    });
  });

  it("loads through the store", async () => {
    persisted = [entry("s/a.txt")];
    await expect(loadLedger()).resolves.toEqual([entry("s/a.txt")]);
  });

  it("serializes two concurrent updates so both mutations land", async () => {
    await Promise.all([
      updateLedger((entries) => [...entries, entry("s/a.txt")]),
      updateLedger((entries) => [...entries, entry("s/b.txt")]),
    ]);
    expect(persisted).toEqual([entry("s/a.txt"), entry("s/b.txt")]);
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it("throws when the save is refused", async () => {
    store.save.mockResolvedValue(false);
    await expect(updateLedger((entries) => entries)).rejects.toThrow(/file ledger/);
  });

  it("keeps serving updates after a failed one", async () => {
    store.save.mockResolvedValueOnce(false);
    await expect(updateLedger((entries) => entries)).rejects.toThrow(
      "Failed to save the file ledger",
    );
    await updateLedger((entries) => [...entries, entry("s/c.txt")]);
    expect(persisted).toEqual([entry("s/c.txt")]);
  });

  it("builds an entry key from root and path", () => {
    expect(entryKey("recordings", "tester/x.mp4")).toBe("recordings:tester/x.mp4");
  });

  it("clears the store cache", () => {
    clearLedgerCache();
    expect(store.clearCache).toHaveBeenCalled();
  });
});
