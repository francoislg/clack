import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerAction,
  registerView,
  unregisterByPluginName,
  findActionHandler,
  findViewHandler,
  __resetForTests,
  __sizesForTests,
} from "./pluginActionRegistry.js";

describe("pluginActionRegistry", () => {
  beforeEach(() => {
    __resetForTests();
  });

  describe("literal action handlers", () => {
    it("resolves a literal action handler by full id", () => {
      const handler = async () => {};
      registerAction("plugin:trivia:answer", handler, "trivia");
      assert.strictEqual(findActionHandler("plugin:trivia:answer"), handler);
    });

    it("returns null for unknown id", () => {
      assert.strictEqual(findActionHandler("plugin:ghost:foo"), null);
    });
  });

  describe("pattern action handlers", () => {
    it("resolves a regex-pattern handler when id matches", () => {
      const handler = async () => {};
      registerAction(/^plugin:trivia:answer:[a-z0-9-]+$/, handler, "trivia");
      assert.strictEqual(findActionHandler("plugin:trivia:answer:q-123"), handler);
    });

    it("returns null when no pattern matches", () => {
      registerAction(/^plugin:trivia:answer:[a-z0-9-]+$/, async () => {}, "trivia");
      assert.strictEqual(findActionHandler("plugin:trivia:other:q-123"), null);
    });

    it("literal beats pattern when both match", () => {
      const literalHandler = async () => {};
      const patternHandler = async () => {};
      registerAction("plugin:trivia:answer", literalHandler, "trivia");
      registerAction(/^plugin:trivia:answer$/, patternHandler, "trivia");
      assert.strictEqual(findActionHandler("plugin:trivia:answer"), literalHandler);
    });

    it("scans patterns in registration order", () => {
      const first = async () => {};
      const second = async () => {};
      registerAction(/^plugin:trivia:./, first, "trivia");
      registerAction(/^plugin:trivia:answer$/, second, "trivia");
      // First-registered pattern matches first; second never reached.
      assert.strictEqual(findActionHandler("plugin:trivia:answer"), first);
    });
  });

  describe("view handlers", () => {
    it("resolves a literal view handler", () => {
      const handler = async () => {};
      registerView("plugin:trivia:freeform-modal", handler, "trivia");
      assert.strictEqual(findViewHandler("plugin:trivia:freeform-modal"), handler);
    });

    it("resolves a regex-pattern view handler", () => {
      const handler = async () => {};
      registerView(/^plugin:trivia:freeform-modal:[a-z0-9-]+$/, handler, "trivia");
      assert.strictEqual(findViewHandler("plugin:trivia:freeform-modal:q-123"), handler);
    });

    it("returns null for unknown callback_id", () => {
      assert.strictEqual(findViewHandler("plugin:ghost:modal"), null);
    });
  });

  describe("unregisterByPluginName", () => {
    it("clears only the named plugin's entries", () => {
      registerAction("plugin:trivia:a", async () => {}, "trivia");
      registerAction("plugin:weather:a", async () => {}, "weather");
      registerAction(/^plugin:trivia:b:/, async () => {}, "trivia");
      registerAction(/^plugin:weather:b:/, async () => {}, "weather");
      registerView("plugin:trivia:v", async () => {}, "trivia");
      registerView("plugin:weather:v", async () => {}, "weather");

      unregisterByPluginName("trivia");

      const sizes = __sizesForTests();
      assert.equal(sizes.actionLiterals, 1);
      assert.equal(sizes.actionPatterns, 1);
      assert.equal(sizes.viewLiterals, 1);

      assert.strictEqual(findActionHandler("plugin:trivia:a"), null);
      assert.notStrictEqual(findActionHandler("plugin:weather:a"), null);
    });

    it("removing then re-registering produces a fresh handler", () => {
      const v1 = async () => {};
      const v2 = async () => {};
      registerAction("plugin:trivia:answer", v1, "trivia");
      unregisterByPluginName("trivia");
      registerAction("plugin:trivia:answer", v2, "trivia");
      assert.strictEqual(findActionHandler("plugin:trivia:answer"), v2);
    });

    it("is a no-op for a plugin with no entries", () => {
      registerAction("plugin:weather:a", async () => {}, "weather");
      unregisterByPluginName("ghost");
      assert.equal(__sizesForTests().actionLiterals, 1);
    });
  });

  describe("reload simulation (cold-start → register → reload → register)", () => {
    it("cold-start unregister is a no-op (registry empty for that plugin)", () => {
      // Mirror lifecycle's reload pattern: unregister before re-registering. On cold
      // start there's nothing to unregister; should not throw and should not affect
      // sibling plugins.
      registerAction("plugin:weather:a", async () => {}, "weather");
      unregisterByPluginName("trivia");
      registerAction("plugin:trivia:answer", async () => {}, "trivia");
      assert.equal(__sizesForTests().actionLiterals, 2);
    });

    it("full reload cycle routes to the freshly-registered handler", () => {
      const generation1 = async () => {};
      const generation2 = async () => {};
      // First load
      registerAction("plugin:trivia:answer", generation1, "trivia");
      assert.strictEqual(findActionHandler("plugin:trivia:answer"), generation1);
      // Reload: clear, then re-register
      unregisterByPluginName("trivia");
      assert.strictEqual(findActionHandler("plugin:trivia:answer"), null);
      registerAction("plugin:trivia:answer", generation2, "trivia");
      assert.strictEqual(findActionHandler("plugin:trivia:answer"), generation2);
    });

    it("reload of one plugin leaves another plugin's handlers intact", () => {
      const trivia = async () => {};
      const weather = async () => {};
      registerAction("plugin:trivia:a", trivia, "trivia");
      registerAction("plugin:weather:a", weather, "weather");
      unregisterByPluginName("trivia");
      registerAction("plugin:trivia:a", trivia, "trivia");
      assert.strictEqual(findActionHandler("plugin:weather:a"), weather);
    });
  });
});
