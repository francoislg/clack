import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { View } from "@slack/types";
import type { HomeTabDeps } from "./homeTab.js";
import { registerHomeTabHandler } from "./homeTab.js";
import type { AutoRespondRule } from "../../autoRespond.js";

// ============================================================================
// Mock Functions
// ============================================================================

const mockLoadRoles =
  mock.fn<() => Promise<{ owner: string | null; admins: string[]; devs: string[] }>>();
const mockSetOwner = mock.fn<(userId: string) => Promise<void>>(async () => {});
const mockSetRole =
  mock.fn<(userId: string, role: string) => Promise<{ success: boolean; error?: string }>>();
const mockIsUserDisabled = mock.fn<(client: App["client"], userId: string) => Promise<boolean>>();
const mockClaimOwnershipFromDisabled =
  mock.fn<
    (client: App["client"], userId: string) => Promise<{ success: boolean; error?: string }>
  >();
const mockTransferOwnership =
  mock.fn<
    (
      client: App["client"],
      fromId: string,
      toId: string,
    ) => Promise<{ success: boolean; error?: string }>
  >();
const mockHasOwner = mock.fn<() => Promise<boolean>>();
const mockUserCanManageRoles = mock.fn<(userId: string) => Promise<boolean>>();
const mockUserCanEditConfig = mock.fn<(userId: string) => Promise<boolean>>();
const mockBuildHomeView =
  mock.fn<(opts: { userId: string; ownerDisabled?: boolean }) => Promise<View>>();
const mockBuildUserSelectModal =
  mock.fn<(title: string, actionId: string, placeholder: string) => View>();
const mockBuildRemoveUserModal =
  mock.fn<(title: string, actionId: string, users: string[]) => View>();
const mockBuildSettingsModal = mock.fn<(userId: string) => Promise<View>>();
const mockBuildConfigFilePickerModal =
  mock.fn<(dir: string, files: (string | Record<string, string>)[], isRepoDir: boolean) => View>();
const mockBuildConfigEditorModal =
  mock.fn<(dir: string, filename: string, content: string, fileState: string) => View>();
const mockBuildConfigCreateFileModal = mock.fn<(dir: string) => View>();
const mockBuildAutoRespondModal = mock.fn<() => View>();
const mockBuildCronJobModal = mock.fn<() => View>();
const mockAddRule = mock.fn<
  (
    channels: string[],
    userFilters?: string[],
    keywords?: string[],
    extraContext?: string,
    preAnalysisContext?: string,
  ) => Promise<void>
>(async () => {});
const mockUpdateRule = mock.fn<
  (
    ruleId: string,
    patch: {
      channels?: string[];
      userFilters?: string[];
      keywords?: string[];
      extraContext?: string;
      preAnalysisContext?: string;
    },
  ) => Promise<AutoRespondRule | null>
>(async (ruleId) => ({ id: ruleId, channels: ["C1"], enabled: true }));
const mockToggleRule = mock.fn<(ruleId: string) => Promise<null>>(async () => null);
const mockDeleteRule = mock.fn<(ruleId: string) => Promise<void>>(async () => {});
const mockGetRule = mock.fn<(ruleId: string) => Promise<null>>(async () => null);
const mockListInstructionFiles = mock.fn<
  () => {
    roles: Array<{ role: string; files: Array<{ filename: string; source: string }> }>;
    repos: Array<{ filename: string; hasOverride: boolean; hasDefault: boolean }>;
  }
>();
const mockReadInstructionFile =
  mock.fn<
    (filepath: string) => { default_content: string | null; custom_content: string | null }
  >();
const mockWriteInstructionFile = mock.fn<(filename: string, content: string) => void>();
const mockDeleteInstructionFile = mock.fn<(filepath: string) => void>();
const mockGetEffectiveContentLength = mock.fn<(filepath: string) => number>();
const mockSetUserPreference = mock.fn<
  (userId: string, key: string, value: string | boolean | number) => Promise<void>
>(async () => {});
const mockToggleJob = mock.fn<(jobId: string) => Promise<null>>(async () => null);
const mockDeleteJob = mock.fn<(jobId: string) => Promise<void>>(async () => {});
const mockGetJob = mock.fn<(jobId: string) => Promise<null>>(async () => null);
const mockUpdateJob = mock.fn<
  (jobId: string, params: Record<string, string | number>) => Promise<null>
