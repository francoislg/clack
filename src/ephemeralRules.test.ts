import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addRule,
  clearAutoRespondCache,
  deleteRule,
  findMatchingRule,
  getRules,
  loadRules,
} from "./autoRespond.js";
import {
  appendSessionToEphemeralRule,
  deleteEphemeralRuleForChannel,
  getEphemeralRuleForChannel,
  isEphemeralRule,
  ratchetEphemeralRule,
  renewEphemeralRule,
  seedEphemeralRule,
  setEphemeralRuleLevel,
  EPHEMERAL_ANCHOR_TEXT_MAX,
  EPHEMERAL_RULE_TTL_MS,
  EPHEMERAL_SESSION_LEDGER_CAP,
} from "./ephemeralRules.js";

const originalCwd = process.cwd;

const NOW = new Date("2026-07-03T12:00:00Z").getTime();

describe("ephemeralRules", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ar-eph-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(async () => {
    vi.useRealTimers();
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  function seed(channel = "C1") {
    return seedEphemeralRule({
      channel,
      attentionLevel: "medium",
      sessionId: "sess-1",
      anchorText: "Deploy digest for today",
    });
  }

  describe("seeding", () => {
    it("creates a rule with TTL window, ledger, and anchor text", async () => {
      const rule = await seed();
      assert.equal(rule.kind, "ephemeral");
      assert.deepEqual(rule.channels, ["C1"]);
      assert.equal(rule.attentionLevel, "medium");
      assert.equal(rule.expiresAt, NOW + EPHEMERAL_RULE_TTL_MS);
      assert.deepEqual(rule.sessionIds, ["sess-1"]);
      assert.equal(rule.anchorText, "Deploy digest for today");
      assert.equal(rule.enabled, true);
    });

    it("truncates anchor text to the max", async () => {
      const rule = await seedEphemeralRule({
        channel: "C1",
        attentionLevel: "low",
        sessionId: "s",
        anchorText: "x".repeat(EPHEMERAL_ANCHOR_TEXT_MAX + 200),
      });
      assert.equal(rule.anchorText.length, EPHEMERAL_ANCHOR_TEXT_MAX);
    });

    it("newest-wins: replaces the channel's existing window", async () => {
      const first = await seed();
      const second = await seedEphemeralRule({
        channel: "C1",
        attentionLevel: "high",
        sessionId: "sess-2",
        anchorText: "Newer post",
      });
      const current = await getEphemeralRuleForChannel("C1");
      assert.ok(current);
      assert.equal(current.id, second.id);
      assert.notEqual(current.id, first.id);
      const all = (await loadRules()).filter(isEphemeralRule);
      assert.equal(all.length, 1);
    });

    it("stores followUpContext when provided", async () => {
      const rule = await seedEphemeralRule({
        channel: "C1",
        attentionLevel: "medium",
        sessionId: "s",
        anchorText: "a",
        followUpContext: "  be casual  ",
      });
      assert.equal(rule.followUpContext, "be casual");
    });
  });

  describe("persistence isolation", () => {
    it("merges ephemeral first in loadRules and getRules", async () => {
      await addRule(["C1"]);
      await seed();
      const rules = await getRules();
      assert.equal(rules.length, 2);
      assert.ok(isEphemeralRule(rules[0]));
      assert.ok(!isEphemeralRule(rules[1]));
    });

    it("never writes ephemeral rules into auto-respond.json", async () => {
      await addRule(["C1"]);
      await seed();
      const standingFile = JSON.parse(
        await readFile(join(tempDir, "data", "state", "auto-respond.json"), "utf-8"),
      );
      assert.equal(standingFile.rules.length, 1);
      assert.equal(standingFile.rules[0].kind, undefined);
      const ephemeralFile = JSON.parse(
        await readFile(join(tempDir, "data", "state", "auto-respond-ephemeral.json"), "utf-8"),
      );
      assert.equal(ephemeralFile.rules.length, 1);
      assert.equal(ephemeralFile.rules[0].kind, "ephemeral");
    });

    it("returns the valid file's rules when the other file is corrupt", async () => {
      await addRule(["C1"]);
      await seed("C2");
      clearAutoRespondCache();
      await writeFile(join(tempDir, "data", "state", "auto-respond.json"), "{not json");
      const rules = await loadRules();
      assert.equal(rules.length, 1);
      assert.ok(isEphemeralRule(rules[0]));

      clearAutoRespondCache();
      await writeFile(
        join(tempDir, "data", "state", "auto-respond.json"),
        JSON.stringify({ rules: [{ id: "a", channels: ["C1"], enabled: true }] }),
      );
      await writeFile(join(tempDir, "data", "state", "auto-respond-ephemeral.json"), "{not json");
      const rules2 = await loadRules();
      assert.equal(rules2.length, 1);
      assert.equal(rules2[0].id, "a");
    });
  });

  describe("lifecycle mutations", () => {
    it("ratchets high → medium → low, then deletes", async () => {
      const rule = await seedEphemeralRule({
        channel: "C1",
        attentionLevel: "high",
        sessionId: "s",
        anchorText: "a",
      });
      const medium = await ratchetEphemeralRule(rule.id);
      assert.equal(medium?.attentionLevel, "medium");
      const low = await ratchetEphemeralRule(rule.id);
      assert.equal(low?.attentionLevel, "low");
      const deleted = await ratchetEphemeralRule(rule.id);
      assert.equal(deleted, null);
      assert.equal(await getEphemeralRuleForChannel("C1"), null);
    });

    it("renews the window", async () => {
      const rule = await seed();
      vi.setSystemTime(NOW + 30 * 60 * 1000);
      const renewed = await renewEphemeralRule(rule.id);
      assert.equal(renewed?.expiresAt, NOW + 30 * 60 * 1000 + EPHEMERAL_RULE_TTL_MS);
    });

    it("setLevel reframes the dial and deletes on off", async () => {
      const rule = await seed();
      const high = await setEphemeralRuleLevel(rule.id, "high");
      assert.equal(high?.attentionLevel, "high");
      const off = await setEphemeralRuleLevel(rule.id, "off");
      assert.equal(off, null);
      assert.equal(await getEphemeralRuleForChannel("C1"), null);
    });

    it("appends session IDs with dedupe and cap, anchor never dropped", async () => {
      const rule = await seed();
      await appendSessionToEphemeralRule("C1", "sess-1");
      for (let i = 2; i <= EPHEMERAL_SESSION_LEDGER_CAP + 3; i++) {
        await appendSessionToEphemeralRule("C1", `sess-${i}`);
      }
      const current = await getEphemeralRuleForChannel("C1");
      assert.ok(current);
      assert.equal(current.sessionIds.length, EPHEMERAL_SESSION_LEDGER_CAP);
      assert.equal(current.sessionIds[0], "sess-1");
      assert.equal(current.sessionIds.at(-1), `sess-${EPHEMERAL_SESSION_LEDGER_CAP + 3}`);
      assert.equal(rule.id, current.id);
    });

    it("deleteRule routes ephemeral IDs to the ephemeral file", async () => {
      const standing = await addRule(["C1"]);
      const rule = await seed();
      assert.equal(await deleteRule(rule.id), true);
      assert.equal(await getEphemeralRuleForChannel("C1"), null);
      const rules = await getRules();
      assert.equal(rules.length, 1);
      assert.equal(rules[0].id, standing.id);
    });

    it("deleteEphemeralRuleForChannel removes the window", async () => {
      await seed();
      assert.equal(await deleteEphemeralRuleForChannel("C1"), true);
      assert.equal(await deleteEphemeralRuleForChannel("C1"), false);
    });
  });

  describe("matching precedence", () => {
    it("findMatchingRule never returns an ephemeral rule", async () => {
      await seed();
      const match = await findMatchingRule("C1", "U1", "hello");
      assert.equal(match, null);
    });

    it("findMatchingRule still matches standing rules in the same channel", async () => {
      await seed();
      const standing = await addRule(["C1"]);
      const match = await findMatchingRule("C1", "U1", "hello");
      assert.equal(match?.id, standing.id);
    });
  });
});
