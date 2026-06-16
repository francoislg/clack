import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { foldIdlerLedgerIntoMemory } from "./025-idler-ledger-to-memory.js";
import type { StaticFileResult } from "./types.js";

const IDEAS = "data/plugins/idler/ideas.json";
const MIGRATED = "data/plugins/idler/ideas.json.migrated";
const MEMORY = "data/state/memory.json";

interface Slot {
  priority?: number;
  open?: boolean;
  whereWeAre?: string;
  cursorsByRefId?: { [refId: string]: string };
}
interface Ref {
  kind?: string;
  id?: string;
  howToRead?: string;
  howToComment?: string;
  cursor?: string;
}
interface MemEntry {
  id?: string;
  what?: string;
  nextSteps?: string;
  references?: Ref[];
  plugins?: { idler?: Slot };
}
interface MemStore {
  [id: string]: MemEntry;
}

function content(result: StaticFileResult | undefined): string {
  if (typeof result !== "string") throw new Error("expected file content");
  return result;
}

function parseStore(result: StaticFileResult | undefined): MemStore {
  const store: MemStore = JSON.parse(content(result));
  return store;
}

describe("025 foldIdlerLedgerIntoMemory", () => {
  it("folds a unit into a core entry + plugins.idler slice and backs up + deletes the ledger", () => {
    const ledger = {
      ideas: [
        {
          key: "PROJ-1Q2W",
          source: "sentry",
          open: true,
          priority: 350,
          what: "NPE on login",
          whereWeAre: "triaged",
          nextSteps: "implement fix",
          references: [
            {
              kind: "sentry-issue",
              id: "PROJ-1Q2W",
              howToRead: "read recipe",
              howToComment: "comment recipe",
              cursor: "evt-9",
            },
          ],
        },
      ],
    };
    const out = foldIdlerLedgerIntoMemory({
      [IDEAS]: JSON.stringify(ledger),
      [MEMORY]: null,
      [MIGRATED]: null,
    });

    const memory = parseStore(out[MEMORY]);
    const entry = memory["sentry:PROJ-1Q2W"];
    assert.ok(entry, "namespaced id from source:key");
    assert.equal(entry.what, "NPE on login");
    assert.equal(entry.nextSteps, "implement fix");
    assert.equal(entry.plugins?.idler?.priority, 350);
    assert.equal(entry.plugins?.idler?.open, true);
    assert.equal(entry.plugins?.idler?.whereWeAre, "triaged");
    assert.deepEqual(entry.plugins?.idler?.cursorsByRefId, { "PROJ-1Q2W": "evt-9" });
    assert.equal(entry.references?.[0]?.cursor, undefined, "cursor not on the core reference");

    assert.equal(out[MIGRATED], JSON.stringify(ledger), "original ledger backed up");
    assert.deepEqual(out[IDEAS], { delete: true }, "live ledger removed");
  });

  it("is a no-op when the ledger is missing", () => {
    const out = foldIdlerLedgerIntoMemory({ [IDEAS]: null, [MEMORY]: null, [MIGRATED]: null });
    assert.deepEqual(out, {});
  });

  it("is a no-op when the ledger is empty", () => {
    const out = foldIdlerLedgerIntoMemory({
      [IDEAS]: JSON.stringify({ ideas: [] }),
      [MEMORY]: null,
      [MIGRATED]: null,
    });
    assert.deepEqual(out, {});
  });

  it("preserves existing memory entries; an already-namespaced key is not double-prefixed", () => {
    const ledger = { ideas: [{ key: "asana:5", source: "asana", open: true, priority: 100 }] };
    const memory = { "note:keep": { id: "note:keep", what: "keep me", references: [] } };
    const out = foldIdlerLedgerIntoMemory({
      [IDEAS]: JSON.stringify(ledger),
      [MEMORY]: JSON.stringify(memory),
      [MIGRATED]: null,
    });
    const merged = parseStore(out[MEMORY]);
    assert.ok(merged["note:keep"], "pre-existing entry retained");
    assert.ok(merged["asana:5"], "migrated entry keeps its already-namespaced id");
  });
});