>(async () => null);
const mockRunJobNow = mock.fn<(jobId: string, tz: string) => Promise<void>>(async () => {});

function makeDeps(): HomeTabDeps {
  return {
    loadRoles: mockLoadRoles,
    setOwner: mockSetOwner,
    setRole: mockSetRole,
    isUserDisabled: mockIsUserDisabled,
    claimOwnershipFromDisabled: mockClaimOwnershipFromDisabled,
    transferOwnership: mockTransferOwnership,
    hasOwner: mockHasOwner,
    userCanManageRoles: mockUserCanManageRoles,
    userCanEditConfig: mockUserCanEditConfig,
    buildHomeView: mockBuildHomeView,
    buildUserSelectModal: mockBuildUserSelectModal,
    buildRemoveUserModal: mockBuildRemoveUserModal,
    buildSettingsModal: mockBuildSettingsModal,
    buildConfigFilePickerModal:
      mockBuildConfigFilePickerModal as Function as HomeTabDeps["buildConfigFilePickerModal"],
    buildConfigEditorModal: mockBuildConfigEditorModal,
    buildConfigCreateFileModal: mockBuildConfigCreateFileModal,
    buildAutoRespondModal: mockBuildAutoRespondModal,
    buildCronJobModal: mockBuildCronJobModal,
    addRule: mockAddRule as Function as HomeTabDeps["addRule"],
    updateRule: mockUpdateRule as Function as HomeTabDeps["updateRule"],
    toggleRule: mockToggleRule as Function as HomeTabDeps["toggleRule"],
    deleteRule: mockDeleteRule as Function as HomeTabDeps["deleteRule"],
    getRule: mockGetRule,
    listInstructionFiles:
      mockListInstructionFiles as () => void as HomeTabDeps["listInstructionFiles"],
    readInstructionFile: mockReadInstructionFile,
    writeInstructionFile: mockWriteInstructionFile,
    deleteInstructionFile: mockDeleteInstructionFile,
    getEffectiveContentLength: mockGetEffectiveContentLength,
    setUserPreference: mockSetUserPreference as Function as HomeTabDeps["setUserPreference"],
    toggleJob: mockToggleJob as Function as HomeTabDeps["toggleJob"],
    deleteJob: mockDeleteJob as Function as HomeTabDeps["deleteJob"],
    getJob: mockGetJob,
    updateJob: mockUpdateJob as Function as HomeTabDeps["updateJob"],
    runJobNow: mockRunJobNow as Function as HomeTabDeps["runJobNow"],
  };
}

// ============================================================================
// Helpers
// ============================================================================

type EventHandler = (args: { event: { user: string }; client: MockClient }) => Promise<void>;

type ActionHandler = (args: {
  ack: () => Promise<void>;
  body: { user: { id: string }; trigger_id: string; view?: { id: string } };
  client: MockClient;
  action?: { value?: string };
}) => Promise<void>;

type ViewHandler = (args: {
  ack: (errorResp?: { response_action: string; errors: Record<string, string> }) => Promise<void>;
  view: {
    state: { values: Record<string, Record<string, Record<string, unknown>>> };
    private_metadata?: string;
  };
  body: { user: { id: string } };
  client: MockClient;
}) => Promise<void>;

interface MockClient {
  views: {
    publish: ReturnType<typeof mock.fn>;
    open: ReturnType<typeof mock.fn>;
    push: ReturnType<typeof mock.fn>;
    update: ReturnType<typeof mock.fn>;
  };
  conversations: {
    open: ReturnType<typeof mock.fn>;
  };
  files: {
    uploadV2: ReturnType<typeof mock.fn>;
  };
}

const capturedEventHandlers = new Map<string, EventHandler>();
const capturedActionHandlers = new Map<string | RegExp, ActionHandler>();
const capturedViewHandlers = new Map<string, ViewHandler>();

function makeApp(deps: HomeTabDeps): App {
  const obj = {
    event: (eventName: string, handler: EventHandler) => {
      capturedEventHandlers.set(eventName, handler);
    },
    action: (actionId: string | RegExp, handler: ActionHandler) => {
      capturedActionHandlers.set(actionId, handler);
    },
    view: (viewId: string, handler: ViewHandler) => {
      capturedViewHandlers.set(viewId, handler);
    },
  };
  const app = obj as never as App;
  registerHomeTabHandler(app, deps);
  return app;
}

