import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { RolesConfig } from "../../roles.js";
import type { View } from "@slack/types";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockLoadRoles = mock.fn<() => Promise<RolesConfig>>();
const mockSetOwner = mock.fn<(userId: string) => Promise<void>>(async () => {});
const mockAddAdmin = mock.fn<(userId: string) => Promise<{ success: boolean; error?: string }>>();
const mockRemoveAdmin = mock.fn<(userId: string) => Promise<{ success: boolean; error?: string }>>();
const mockAddDev = mock.fn<(userId: string) => Promise<{ success: boolean; error?: string }>>();
const mockRemoveDev = mock.fn<(userId: string) => Promise<{ success: boolean; error?: string }>>();
const mockIsUserDisabled = mock.fn<(client: unknown, userId: string) => Promise<boolean>>();
const mockClaimOwnershipFromDisabled = mock.fn<(client: unknown, userId: string) => Promise<{ success: boolean; error?: string }>>();
const mockTransferOwnership = mock.fn<(client: unknown, fromId: string, toId: string) => Promise<{ success: boolean; error?: string }>>();
const mockHasOwner = mock.fn<() => Promise<boolean>>();

const mockUserCanManageRoles = mock.fn<(userId: string) => Promise<boolean>>();

const mockBuildHomeView = mock.fn<(opts: { userId: string; ownerDisabled?: boolean }) => Promise<View>>();
const mockBuildUserSelectModal = mock.fn<(title: string, actionId: string, placeholder: string) => View>();
const mockBuildRemoveUserModal = mock.fn<(title: string, actionId: string, users: string[]) => View>();
const mockBuildSettingsModal = mock.fn<(userId: string) => Promise<View>>();

const mockSetUserPreference = mock.fn<(userId: string, key: string, value: unknown) => Promise<void>>(async () => {});

mock.module("../../roles.js", {
  namedExports: {
    loadRoles: mockLoadRoles,
    setOwner: mockSetOwner,
    addAdmin: mockAddAdmin,
    removeAdmin: mockRemoveAdmin,
    addDev: mockAddDev,
    removeDev: mockRemoveDev,
    isUserDisabled: mockIsUserDisabled,
    claimOwnershipFromDisabled: mockClaimOwnershipFromDisabled,
    transferOwnership: mockTransferOwnership,
    hasOwner: mockHasOwner,
  },
});

mock.module("../../permissions.js", {
  namedExports: { userCanManageRoles: mockUserCanManageRoles },
});

mock.module("../homeTab.js", {
  namedExports: {
    buildHomeView: mockBuildHomeView,
    buildUserSelectModal: mockBuildUserSelectModal,
    buildRemoveUserModal: mockBuildRemoveUserModal,
    buildSettingsModal: mockBuildSettingsModal,
  },
});

mock.module("../../userPreferences.js", {
  namedExports: { setUserPreference: mockSetUserPreference },
});

mock.module("../../logger.js", {
  namedExports: {
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  },
});

// Import after mocks
const { registerHomeTabHandler } = await import("./homeTab.js");

// ============================================================================
// Helpers
// ============================================================================

type EventHandler = (args: {
  event: { user: string };
  client: MockClient;
}) => Promise<void>;

type ActionHandler = (args: {
  ack: () => Promise<void>;
  body: { user: { id: string }; trigger_id: string };
  client: MockClient;
}) => Promise<void>;

type ViewHandler = (args: {
  ack: (errorResp?: { response_action: string; errors: Record<string, string> }) => Promise<void>;
  view: { state: { values: Record<string, Record<string, Record<string, unknown>>> } };
  body: { user: { id: string } };
  client: MockClient;
}) => Promise<void>;

interface MockClient {
  views: {
    publish: ReturnType<typeof mock.fn>;
    open: ReturnType<typeof mock.fn>;
  };
}

const capturedEventHandlers = new Map<string, EventHandler>();
const capturedActionHandlers = new Map<string, ActionHandler>();
const capturedViewHandlers = new Map<string, ViewHandler>();

