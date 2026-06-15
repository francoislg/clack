import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  loadLedger,
  openUnits,
  topUnits,
  upsertUnit,
  type IdlerLedger,
  type IdlerUnit,
  type LedgerSdk,
} from "./ledger.js";

function unit(overrides: Partial<IdlerUnit> & { key: string }): IdlerUnit {
  return {
    key: overrides.key,
    open: overrides.open ?? true,
    priority: overrides.priority ?? 0,
    source: overrides.source ?? "test",
    what: overrides.what ?? "",
    whereWeAre: overrides.whereWeAre ?? "",
    nextSteps: overrides.nextSteps ?? "",
    references: overrides.references ?? [],
  };
}

/** In-memory fake satisfying the narrow LedgerSdk surface — no cast needed. */
function fakeSdk(file: string | null): { sdk: LedgerSdk; warnings: string[] } {
  const warnings: string[] = [];
  const sdk: LedgerSdk = {
    readFile: async () => file,
    writeFile: async () => {},
    logger: {
      debug() {},
      info() {},
      warn: (...a: unknown[]) => warnings.push(a.map(String).join(" ")),
      error() {},
    },
  };
  return { sdk, warnings };
}

describe("upsertUnit", () => {
  it("inserts a new unit", () => {
    const next = upsertUnit({ ideas: [] }, unit({ key: "A" }));
    assert.equal(next.ideas.length, 1);
  });

  it("dedups by key — re-emitting updates in place, no duplicate", () => {
    let led: IdlerLedger = upsertUnit({ ideas: [] }, unit({ key: "PROJ-1", whereWeAre: "first" }));
    led = upsertUnit(led, unit({ key: "PROJ-1", whereWeAre: "second" }));
    assert.equal(led.ideas.length, 1);
    assert.equal(led.ideas[0].whereWeAre, "second");
  });

  it("re-opens a closed unit when incoming open=true", () => {
    let led: IdlerLedger = upsertUnit({ ideas: [] }, unit({ key: "A", open: false }));
    led = upsertUnit(led, unit({ key: "A", open: true }));
    assert.equal(led.ideas[0].open, true);
  });

  it("closes a unit when incoming open=false (explicit set wins)", () => {
    let led: IdlerLedger = upsertUnit({ ideas: [] }, unit({ key: "A", open: true }));
    led = upsertUnit(led, unit({ key: "A", open: false }));
    assert.equal(led.ideas[0].open, false);
  });

  it("merges references by (kind,id), appending new surfaces", () => {
    let led: IdlerLedger = upsertUnit(
      { ideas: [] },
      unit({
        key: "A",
        references: [{ kind: "asana", id: "1", howToRead: "r", howToComment: "c" }],
      }),
    );
    led = upsertUnit(
      led,
      unit({
        key: "A",
        references: [{ kind: "github-pr", id: "5", howToRead: "r2", howToComment: "c2" }],
      }),
    );
    assert.equal(led.ideas[0].references.length, 2);
  });
});

describe("topUnits / openUnits", () => {
  const led: IdlerLedger = {
    ideas: [
      unit({ key: "low", priority: 1 }),
      unit({ key: "high", priority: 9 }),
      unit({ key: "done", priority: 99, open: false }),
      unit({ key: "mid", priority: 5 }),
    ],
  };

  it("excludes done units and orders by descending priority", () => {
    const top = topUnits(led, 5);
    assert.deepEqual(
      top.map((u) => u.key),
      ["high", "mid", "low"],
    );
  });

  it("bounds to the limit", () => {
    assert.equal(topUnits(led, 1).length, 1);
    assert.equal(topUnits(led, 1)[0].key, "high");
  });

  it("openUnits drops done", () => {
    assert.equal(
      openUnits(led).every((u) => u.open),
      true,
    );
  });
});

describe("loadLedger (graceful)", () => {
  it("returns empty on missing file", async () => {
    const { sdk } = fakeSdk(null);
    assert.deepEqual(await loadLedger(sdk), { ideas: [] });
  });

  it("returns empty + warns on malformed JSON, never throws", async () => {
    const { sdk, warnings } = fakeSdk("{not json");
    assert.deepEqual(await loadLedger(sdk), { ideas: [] });
    assert.ok(warnings.length > 0);
  });

  it("parses a valid ledger and defaults missing fields", async () => {
    const { sdk } = fakeSdk(JSON.stringify({ ideas: [{ key: "A" }] }));
    const led = await loadLedger(sdk);
    assert.equal(led.ideas[0].key, "A");
    assert.equal(led.ideas[0].open, true);
    assert.equal(led.ideas[0].references.length, 0);
  });
});
