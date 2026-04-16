import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer } from "./testHelpers.js";
import { createSaveCheatingTool } from "./saveCheating.js";

const SESSION = { sessionId: "test" };

function parseResult(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("save_cheating tool", () => {
  it("first cheat initializes cheatAttempts counter to 1", async () => {
    const data = createInMemoryDataLayer();
    const tool = createSaveCheatingTool(data);

    const result = await tool.handler(
      {
        cheaterUserId: "U123",
        questionId: "q1",
        reason: "Asked about the exact fact from today's question",
        evidence: "msg: 'how tall is mount everest'",
      },
      SESSION,
    );

    const body = parseResult(result);
    assert.equal(body.saved, true);
    assert.equal(body.totalAttempts, 1);
    assert.equal(body.notifyOwner, true);

    const users = await data.loadUsers();
    assert.equal(users.get("U123")?.cheatAttempts, 1);

    const cheats = await data.loadCheats();
    assert.equal(cheats.length, 1);
    assert.equal(cheats[0].cheaterUserId, "U123");
    assert.equal(cheats[0].questionId, "q1");
  });

  it("subsequent cheats increment the counter", async () => {
    const data = createInMemoryDataLayer();
    const tool = createSaveCheatingTool(data);

    await tool.handler(
      { cheaterUserId: "U123", questionId: "q1", reason: "first offense", evidence: undefined },
      SESSION,
    );
    const result = await tool.handler(
      { cheaterUserId: "U123", questionId: "q2", reason: "second offense", evidence: undefined },
      SESSION,
    );

    const body = parseResult(result);
    assert.equal(body.totalAttempts, 2);

    const users = await data.loadUsers();
    assert.equal(users.get("U123")?.cheatAttempts, 2);

    const cheats = await data.loadCheats();
    assert.equal(cheats.length, 2);
  });

  it("appends each report in order", async () => {
    const data = createInMemoryDataLayer();
    const tool = createSaveCheatingTool(data);

    await tool.handler(
      { cheaterUserId: "U1", questionId: "q1", reason: "first", evidence: undefined },
      SESSION,
    );
    await tool.handler(
      { cheaterUserId: "U2", questionId: "q1", reason: "second", evidence: undefined },
      SESSION,
    );
    await tool.handler(
      { cheaterUserId: "U1", questionId: "q2", reason: "third", evidence: undefined },
      SESSION,
    );

    const cheats = await data.loadCheats();
    assert.equal(cheats.length, 3);
    assert.deepEqual(
      cheats.map((c) => c.reason),
      ["first", "second", "third"],
    );
  });

  it("rejects empty reason", async () => {
    const data = createInMemoryDataLayer();
    const tool = createSaveCheatingTool(data);

    const result = await tool.handler(
      { cheaterUserId: "U1", questionId: "q1", reason: "  ", evidence: undefined },
      SESSION,
    );

    const body = parseResult(result);
    assert.equal(body.error, "reason must be a concise description");

    const cheats = await data.loadCheats();
    assert.equal(cheats.length, 0);
  });

  it("preserves existing user fields when incrementing counter", async () => {
    const data = createInMemoryDataLayer();
    await data.saveUser({
      userId: "U99",
      displayName: "Alice",
      joinedAt: 1_700_000_000_000,
    });
    const tool = createSaveCheatingTool(data);

    await tool.handler(
      { cheaterUserId: "U99", questionId: "q1", reason: "caught", evidence: undefined },
      SESSION,
    );

    const users = await data.loadUsers();
    const u = users.get("U99");
    assert.equal(u?.displayName, "Alice");
    assert.equal(u?.joinedAt, 1_700_000_000_000);
    assert.equal(u?.cheatAttempts, 1);
  });
});