/** Find an action handler by exact string key or by matching a regex key against a string. */
function getActionHandler(id: string): ActionHandler | undefined {
  // Try exact match first
  const exact = capturedActionHandlers.get(id);
  if (exact) return exact;
  // Try regex keys
  for (const [key, handler] of capturedActionHandlers) {
    if (key instanceof RegExp && key.test(id)) return handler;
  }
  return undefined;
}

function makeClient(): MockClient {
  return {
    views: {
      publish: mock.fn(async () => {}),
      open: mock.fn(async () => {}),
      push: mock.fn(async () => {}),
      update: mock.fn(async () => {}),
    },
    conversations: {
      open: mock.fn(async () => ({ channel: { id: "D_DM_CHANNEL" } })),
    },
    files: {
      uploadV2: mock.fn(async () => {}),
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
  mockSetRole.mock.resetCalls();
  // (mockSetRole already reset above)
  // (mockSetRole already reset above)
  // (mockSetRole already reset above)
  mockIsUserDisabled.mock.resetCalls();
  mockClaimOwnershipFromDisabled.mock.resetCalls();
  mockTransferOwnership.mock.resetCalls();
  mockHasOwner.mock.resetCalls();
  mockUserCanManageRoles.mock.resetCalls();
  mockBuildHomeView.mock.resetCalls();
  mockBuildUserSelectModal.mock.resetCalls();
  mockBuildRemoveUserModal.mock.resetCalls();
  mockBuildSettingsModal.mock.resetCalls();
  mockBuildConfigFilePickerModal.mock.resetCalls();
  mockBuildConfigEditorModal.mock.resetCalls();
  mockBuildConfigCreateFileModal.mock.resetCalls();
  mockSetUserPreference.mock.resetCalls();
  mockUserCanEditConfig.mock.resetCalls();
  mockListInstructionFiles.mock.resetCalls();
  mockReadInstructionFile.mock.resetCalls();
  mockWriteInstructionFile.mock.resetCalls();
  mockDeleteInstructionFile.mock.resetCalls();
  mockGetEffectiveContentLength.mock.resetCalls();

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
  mockBuildConfigFilePickerModal.mock.mockImplementation(() => dummyView);
  mockBuildConfigEditorModal.mock.mockImplementation(() => dummyView);
  mockBuildConfigCreateFileModal.mock.mockImplementation(() => dummyView);
  mockUserCanManageRoles.mock.mockImplementation(async () => true);
  mockUserCanEditConfig.mock.mockImplementation(async () => true);
  mockListInstructionFiles.mock.mockImplementation(() => ({ roles: [], repos: [] }));
  mockReadInstructionFile.mock.mockImplementation(() => ({
    default_content: null,
    custom_content: null,
  }));
  mockWriteInstructionFile.mock.mockImplementation(() => {});
  mockDeleteInstructionFile.mock.mockImplementation(() => {});
  mockGetEffectiveContentLength.mock.mockImplementation(() => 100);
}

beforeEach(() => {
  resetAllMocks();
  setDefaultMocks();
  makeApp(makeDeps());
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
    assert.ok(getActionHandler("view_config_dir:user"));
    assert.ok(capturedActionHandlers.has("edit_config_file"));
    assert.ok(capturedActionHandlers.has("create_config_file"));
    assert.ok(capturedActionHandlers.has("delete_config_file"));
    assert.ok(capturedActionHandlers.has("chat_edit_config_file"));
    assert.ok(capturedViewHandlers.has("transfer_ownership_modal"));
    assert.ok(capturedViewHandlers.has("add_admin_modal"));
    assert.ok(capturedViewHandlers.has("remove_admin_modal"));
    assert.ok(capturedViewHandlers.has("add_dev_modal"));
    assert.ok(capturedViewHandlers.has("remove_dev_modal"));
    assert.ok(capturedViewHandlers.has("settings_modal"));
    assert.ok(capturedViewHandlers.has("config_editor_modal"));
    assert.ok(capturedViewHandlers.has("config_create_modal"));
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
    const publishArgs = client.views.publish.mock.calls[0].arguments[0] as {
      user_id: string;
      view: View;
    };
    assert.equal(publishArgs.user_id, "U001");
  });

  it("checks if owner is disabled and passes ownerDisabled flag", async () => {
    mockIsUserDisabled.mock.mockImplementation(async () => true);
    const client = makeClient();
    const handler = capturedEventHandlers.get("app_home_opened")!;

    await handler({ event: { user: "U001" }, client });

    const buildArgs = mockBuildHomeView.mock.calls[0].arguments[0] as {
      userId: string;
      ownerDisabled?: boolean;
    };
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
    const buildArgs = mockBuildHomeView.mock.calls[0].arguments[0] as {
      userId: string;
      ownerDisabled?: boolean;
    };
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
      ack: async (resp) => {
        ackResponse = resp;
      },
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
      ack: async (resp) => {
        ackResponse = resp;
      },
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
    mockSetRole.mock.mockImplementation(async () => ({ success: true }));
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

    assert.equal(mockSetRole.mock.callCount(), 1);
    assert.equal(mockSetRole.mock.calls[0].arguments[0], "U_NEW_ADMIN");
    assert.equal(mockSetRole.mock.calls[0].arguments[1], "admin");
  });

  it("returns error when user has no permission", async () => {
    mockUserCanManageRoles.mock.mockImplementation(async () => false);
    const handler = capturedViewHandlers.get("add_admin_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => {
        ackResponse = resp;
      },
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
    mockSetRole.mock.mockImplementation(async () => ({
      success: false,
      error: "User is already an admin",
    }));
    const handler = capturedViewHandlers.get("add_admin_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => {
        ackResponse = resp;
      },
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
    mockSetRole.mock.mockImplementation(async () => ({ success: true }));
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

    assert.equal(mockSetRole.mock.callCount(), 1);
    assert.equal(mockSetRole.mock.calls[0].arguments[0], "U_ADMIN1");
    assert.equal(mockSetRole.mock.calls[0].arguments[1], "member");
  });

  it("returns error when no user selected", async () => {
    const handler = capturedViewHandlers.get("remove_admin_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => {
        ackResponse = resp;
      },
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
      (c) => c.arguments[1] === "reactionDelivery",
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
      (c) => c.arguments[1] === "notifyOnResponse",
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

// ============================================================================
// view_config_dir action
// ============================================================================

describe("view_config_dir action", () => {
  it("opens file picker modal for role directory", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [
        {
          role: "user",
          files: [
            { filename: "identity.md", source: "default" },
            { filename: "custom.md", source: "custom-only" },
          ],
        },
      ],
      repos: [],
    }));
    const client = makeClient();
    const handler = getActionHandler("view_config_dir:user")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
      action: { value: "user" },
    });

    assert.equal(mockBuildConfigFilePickerModal.mock.callCount(), 1);
    const args = mockBuildConfigFilePickerModal.mock.calls[0].arguments;
    assert.equal(args[0], "user");
    assert.equal(args[2], false); // isRepoDir
    assert.equal(client.views.open.mock.callCount(), 1);
  });

  it("opens file picker modal for repo directory", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [],
      repos: [
        { filename: "my-repo/changes_instructions.md", hasOverride: false, hasDefault: true },
      ],
    }));
    const client = makeClient();
    const handler = getActionHandler("view_config_dir:user")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
      action: { value: "my-repo" },
    });

    assert.equal(mockBuildConfigFilePickerModal.mock.callCount(), 1);
    const args = mockBuildConfigFilePickerModal.mock.calls[0].arguments;
    assert.equal(args[0], "my-repo");
    assert.equal(args[2], true); // isRepoDir
  });
});