function makeApp(): App {
  return {
    event: (eventName: string, handler: EventHandler) => {
      capturedEventHandlers.set(eventName, handler);
    },
    action: (actionId: string, handler: ActionHandler) => {
      capturedActionHandlers.set(actionId, handler);
    },
    view: (viewId: string, handler: ViewHandler) => {
      capturedViewHandlers.set(viewId, handler);
    },
  } as unknown as App;
}

function makeClient(): MockClient {
  return {
    views: {
      publish: mock.fn(async () => {}),
      open: mock.fn(async () => {}),
    },
  };
}

const dummyView: View = {
  type: "home",
  blocks: [],
};

function resetAllMocks() {
  mockLoadRoles.mock.resetCalls();
  mockSetOwner.mock.resetCalls();
  mockAddAdmin.mock.resetCalls();
  mockRemoveAdmin.mock.resetCalls();
  mockAddDev.mock.resetCalls();
  mockRemoveDev.mock.resetCalls();
  mockIsUserDisabled.mock.resetCalls();
  mockClaimOwnershipFromDisabled.mock.resetCalls();
  mockTransferOwnership.mock.resetCalls();
  mockHasOwner.mock.resetCalls();
  mockUserCanManageRoles.mock.resetCalls();
  mockBuildHomeView.mock.resetCalls();
  mockBuildUserSelectModal.mock.resetCalls();
  mockBuildRemoveUserModal.mock.resetCalls();
  mockBuildSettingsModal.mock.resetCalls();
  mockSetUserPreference.mock.resetCalls();

  capturedEventHandlers.clear();
  capturedActionHandlers.clear();
  capturedViewHandlers.clear();
}

function setDefaultMocks() {
  mockLoadRoles.mock.mockImplementation(async () => ({
    owner: "U_OWNER",
    admins: ["U_ADMIN1"],
    devs: ["U_DEV1"],
  }));
  mockIsUserDisabled.mock.mockImplementation(async () => false);
  mockHasOwner.mock.mockImplementation(async () => true);
  mockBuildHomeView.mock.mockImplementation(async () => dummyView);
  mockBuildUserSelectModal.mock.mockImplementation(() => dummyView);
  mockBuildRemoveUserModal.mock.mockImplementation(() => dummyView);
  mockBuildSettingsModal.mock.mockImplementation(async () => dummyView);
  mockUserCanManageRoles.mock.mockImplementation(async () => true);
}

beforeEach(() => {
  resetAllMocks();
  setDefaultMocks();

  const app = makeApp();
  registerHomeTabHandler(app);
});

// ============================================================================
// Tests — registerHomeTabHandler
// ============================================================================

describe("registerHomeTabHandler", () => {
  it("registers event, action, and view handlers on the app", () => {
    assert.ok(capturedEventHandlers.has("app_home_opened"));
    assert.ok(capturedActionHandlers.has("claim_ownership"));
    assert.ok(capturedActionHandlers.has("transfer_ownership"));
    assert.ok(capturedActionHandlers.has("add_admin"));
    assert.ok(capturedActionHandlers.has("remove_admin"));
    assert.ok(capturedActionHandlers.has("add_dev"));
    assert.ok(capturedActionHandlers.has("remove_dev"));
    assert.ok(capturedActionHandlers.has("open_settings"));
    assert.ok(capturedViewHandlers.has("transfer_ownership_modal"));
    assert.ok(capturedViewHandlers.has("add_admin_modal"));
    assert.ok(capturedViewHandlers.has("remove_admin_modal"));
    assert.ok(capturedViewHandlers.has("add_dev_modal"));
    assert.ok(capturedViewHandlers.has("remove_dev_modal"));
    assert.ok(capturedViewHandlers.has("settings_modal"));
  });
});

// ============================================================================
// app_home_opened event
// ============================================================================

