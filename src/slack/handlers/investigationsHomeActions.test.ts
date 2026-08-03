import { describe, it, vi, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import {
  registerInvestigationsHomeActions,
  type InvestigationsHomeActionsDeps,
} from "./investigationsHomeActions.js";

describe("registerInvestigationsHomeActions", () => {
  let capturedActions: Map<string, (params: object) => Promise<void>>;
  let mockApp: Partial<App>;
  let mockClient: Partial<WebClient>;

  function makeDeps(
    over: Partial<InvestigationsHomeActionsDeps> = {},
  ): InvestigationsHomeActionsDeps {
    return {
      getInvestigationsChannel: () => null,
      setInvestigationsChannel: vi.fn(async () => {}),
      closeInvestigation: vi.fn(async () => {}),
      listOpenInvestigations: () => [],
      isAdmin: vi.fn(async () => true),
      publishHomeView: vi.fn(async () => {}),
      ...over,
    };
  }

  beforeEach(() => {
    capturedActions = new Map();

    mockClient = {
      views: {
        publish: vi.fn(async () => ({ ok: true })),
        open: vi.fn(async () => ({ ok: true })),
        push: vi.fn(async () => ({ ok: true })),
        update: vi.fn(async () => ({ ok: true })),
      },
    };

    mockApp = {
      action: vi.fn((actionId: string, handler: (params: object) => Promise<void>) => {
        capturedActions.set(actionId, handler);
      }),
    };
  });

  it("registers both investigations actions", () => {
    registerInvestigationsHomeActions(mockApp as App, makeDeps());
    assert.ok(capturedActions.has("investigations_select_channel"));
    assert.ok(capturedActions.has("investigations_close"));
  });

  describe("investigations_select_channel handler", () => {
    it("saves channel when selected", async () => {
      const mockSetChannel = vi.fn(async () => {});
      const mockPublishView = vi.fn(async () => {});
      const deps = makeDeps({
        setInvestigationsChannel: mockSetChannel,
        publishHomeView: mockPublishView,
      });
      registerInvestigationsHomeActions(mockApp as App, deps);

      const handler = capturedActions.get("investigations_select_channel")!;
      const body = {
        user: { id: "U_USER" },
        actions: [{ selected_conversation: "C_NEW_CHANNEL" }],
      };
      const ackFn = vi.fn(async () => {});
      await handler({ ack: ackFn, body, client: mockClient });

      expect(mockSetChannel).toHaveBeenCalledWith("C_NEW_CHANNEL");
      expect(mockPublishView).toHaveBeenCalledWith(mockClient, "U_USER");
      expect(ackFn).toHaveBeenCalled();
    });

    it("clears channel when none selected", async () => {
      const mockSetChannel = vi.fn(async () => {});
      const deps = makeDeps({
        getInvestigationsChannel: () => "C_OLD",
        setInvestigationsChannel: mockSetChannel,
      });
      registerInvestigationsHomeActions(mockApp as App, deps);

      const handler = capturedActions.get("investigations_select_channel")!;
      const body = { user: { id: "U_USER" }, actions: [{ selected_conversation: null }] };
      await handler({ ack: vi.fn(async () => {}), body, client: mockClient });

      expect(mockSetChannel).toHaveBeenCalledWith(null);
    });

    it("rejects a non-admin without mutating state", async () => {
      const mockSetChannel = vi.fn(async () => {});
      const deps = makeDeps({
        isAdmin: vi.fn(async () => false),
        setInvestigationsChannel: mockSetChannel,
      });
      registerInvestigationsHomeActions(mockApp as App, deps);

      const handler = capturedActions.get("investigations_select_channel")!;
      const body = { user: { id: "U_INTRUDER" }, actions: [{ selected_conversation: "C_EVIL" }] };
      await handler({ ack: vi.fn(async () => {}), body, client: mockClient });

      expect(mockSetChannel).not.toHaveBeenCalled();
    });
  });

  describe("investigations_close handler", () => {
    it("closes investigation and republishes", async () => {
      const mockCloseInvestigation = vi.fn(async () => {});
      const mockPublishView = vi.fn(async () => {});
      const deps = makeDeps({
        getInvestigationsChannel: () => "C_CHANNEL",
        closeInvestigation: mockCloseInvestigation,
        publishHomeView: mockPublishView,
      });
      registerInvestigationsHomeActions(mockApp as App, deps);

      const handler = capturedActions.get("investigations_close")!;
      const body = { user: { id: "U_USER" }, actions: [{ value: "sess-123" }] };
      await handler({ ack: vi.fn(async () => {}), body, client: mockClient });

      expect(mockCloseInvestigation).toHaveBeenCalledWith("sess-123");
      expect(mockPublishView).toHaveBeenCalledWith(mockClient, "U_USER");
    });

    it("rejects a non-admin without closing", async () => {
      const mockCloseInvestigation = vi.fn(async () => {});
      const deps = makeDeps({
        isAdmin: vi.fn(async () => false),
        closeInvestigation: mockCloseInvestigation,
      });
      registerInvestigationsHomeActions(mockApp as App, deps);

      const handler = capturedActions.get("investigations_close")!;
      const body = { user: { id: "U_INTRUDER" }, actions: [{ value: "sess-123" }] };
      await handler({ ack: vi.fn(async () => {}), body, client: mockClient });

      expect(mockCloseInvestigation).not.toHaveBeenCalled();
    });
  });
});