// ============================================================================
// edit_config_file action
// ============================================================================

describe("edit_config_file action", () => {
  it("pushes editor modal for default-only file", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: "default content",
      custom_content: null,
    }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("edit_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1", view: { id: "V123" } },
      client,
      action: { value: "user/identity.md" },
    });

    assert.equal(mockBuildConfigEditorModal.mock.callCount(), 1);
    const args = mockBuildConfigEditorModal.mock.calls[0].arguments;
    assert.equal(args[0], "user"); // dir
    assert.equal(args[1], "identity.md"); // filename
    assert.equal(args[2], "default content"); // content
    assert.equal(args[3], "default-only"); // fileState
    assert.equal(client.views.push.mock.callCount(), 1);
  });

  it("pushes editor modal for overridden file with custom content", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: "default content",
      custom_content: "custom override",
    }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("edit_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1", view: { id: "V123" } },
      client,
      action: { value: "user/identity.md" },
    });

    const args = mockBuildConfigEditorModal.mock.calls[0].arguments;
    assert.equal(args[2], "custom override"); // content
    assert.equal(args[3], "has-override"); // fileState
  });

  it("pushes editor modal for custom-only file", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: null,
      custom_content: "custom only content",
    }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("edit_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1", view: { id: "V123" } },
      client,
      action: { value: "dev/custom-rule.md" },
    });

    const args = mockBuildConfigEditorModal.mock.calls[0].arguments;
    assert.equal(args[2], "custom only content"); // content
    assert.equal(args[3], "custom-only"); // fileState
  });
});