describe("app_home_opened event", () => {
  it("publishes the home view for the user", async () => {
    const client = makeClient();
    const handler = capturedEventHandlers.get("app_home_opened")!;

    await handler({ event: { user: "U001" }, client });

    assert.equal(mockBuildHomeView.mock.callCount(), 1);
    assert.equal(client.views.publish.mock.callCount(), 1);
    const publishArgs = client.views.publish.mock.calls[0].arguments[0] as { user_id: string; view: View };
    assert.equal(publishArgs.user_id, "U001");
  });

  it("checks if owner is disabled and passes ownerDisabled flag", async () => {
    mockIsUserDisabled.mock.mockImplementation(async () => true);
    const client = makeClient();
    const handler = capturedEventHandlers.get("app_home_opened")!;

    await handler({ event: { user: "U001" }, client });

    const buildArgs = mockBuildHomeView.mock.calls[0].arguments[0] as { userId: string; ownerDisabled?: boolean };
    assert.equal(buildArgs.ownerDisabled, true);
  });

  it("does not check owner disabled when no owner", async () => {
    mockLoadRoles.mock.mockImplementation(async () => ({
      owner: null,
      admins: [],
      devs: [],
    }));
    const client = makeClient();
    const handler = capturedEventHandlers.get("app_home_opened")!;

    await handler({ event: { user: "U001" }, client });

    assert.equal(mockIsUserDisabled.mock.callCount(), 0);
    const buildArgs = mockBuildHomeView.mock.calls[0].arguments[0] as { userId: string; ownerDisabled?: boolean };
    assert.equal(buildArgs.ownerDisabled, false);
  });
});

// ============================================================================
// claim_ownership action
// ============================================================================

describe("claim_ownership action", () => {
  it("calls setOwner when no owner exists", async () => {
    mockHasOwner.mock.mockImplementation(async () => false);
    const client = makeClient();
    const handler = capturedActionHandlers.get("claim_ownership")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
    });

    assert.equal(mockSetOwner.mock.callCount(), 1);
    assert.equal(mockSetOwner.mock.calls[0].arguments[0], "U001");
  });

  it("calls claimOwnershipFromDisabled when owner exists", async () => {
    mockHasOwner.mock.mockImplementation(async () => true);
    mockClaimOwnershipFromDisabled.mock.mockImplementation(async () => ({ success: true }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("claim_ownership")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
    });

    assert.equal(mockClaimOwnershipFromDisabled.mock.callCount(), 1);
  });

  it("does not refresh home view when claim fails", async () => {
    mockHasOwner.mock.mockImplementation(async () => true);
    mockClaimOwnershipFromDisabled.mock.mockImplementation(async () => ({
      success: false,
      error: "Owner is active",
    }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("claim_ownership")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
    });

    // buildHomeView is still called 0 times because the claim failed and we returned early
    assert.equal(client.views.publish.mock.callCount(), 0);
  });

  it("refreshes home view after successful claim", async () => {
    mockHasOwner.mock.mockImplementation(async () => false);
    const client = makeClient();
    const handler = capturedActionHandlers.get("claim_ownership")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
    });

    assert.equal(mockBuildHomeView.mock.callCount(), 1);
    assert.equal(client.views.publish.mock.callCount(), 1);
  });
});

// ============================================================================
// transfer_ownership action + modal
// ============================================================================

describe("transfer_ownership action", () => {
  it("opens a user select modal", async () => {
    const client = makeClient();
    const handler = capturedActionHandlers.get("transfer_ownership")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U_OWNER" }, trigger_id: "t1" },
      client,
    });

    assert.equal(mockBuildUserSelectModal.mock.callCount(), 1);
    assert.equal(client.views.open.mock.callCount(), 1);
  });
});

