import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { ClackSdk } from "../sdk.js";
import { createFakeSdk, primeTriviaConfig } from "./testHelpers.fakeSdk.js";
import { createSdkDataLayer } from "./core/dataLayer.js";
import { _resetTriviaConfigBridge } from "./core/configBridge.js";
import type { CheatReport } from "./core/types.js";

const CHEAT = (userId: string, questionId: string): CheatReport => ({
  cheaterUserId: userId,
  questionId,
  reason: "looked it up",
  detectedAt: "2026-01-01T00:00:00.000Z",
});

describe("createFakeSdk — contract", () => {
  it("is assignable to ClackSdk and renderers are structurally unmockable", () => {
    const { sdk } = createFakeSdk();
    const asSdk: ClackSdk = sdk;
    expect(asSdk.t("k")).toBe("k");
    expect(sdk.t("k", { a: 1, b: "x" })).toBe("k:1:x");
    expect(sdk.actionId("go")).toBe("plugin:test:go");

    // Never called — these thunks exist to prove stubbing a renderer does not compile.
    const unmockableRenderers = [
      () => {
        // @ts-expect-error t has exactly one faithful rendering — never mockable
        sdk.t.mockReturnValue("x");
      },
      () => {
        // @ts-expect-error actionId has exactly one faithful rendering — never mockable
        sdk.actionId.mockReturnValue("x");
      },
      () => {
        // @ts-expect-error viewCallbackId has exactly one faithful rendering — never mockable
        sdk.viewCallbackId.mockReturnValue("x");
      },
    ];
    expect(unmockableRenderers).toHaveLength(3);
  });

  it("backs readFile/writeFile with the store exposed as testHelpers.files", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    await sdk.writeFile("a.json", "[1]");
    expect(await sdk.readFile("a.json")).toBe("[1]");
    expect(testHelpers.files.get("a.json")).toBe("[1]");
    expect(await sdk.readFile("missing.json")).toBeNull();
  });

  it("readFileOrSeed seeds a missing file, then preserves the seeded content", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    expect(await sdk.readFileOrSeed("seeded.md", "DEFAULT")).toBe("DEFAULT");
    expect(testHelpers.files.get("seeded.md")).toBe("DEFAULT");
    expect(await sdk.readFileOrSeed("seeded.md", "IGNORED")).toBe("DEFAULT");
  });

  it("readFileOrSeed delegates through the readFile mock, so stubs are honored", async () => {
    const { sdk } = createFakeSdk();
    sdk.readFile.mockResolvedValue("STUBBED");
    expect(await sdk.readFileOrSeed("x.md", "DEFAULT")).toBe("STUBBED");
  });

  it("keeps a construction-time override observable through the mock API", async () => {
    const { sdk } = createFakeSdk({ dmOwner: async () => ({ ok: false, error: "nope" }) });
    expect(await sdk.dmOwner("hi")).toEqual({ ok: false, error: "nope" });
    expect(sdk.dmOwner).toHaveBeenCalledWith("hi");
  });

  it("watchFile returns a benign watcher instead of throwing", () => {
    const { sdk } = createFakeSdk();
    const watcher = sdk.watchFile("config.json", () => {});
    expect(() => watcher.close()).not.toThrow();
  });

  it("memoizes registerMcpServer by name, accumulating tools on one observable handle", () => {
    const { sdk } = createFakeSdk();
    const first = sdk.registerMcpServer("management", { autoload: false, description: "d" });
    const again = sdk.registerMcpServer("management", { autoload: false, description: "d" });
    expect(again).toBe(first);
    expect(first.fullName).toBe("test:management");

    first.registerTool("admin", { name: "tool_a" }, "Label A");
    again.registerTool("admin", { name: "tool_b" }, "Label B");
    expect(first.registerTool.mock.calls.map((c) => c[1].name)).toEqual(["tool_a", "tool_b"]);
  });

  it("routes the sdk.registerTool shorthand onto the default server handle", () => {
    const { sdk } = createFakeSdk();
    sdk.registerTool("member", { name: "shorthand_tool" }, "Label");
    expect(sdk.mcpServer.registerTool).toHaveBeenCalledWith(
      "member",
      expect.objectContaining({ name: "shorthand_tool" }),
      "Label",
    );
  });

  it("seeds users through testHelpers.saveUser, readable via the production API", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    testHelpers.saveUser({ userId: "U1", displayName: "Ada" });
    expect(await sdk.users.get("U1")).toEqual({ userId: "U1", displayName: "Ada" });
    expect(await sdk.users.list()).toHaveLength(1);
    expect(await sdk.users.get("U404")).toBeNull();
  });

  it("users.data accessors share one backing store", async () => {
    const { sdk } = createFakeSdk();
    const schema = z.object({ joinedAt: z.number().optional() });
    await sdk.users.data(schema).merge("U1", { joinedAt: 42 });
    expect(await sdk.users.data(schema).get("U1")).toEqual({ joinedAt: 42 });
  });

  it("memory.data accessors share one backing store", async () => {
    const { sdk } = createFakeSdk();
    const schema = z.object({ note: z.string().optional() });
    await sdk.memory.data(schema).merge("m1", { note: "hi" });
    expect(await sdk.memory.data(schema).get("m1")).toEqual({ note: "hi" });
  });
});

describe("createFakeSdk — drives the real data layer", () => {
  beforeEach(() => _resetTriviaConfigBridge());
  afterEach(() => _resetTriviaConfigBridge());

  it("cheat tally runs the real logic through sdk.users.data: 1 then 2", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const data = createSdkDataLayer(sdk);

    const first = await data.forGame("main").saveCheat(CHEAT("U1", "q1"));
    const second = await data.forGame("main").saveCheat(CHEAT("U1", "q2"));
    expect([first.totalAttempts, second.totalAttempts]).toEqual([1, 2]);
  });

  it("recordJoin is idempotent — the first join time survives a re-answer", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const data = createSdkDataLayer(sdk);
    const schema = z.object({ joinedAt: z.number().optional() });

    await data.recordJoin("U1");
    const firstJoin = await sdk.users.data(schema).get("U1");
    expect(firstJoin?.joinedAt).toBeTypeOf("number");
    await data.recordJoin("U1");
    expect(await sdk.users.data(schema).get("U1")).toEqual(firstJoin);
  });
});