// ============================================================================
// config_editor_modal submission
// ============================================================================

describe("config_editor_modal submission", () => {
  it("saves file content via writeInstructionFile", async () => {
    const client = makeClient();
    const handler = capturedViewHandlers.get("config_editor_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            content_block: {
              file_content: { value: "new content" },
            },
          },
        },
        private_metadata: JSON.stringify({
          dir: "user",
          filename: "identity.md",
          hasDefault: true,
          hasOverride: false,
        }),
      },
      body: { user: { id: "U001" } },
      client,
    });

    assert.equal(mockWriteInstructionFile.mock.callCount(), 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0].arguments;
    assert.equal(writeArgs[0], "user/identity.md");
    assert.equal(writeArgs[1], "new content");
    assert.equal(client.views.publish.mock.callCount(), 1); // home tab refreshed
  });

  it("rejects when user has no edit permission", async () => {
    mockUserCanEditConfig.mock.mockImplementation(async () => false);
    const client = makeClient();
    const handler = capturedViewHandlers.get("config_editor_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => {
        ackResponse = resp;
      },
      view: {
        state: {
          values: {
            content_block: {
              file_content: { value: "content" },
            },
          },
        },
        private_metadata: JSON.stringify({ dir: "user", filename: "identity.md" }),
      },
      body: { user: { id: "U_MEMBER" } },
      client,
    });

    assert.ok(ackResponse);
    assert.equal(ackResponse!.response_action, "errors");
    assert.ok(ackResponse!.errors.content_block.includes("permission"));
    assert.equal(mockWriteInstructionFile.mock.callCount(), 0);
  });
});

// ============================================================================
// create_config_file action + config_create_modal submission
// ============================================================================

describe("create_config_file action", () => {
  it("pushes the create file modal", async () => {
    const client = makeClient();
    const handler = capturedActionHandlers.get("create_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
      action: { value: "user" },
    });

    assert.equal(mockBuildConfigCreateFileModal.mock.callCount(), 1);
    assert.equal(mockBuildConfigCreateFileModal.mock.calls[0].arguments[0], "user");
    assert.equal(client.views.push.mock.callCount(), 1);
  });
});