describe("transfer_ownership_modal submission", () => {
  it("returns error when no user selected", async () => {
    const handler = capturedViewHandlers.get("transfer_ownership_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => { ackResponse = resp; },
      view: {
        state: {
          values: {
            user_select_block: {
              selected_user: { selected_user: null },
            },
          },
        },
      },
      body: { user: { id: "U_OWNER" } },
      client: makeClient(),
    });

    assert.ok(ackResponse);
    assert.equal(ackResponse!.response_action, "errors");
    assert.ok(ackResponse!.errors.user_select_block.includes("select a user"));
  });

  it("returns error when transfer fails", async () => {
    mockTransferOwnership.mock.mockImplementation(async () => ({
      success: false,
      error: "Cannot transfer to yourself",
    }));
    const handler = capturedViewHandlers.get("transfer_ownership_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => { ackResponse = resp; },
      view: {
        state: {
          values: {
            user_select_block: {
              selected_user: { selected_user: "U_NEW" },
            },
          },
        },
      },
      body: { user: { id: "U_OWNER" } },
      client: makeClient(),
    });

    assert.ok(ackResponse);
    assert.equal(ackResponse!.response_action, "errors");
  });

  it("refreshes both users home views on success", async () => {
    mockTransferOwnership.mock.mockImplementation(async () => ({ success: true }));
    const client = makeClient();
    const handler = capturedViewHandlers.get("transfer_ownership_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            user_select_block: {
              selected_user: { selected_user: "U_NEW" },
            },
          },
        },
      },
      body: { user: { id: "U_OWNER" } },
      client,
    });

    // buildHomeView called twice: once for current user, once for new owner
    assert.equal(mockBuildHomeView.mock.callCount(), 2);
    assert.equal(client.views.publish.mock.callCount(), 2);
  });
});

// ============================================================================
// add_admin action + modal
// ============================================================================

describe("add_admin_modal submission", () => {
  it("calls addAdmin on successful submission", async () => {
    mockAddAdmin.mock.mockImplementation(async () => ({ success: true }));
    const client = makeClient();
    const handler = capturedViewHandlers.get("add_admin_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            user_select_block: {
              selected_user: { selected_user: "U_NEW_ADMIN" },
            },
          },
        },
      },
      body: { user: { id: "U_OWNER" } },
      client,
    });

    assert.equal(mockAddAdmin.mock.callCount(), 1);
    assert.equal(mockAddAdmin.mock.calls[0].arguments[0], "U_NEW_ADMIN");
  });

  it("returns error when user has no permission", async () => {
    mockUserCanManageRoles.mock.mockImplementation(async () => false);
    const handler = capturedViewHandlers.get("add_admin_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => { ackResponse = resp; },
      view: {
        state: {
          values: {
            user_select_block: {
              selected_user: { selected_user: "U_NEW_ADMIN" },
            },
          },
        },
      },
      body: { user: { id: "U_MEMBER" } },
      client: makeClient(),
    });

    assert.ok(ackResponse);
    assert.equal(ackResponse!.response_action, "errors");
    assert.ok(ackResponse!.errors.user_select_block.includes("permission"));
  });

  it("returns error when addAdmin fails", async () => {
    mockAddAdmin.mock.mockImplementation(async () => ({
      success: false,
      error: "User is already an admin",
    }));
    const handler = capturedViewHandlers.get("add_admin_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => { ackResponse = resp; },
      view: {
        state: {
          values: {
            user_select_block: {
              selected_user: { selected_user: "U_EXISTING_ADMIN" },
            },
          },
        },
      },
      body: { user: { id: "U_OWNER" } },
      client: makeClient(),
    });

    assert.ok(ackResponse);
    assert.equal(ackResponse!.response_action, "errors");
    assert.ok(ackResponse!.errors.user_select_block.includes("already an admin"));
  });
});

// ============================================================================
// remove_admin action
// ============================================================================

describe("remove_admin action", () => {
  it("opens remove modal when admins exist", async () => {
    const client = makeClient();
    const handler = capturedActionHandlers.get("remove_admin")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U_OWNER" }, trigger_id: "t1" },
      client,
    });

    assert.equal(mockBuildRemoveUserModal.mock.callCount(), 1);
    assert.equal(client.views.open.mock.callCount(), 1);
  });

  it("does not open modal when no admins", async () => {
    mockLoadRoles.mock.mockImplementation(async () => ({
      owner: "U_OWNER",
      admins: [],
      devs: [],
    }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("remove_admin")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U_OWNER" }, trigger_id: "t1" },
      client,
    });

    assert.equal(client.views.open.mock.callCount(), 0);
  });
});

// ============================================================================
// remove_admin_modal submission
// ============================================================================