describe("config_create_modal submission", () => {
  it("creates file and appends .md extension", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: null,
      custom_content: null,
    }));
    const client = makeClient();
    const handler = capturedViewHandlers.get("config_create_modal")!;

    await handler({
      ack: async () => {},
      view: {
        state: {
          values: {
            filename_block: { filename: { value: "my-instructions" } },
            content_block: { file_content: { value: "the content" } },
          },
        },
        private_metadata: JSON.stringify({ dir: "user" }),
      },
      body: { user: { id: "U001" } },
      client,
    });

    assert.equal(mockWriteInstructionFile.mock.callCount(), 1);
    const args = mockWriteInstructionFile.mock.calls[0].arguments;
    assert.equal(args[0], "user/my-instructions.md");
    assert.equal(args[1], "the content");
  });

  it("rejects duplicate filename", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: "existing",
      custom_content: null,
    }));
    const handler = capturedViewHandlers.get("config_create_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => {
        ackResponse = resp;
      },
      view: {
        state: {
          values: {
            filename_block: { filename: { value: "identity.md" } },
            content_block: { file_content: { value: "content" } },
          },
        },
        private_metadata: JSON.stringify({ dir: "user" }),
      },
      body: { user: { id: "U001" } },
      client: makeClient(),
    });

    assert.ok(ackResponse);
    assert.equal(ackResponse!.response_action, "errors");
    assert.ok(ackResponse!.errors.filename_block.includes("already exists"));
    assert.equal(mockWriteInstructionFile.mock.callCount(), 0);
  });

  it("rejects when user has no permission", async () => {
    mockUserCanEditConfig.mock.mockImplementation(async () => false);
    const handler = capturedViewHandlers.get("config_create_modal")!;
    let ackResponse: { response_action: string; errors: Record<string, string> } | undefined;

    await handler({
      ack: async (resp) => {
        ackResponse = resp;
      },
      view: {
        state: {
          values: {
            filename_block: { filename: { value: "test" } },
            content_block: { file_content: { value: "content" } },
          },
        },
        private_metadata: JSON.stringify({ dir: "user" }),
      },
      body: { user: { id: "U_MEMBER" } },
      client: makeClient(),
    });

    assert.ok(ackResponse);
    assert.equal(ackResponse!.response_action, "errors");
    assert.ok(ackResponse!.errors.filename_block.includes("permission"));
  });
});

// ============================================================================
// delete_config_file action
// ============================================================================

describe("delete_config_file action", () => {
  it("deletes file and updates modal to show default when default exists", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: "default content",
      custom_content: "custom content",
    }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("delete_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1", view: { id: "V123" } },
      client,
      action: { value: "user/identity.md" },
    });

    assert.equal(mockDeleteInstructionFile.mock.callCount(), 1);
    assert.equal(mockDeleteInstructionFile.mock.calls[0].arguments[0], "user/identity.md");
    assert.equal(mockBuildConfigEditorModal.mock.callCount(), 1);
    const editorArgs = mockBuildConfigEditorModal.mock.calls[0].arguments;
    assert.equal(editorArgs[2], "default content");
    assert.equal(editorArgs[3], "default-only");
    assert.equal(client.views.update.mock.callCount(), 1);
    assert.equal(client.views.publish.mock.callCount(), 1);
  });

  it("deletes custom-only file and shows confirmation", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: null,
      custom_content: "custom only",
    }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("delete_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1", view: { id: "V123" } },
      client,
      action: { value: "user/custom.md" },
    });

    assert.equal(mockDeleteInstructionFile.mock.callCount(), 1);
    assert.equal(mockBuildConfigEditorModal.mock.callCount(), 0);
    assert.equal(client.views.update.mock.callCount(), 1);
  });

  it("does not delete when user has no permission", async () => {
    mockUserCanEditConfig.mock.mockImplementation(async () => false);
    const client = makeClient();
    const handler = capturedActionHandlers.get("delete_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U_MEMBER" }, trigger_id: "t1", view: { id: "V123" } },
      client,
      action: { value: "user/identity.md" },
    });

    assert.equal(mockDeleteInstructionFile.mock.callCount(), 0);
  });
});

// ============================================================================
// chat_edit_config_file action
// ============================================================================

describe("chat_edit_config_file action", () => {
  it("sends a DM with the file content and closes the modal", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: "the file content here",
      custom_content: null,
    }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("chat_edit_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1", view: { id: "V123" } },
      client,
      action: { value: "user/identity.md" },
    });

    // Opens a DM conversation with the user
    assert.equal(client.conversations.open.mock.callCount(), 1);
    // Uploads file content via files.uploadV2
    assert.equal(client.files.uploadV2.mock.callCount(), 1);
    const uploadArgs = client.files.uploadV2.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(uploadArgs.channel_id, "D_DM_CHANNEL");
    assert.equal(uploadArgs.content, "the file content here");
    assert.equal(uploadArgs.title, "user/identity.md");
    // Modal should be updated with confirmation
    assert.equal(client.views.update.mock.callCount(), 1);
  });

  it("uses custom content when override exists", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: "default",
      custom_content: "custom override content",
    }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("chat_edit_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1", view: { id: "V123" } },
      client,
      action: { value: "user/identity.md" },
    });

    const uploadArgs = client.files.uploadV2.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(uploadArgs.content, "custom override content");
  });
});