describe("remove_admin_modal submission", () => {
  it("calls removeAdmin on successful submission", async () => {
    mockRemoveAdmin.mock.mockImplementation(async () => ({ success: true }));
    const client = makeClient();
    const handler = capturedViewHandlers.get("remove_admin_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            user_select_block: {
              selected_user: { selected_option: { value: "U_ADMIN1" } },
            },
          },
        },
      },
      body: { user: { id: "U_OWNER" } },
      client,
    });

    assert.equal(mockRemoveAdmin.mock.callCount(), 1);
    assert.equal(mockRemoveAdmin.mock.calls[0].arguments[0], "U_ADMIN1");
  });

  it("returns error when no user selected", async () => {
    const handler = capturedViewHandlers.get("remove_admin_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => { ackResponse = resp; },
      view: {
        state: {
          values: {
            user_select_block: {
              selected_user: { selected_option: null },
            },
          },
        },
      },
      body: { user: { id: "U_OWNER" } },
      client: makeClient(),
    });

    assert.ok(ackResponse);
    assert.equal(ackResponse!.response_action, "errors");
  });
});

// ============================================================================
// open_settings action + settings_modal
// ============================================================================

describe("open_settings action", () => {
  it("opens the settings modal", async () => {
    const client = makeClient();
    const handler = capturedActionHandlers.get("open_settings")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
    });

    assert.equal(mockBuildSettingsModal.mock.callCount(), 1);
    assert.equal(client.views.open.mock.callCount(), 1);
  });
});

describe("settings_modal submission", () => {
  it("saves delivery preference when dm is selected", async () => {
    const client = makeClient();
    const handler = capturedViewHandlers.get("settings_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            response_delivery_block: {
              response_delivery: { selected_option: { value: "dm" } },
            },
            notify_on_response_block: {
              notify_on_response: { selected_option: { value: "false" } },
            },
          },
        },
      },
      body: { user: { id: "U001" } },
      client,
    });

    assert.equal(mockSetUserPreference.mock.callCount(), 2);
    const firstCall = mockSetUserPreference.mock.calls[0].arguments;
    assert.equal(firstCall[0], "U001");
    assert.equal(firstCall[1], "reactionDelivery");
    assert.equal(firstCall[2], "dm");
  });

  it("saves delivery preference when thread is selected", async () => {
    const client = makeClient();
    const handler = capturedViewHandlers.get("settings_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            response_delivery_block: {
              response_delivery: { selected_option: { value: "thread" } },
            },
            notify_on_response_block: {
              notify_on_response: { selected_option: null },
            },
          },
        },
      },
      body: { user: { id: "U001" } },
      client,
    });

    const deliveryCall = mockSetUserPreference.mock.calls.find(
      (c) => c.arguments[1] === "reactionDelivery"
    );
    assert.ok(deliveryCall);
    assert.equal(deliveryCall!.arguments[2], "thread");
  });

  it("saves notify preference when true", async () => {
    const client = makeClient();
    const handler = capturedViewHandlers.get("settings_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            response_delivery_block: {
              response_delivery: { selected_option: null },
            },
            notify_on_response_block: {
              notify_on_response: { selected_option: { value: "true" } },
            },
          },
        },
      },
      body: { user: { id: "U001" } },
      client,
    });

    const notifyCall = mockSetUserPreference.mock.calls.find(
      (c) => c.arguments[1] === "notifyOnResponse"
    );
    assert.ok(notifyCall);
    assert.equal(notifyCall!.arguments[2], true);
  });

  it("does not save preferences when no options selected", async () => {
    const client = makeClient();
    const handler = capturedViewHandlers.get("settings_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            response_delivery_block: {
              response_delivery: { selected_option: null },
            },
            notify_on_response_block: {
              notify_on_response: { selected_option: null },
            },
          },
        },
      },
      body: { user: { id: "U001" } },
      client,
    });

    assert.equal(mockSetUserPreference.mock.callCount(), 0);
  });

  it("refreshes home view after saving", async () => {
    const client = makeClient();
    const handler = capturedViewHandlers.get("settings_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            response_delivery_block: {
              response_delivery: { selected_option: { value: "dm" } },
            },
            notify_on_response_block: {
              notify_on_response: { selected_option: null },
            },
          },
        },
      },
      body: { user: { id: "U001" } },
      client,
    });

    assert.equal(mockBuildHomeView.mock.callCount(), 1);
    assert.equal(client.views.publish.mock.callCount(), 1);
  });
});
