import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { View } from "@slack/types";
import type { HomeTabDeps } from "./homeTab.js";
import { registerHomeTabHandler } from "./homeTab.js";
import {
  registerQuarantineStore,
  clearQuarantineStores,
} from "../../state/stateQuarantineRegistry.js";
import type { AutoRespondRule } from "../../autoRespond.js";

// ============================================================================
// Mock Functions
// ============================================================================

const mockLoadRoles =
  vi.fn<() => Promise<{ owner: string | null; admins: string[]; devs: string[] }>>();
const mockSetOwner = vi.fn<(userId: string) => Promise<void>>(async () => {});
const mockSetRole =
  vi.fn<(userId: string, role: string) => Promise<{ success: boolean; error?: string }>>();
const mockIsUserDisabled = vi.fn<(client: App["client"], userId: string) => Promise<boolean>>();
const mockClaimOwnershipFromDisabled =
  vi.fn<(client: App["client"], userId: string) => Promise<{ success: boolean; error?: string }>>();
const mockTransferOwnership =
  vi.fn<
    (
      client: App["client"],
      fromId: string,
      toId: string,
    ) => Promise<{ success: boolean; error?: string }>
  >();
const mockHasOwner = vi.fn<() => Promise<boolean>>();
const mockUserCanManageRoles = vi.fn<(userId: string) => Promise<boolean>>();
const mockUserCanEditConfig = vi.fn<(userId: string) => Promise<boolean>>();
const mockBuildHomeView =
  vi.fn<(opts: { userId: string; ownerDisabled?: boolean }) => Promise<View>>();
const mockBuildUserSelectModal =
  vi.fn<(title: string, actionId: string, placeholder: string) => View>();
const mockBuildRemoveUserModal =
  vi.fn<(title: string, actionId: string, users: string[]) => View>();
const mockBuildSettingsModal = vi.fn<(userId: string) => Promise<View>>();
const mockBuildConfigFilePickerModal =
  vi.fn<(dir: string, files: (string | Record<string, string>)[], isRepoDir: boolean) => View>();
const mockBuildConfigEditorModal =
  vi.fn<(dir: string, filename: string, content: string, fileState: string) => View>();
const mockBuildConfigCreateFileModal = vi.fn<(dir: string) => View>();
const mockBuildAutoRespondModal = vi.fn<() => View>();
const mockBuildCronJobModal = vi.fn<() => View>();
const mockAddRule = vi.fn<
  (
    channels: string[],
    userFilters?: string[],
    keywords?: string[],
    extraContext?: string,
    preAnalysisContext?: string,
  ) => Promise<void>
>(async () => {});
const mockUpdateRule = vi.fn<
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
const mockToggleRule = vi.fn<(ruleId: string) => Promise<null>>(async () => null);
const mockDeleteRule = vi.fn<(ruleId: string) => Promise<void>>(async () => {});
const mockGetRule = vi.fn<(ruleId: string) => Promise<null>>(async () => null);
const mockListInstructionFiles = vi.fn<
  () => {
    roles: Array<{ role: string; files: Array<{ filename: string; source: string }> }>;
    repos: Array<{ filename: string; hasOverride: boolean; hasDefault: boolean }>;
  }
>();
const mockReadInstructionFile =
  vi.fn<(filepath: string) => { default_content: string | null; custom_content: string | null }>();
const mockWriteInstructionFile = vi.fn<(filename: string, content: string) => void>();
const mockDeleteInstructionFile = vi.fn<(filepath: string) => void>();
const mockGetEffectiveContentLength = vi.fn<(filepath: string) => number>();
const mockSetUserPreference = vi.fn<
  (userId: string, key: string, value: string | boolean | number) => Promise<void>
>(async () => {});
const mockToggleJob = vi.fn<(jobId: string) => Promise<null>>(async () => null);
const mockDeleteJob = vi.fn<(jobId: string) => Promise<void>>(async () => {});
const mockGetJob = vi.fn<(jobId: string) => Promise<null>>(async () => null);
const mockUpdateJob = vi.fn<
  (jobId: string, params: Record<string, string | number>) => Promise<null>
>(async () => null);
const mockRunJobNow = vi.fn<(jobId: string, tz: string) => Promise<void>>(async () => {});
const mockStoreRetry = vi.fn<(key: string) => Promise<{ ok: boolean; error?: string }>>(
  async () => ({
    ok: true,
  }),
);
const mockStoreRemove = vi.fn<(key: string) => Promise<boolean>>(async () => true);
const mockGetInvestigationsChannel = vi.fn<() => string | null>(() => null);
const mockListOpenInvestigations = vi.fn<() => object[]>(() => []);

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
    getRole: async () => "member",
    clearQuarantinedWorker: async () => ({ ok: false, reason: "stubbed in tests" }),
    getInvestigationsChannel: mockGetInvestigationsChannel,
    listOpenInvestigations: mockListOpenInvestigations,
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
  action?: { value?: string; action_id?: string };
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
    publish: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
    open: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
    push: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
    update: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
  };
  conversations: {
    open: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
  };
  files: {
    uploadV2: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
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
      publish: vi.fn(async () => {}),
      open: vi.fn(async () => {}),
      push: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
    },
    conversations: {
      open: vi.fn(async () => ({ channel: { id: "D_DM_CHANNEL" } })),
    },
    files: {
      uploadV2: vi.fn(async () => {}),
    },
  };
}

const dummyView: View = {
  type: "home",
  blocks: [],
};

function resetAllMocks() {
  mockLoadRoles.mockClear();
  mockSetOwner.mockClear();
  mockSetRole.mockClear();
  // (mockSetRole already reset above)
  // (mockSetRole already reset above)
  // (mockSetRole already reset above)
  mockIsUserDisabled.mockClear();
  mockClaimOwnershipFromDisabled.mockClear();
  mockTransferOwnership.mockClear();
  mockHasOwner.mockClear();
  mockUserCanManageRoles.mockClear();
  mockBuildHomeView.mockClear();
  mockBuildUserSelectModal.mockClear();
  mockBuildRemoveUserModal.mockClear();
  mockBuildSettingsModal.mockClear();
  mockBuildConfigFilePickerModal.mockClear();
  mockBuildConfigEditorModal.mockClear();
  mockBuildConfigCreateFileModal.mockClear();
  mockSetUserPreference.mockClear();
  mockUserCanEditConfig.mockClear();
  mockListInstructionFiles.mockClear();
  mockReadInstructionFile.mockClear();
  mockWriteInstructionFile.mockClear();
  mockDeleteInstructionFile.mockClear();
  mockGetEffectiveContentLength.mockClear();
  mockStoreRetry.mockClear();
  mockStoreRemove.mockClear();
  clearQuarantineStores();

  capturedEventHandlers.clear();
  capturedActionHandlers.clear();
  capturedViewHandlers.clear();
}

function setDefaultMocks() {
  mockLoadRoles.mockImplementation(async () => ({
    owner: "U_OWNER",
    admins: ["U_ADMIN1"],
    devs: ["U_DEV1"],
  }));
  mockIsUserDisabled.mockImplementation(async () => false);
  mockHasOwner.mockImplementation(async () => true);
  mockBuildHomeView.mockImplementation(async () => dummyView);
  mockBuildUserSelectModal.mockImplementation(() => dummyView);
  mockBuildRemoveUserModal.mockImplementation(() => dummyView);
  mockBuildSettingsModal.mockImplementation(async () => dummyView);
  mockBuildConfigFilePickerModal.mockImplementation(() => dummyView);
  mockBuildConfigEditorModal.mockImplementation(() => dummyView);
  mockBuildConfigCreateFileModal.mockImplementation(() => dummyView);
  mockUserCanManageRoles.mockImplementation(async () => true);
  mockUserCanEditConfig.mockImplementation(async () => true);
  mockListInstructionFiles.mockImplementation(() => ({ roles: [], repos: [] }));
  mockReadInstructionFile.mockImplementation(() => ({
    default_content: null,
    custom_content: null,
  }));
  mockWriteInstructionFile.mockImplementation(() => {});
  mockDeleteInstructionFile.mockImplementation(() => {});
  mockGetEffectiveContentLength.mockImplementation(() => 100);
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

    assert.equal(mockBuildHomeView.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
    const publishArgs = client.views.publish.mock.calls[0][0] as {
      user_id: string;
      view: View;
    };
    assert.equal(publishArgs.user_id, "U001");
  });

  it("checks if owner is disabled and passes ownerDisabled flag", async () => {
    mockIsUserDisabled.mockImplementation(async () => true);
    const client = makeClient();
    const handler = capturedEventHandlers.get("app_home_opened")!;

    await handler({ event: { user: "U001" }, client });

    const buildArgs = mockBuildHomeView.mock.calls[0][0] as {
      userId: string;
      ownerDisabled?: boolean;
    };
    assert.equal(buildArgs.ownerDisabled, true);
  });

  it("does not check owner disabled when no owner", async () => {
    mockLoadRoles.mockImplementation(async () => ({
      owner: null,
      admins: [],
      devs: [],
    }));
    const client = makeClient();
    const handler = capturedEventHandlers.get("app_home_opened")!;

    await handler({ event: { user: "U001" }, client });

    assert.equal(mockIsUserDisabled.mock.calls.length, 0);
    const buildArgs = mockBuildHomeView.mock.calls[0][0] as {
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
    mockHasOwner.mockImplementation(async () => false);
    const client = makeClient();
    const handler = capturedActionHandlers.get("claim_ownership")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
    });

    assert.equal(mockSetOwner.mock.calls.length, 1);
    assert.equal(mockSetOwner.mock.calls[0][0], "U001");
  });

  it("calls claimOwnershipFromDisabled when owner exists", async () => {
    mockHasOwner.mockImplementation(async () => true);
    mockClaimOwnershipFromDisabled.mockImplementation(async () => ({ success: true }));
    const client = makeClient();
    const handler = capturedActionHandlers.get("claim_ownership")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
    });

    assert.equal(mockClaimOwnershipFromDisabled.mock.calls.length, 1);
  });

  it("does not refresh home view when claim fails", async () => {
    mockHasOwner.mockImplementation(async () => true);
    mockClaimOwnershipFromDisabled.mockImplementation(async () => ({
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
    assert.equal(client.views.publish.mock.calls.length, 0);
  });

  it("refreshes home view after successful claim", async () => {
    mockHasOwner.mockImplementation(async () => false);
    const client = makeClient();
    const handler = capturedActionHandlers.get("claim_ownership")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
    });

    assert.equal(mockBuildHomeView.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
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

    assert.equal(mockBuildUserSelectModal.mock.calls.length, 1);
    assert.equal(client.views.open.mock.calls.length, 1);
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
    mockTransferOwnership.mockImplementation(async () => ({
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
    mockTransferOwnership.mockImplementation(async () => ({ success: true }));
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
    assert.equal(mockBuildHomeView.mock.calls.length, 2);
    assert.equal(client.views.publish.mock.calls.length, 2);
  });
});

// ============================================================================
// add_admin action + modal
// ============================================================================

describe("add_admin_modal submission", () => {
  it("calls addAdmin on successful submission", async () => {
    mockSetRole.mockImplementation(async () => ({ success: true }));
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

    assert.equal(mockSetRole.mock.calls.length, 1);
    assert.equal(mockSetRole.mock.calls[0][0], "U_NEW_ADMIN");
    assert.equal(mockSetRole.mock.calls[0][1], "admin");
  });

  it("returns error when user has no permission", async () => {
    mockUserCanManageRoles.mockImplementation(async () => false);
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
    mockSetRole.mockImplementation(async () => ({
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

    assert.equal(mockBuildRemoveUserModal.mock.calls.length, 1);
    assert.equal(client.views.open.mock.calls.length, 1);
  });

  it("does not open modal when no admins", async () => {
    mockLoadRoles.mockImplementation(async () => ({
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

    assert.equal(client.views.open.mock.calls.length, 0);
  });
});

// ============================================================================
// remove_admin_modal submission
// ============================================================================

describe("remove_admin_modal submission", () => {
  it("calls removeAdmin on successful submission", async () => {
    mockSetRole.mockImplementation(async () => ({ success: true }));
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

    assert.equal(mockSetRole.mock.calls.length, 1);
    assert.equal(mockSetRole.mock.calls[0][0], "U_ADMIN1");
    assert.equal(mockSetRole.mock.calls[0][1], "member");
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

    assert.equal(mockBuildSettingsModal.mock.calls.length, 1);
    assert.equal(client.views.open.mock.calls.length, 1);
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

    assert.equal(mockSetUserPreference.mock.calls.length, 2);
    const firstCall = mockSetUserPreference.mock.calls[0];
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

    const deliveryCall = mockSetUserPreference.mock.calls.find((c) => c[1] === "reactionDelivery");
    assert.ok(deliveryCall);
    assert.equal(deliveryCall![2], "thread");
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

    const notifyCall = mockSetUserPreference.mock.calls.find((c) => c[1] === "notifyOnResponse");
    assert.ok(notifyCall);
    assert.equal(notifyCall![2], true);
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

    assert.equal(mockSetUserPreference.mock.calls.length, 0);
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

    assert.equal(mockBuildHomeView.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
  });
});

// ============================================================================
// view_config_dir action
// ============================================================================

describe("view_config_dir action", () => {
  it("opens file picker modal for role directory", async () => {
    mockListInstructionFiles.mockImplementation(() => ({
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

    assert.equal(mockBuildConfigFilePickerModal.mock.calls.length, 1);
    const args = mockBuildConfigFilePickerModal.mock.calls[0];
    assert.equal(args[0], "user");
    assert.equal(args[2], false); // isRepoDir
    assert.equal(client.views.open.mock.calls.length, 1);
  });

  it("opens file picker modal for repo directory", async () => {
    mockListInstructionFiles.mockImplementation(() => ({
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

    assert.equal(mockBuildConfigFilePickerModal.mock.calls.length, 1);
    const args = mockBuildConfigFilePickerModal.mock.calls[0];
    assert.equal(args[0], "my-repo");
    assert.equal(args[2], true); // isRepoDir
  });
});

// ============================================================================
// edit_config_file action
// ============================================================================

describe("edit_config_file action", () => {
  it("pushes editor modal for default-only file", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
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

    assert.equal(mockBuildConfigEditorModal.mock.calls.length, 1);
    const args = mockBuildConfigEditorModal.mock.calls[0];
    assert.equal(args[0], "user"); // dir
    assert.equal(args[1], "identity.md"); // filename
    assert.equal(args[2], "default content"); // content
    assert.equal(args[3], "default-only"); // fileState
    assert.equal(client.views.push.mock.calls.length, 1);
  });

  it("pushes editor modal for overridden file with custom content", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
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

    const args = mockBuildConfigEditorModal.mock.calls[0];
    assert.equal(args[2], "custom override"); // content
    assert.equal(args[3], "has-override"); // fileState
  });

  it("pushes editor modal for custom-only file", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
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

    const args = mockBuildConfigEditorModal.mock.calls[0];
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

    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0];
    assert.equal(writeArgs[0], "user/identity.md");
    assert.equal(writeArgs[1], "new content");
    assert.equal(client.views.publish.mock.calls.length, 1); // home tab refreshed
  });

  it("rejects when user has no edit permission", async () => {
    mockUserCanEditConfig.mockImplementation(async () => false);
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
    assert.equal(mockWriteInstructionFile.mock.calls.length, 0);
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

    assert.equal(mockBuildConfigCreateFileModal.mock.calls.length, 1);
    assert.equal(mockBuildConfigCreateFileModal.mock.calls[0][0], "user");
    assert.equal(client.views.push.mock.calls.length, 1);
  });
});

describe("config_create_modal submission", () => {
  it("creates file and appends .md extension", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
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

    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
    const args = mockWriteInstructionFile.mock.calls[0];
    assert.equal(args[0], "user/my-instructions.md");
    assert.equal(args[1], "the content");
  });

  it("rejects duplicate filename", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
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
    assert.equal(mockWriteInstructionFile.mock.calls.length, 0);
  });

  it("rejects when user has no permission", async () => {
    mockUserCanEditConfig.mockImplementation(async () => false);
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
    mockReadInstructionFile.mockImplementation(() => ({
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

    assert.equal(mockDeleteInstructionFile.mock.calls.length, 1);
    assert.equal(mockDeleteInstructionFile.mock.calls[0][0], "user/identity.md");
    assert.equal(mockBuildConfigEditorModal.mock.calls.length, 1);
    const editorArgs = mockBuildConfigEditorModal.mock.calls[0];
    assert.equal(editorArgs[2], "default content");
    assert.equal(editorArgs[3], "default-only");
    assert.equal(client.views.update.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
  });

  it("deletes custom-only file and shows confirmation", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
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

    assert.equal(mockDeleteInstructionFile.mock.calls.length, 1);
    assert.equal(mockBuildConfigEditorModal.mock.calls.length, 0);
    assert.equal(client.views.update.mock.calls.length, 1);
  });

  it("does not delete when user has no permission", async () => {
    mockUserCanEditConfig.mockImplementation(async () => false);
    const client = makeClient();
    const handler = capturedActionHandlers.get("delete_config_file")!;

    await handler({
      ack: async () => {},
      body: { user: { id: "U_MEMBER" }, trigger_id: "t1", view: { id: "V123" } },
      client,
      action: { value: "user/identity.md" },
    });

    assert.equal(mockDeleteInstructionFile.mock.calls.length, 0);
  });
});

// ============================================================================
// chat_edit_config_file action
// ============================================================================

describe("chat_edit_config_file action", () => {
  it("sends a DM with the file content and closes the modal", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
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
    assert.equal(client.conversations.open.mock.calls.length, 1);
    // Uploads file content via files.uploadV2
    assert.equal(client.files.uploadV2.mock.calls.length, 1);
    const uploadArgs = client.files.uploadV2.mock.calls[0][0] as Record<string, unknown>;
    assert.equal(uploadArgs.channel_id, "D_DM_CHANNEL");
    assert.equal(uploadArgs.content, "the file content here");
    assert.equal(uploadArgs.title, "user/identity.md");
    // Modal should be updated with confirmation
    assert.equal(client.views.update.mock.calls.length, 1);
  });

  it("uses custom content when override exists", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
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

    assert.ok(client.files.uploadV2.mock.calls[0]);
  });
});

describe("ai_stop_following action", () => {
  beforeEach(() => {
    resetAllMocks();
    setDefaultMocks();
    mockDeleteRule.mockClear();
    mockBuildHomeView.mockClear();
    makeApp(makeDeps());
  });

  it("calls deleteRule with ruleId from action_id", async () => {
    const client = makeClient();
    const handler = getActionHandler("ai_stop_following:rule-123")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
      action: { action_id: "ai_stop_following:rule-123" },
    });
    assert.equal(mockDeleteRule.mock.calls.length, 1);
    assert.equal(mockDeleteRule.mock.calls[0]![0], "rule-123");
  });

  it("republishes Home Tab after stop following", async () => {
    const client = makeClient();
    const handler = getActionHandler("ai_stop_following:rule-abc")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U_ADMIN" }, trigger_id: "t1" },
      client,
      action: { action_id: "ai_stop_following:rule-abc" },
    });
    assert.equal(mockBuildHomeView.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
  });

  it("requires manage_roles permission", async () => {
    mockUserCanManageRoles.mockImplementation(async () => false);
    const client = makeClient();
    const handler = getActionHandler("ai_stop_following:rule-xyz")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U_MEMBER" }, trigger_id: "t1" },
      client,
      action: { action_id: "ai_stop_following:rule-xyz" },
    });
    assert.equal(mockDeleteRule.mock.calls.length, 0);
  });

  it("parses rule ID correctly", async () => {
    const client = makeClient();
    const handler = getActionHandler("ai_stop_following:my-rule-id")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U001" }, trigger_id: "t1" },
      client,
      action: { action_id: "ai_stop_following:my-rule-id" },
    });
    assert.equal(mockDeleteRule.mock.calls[0]![0], "my-rule-id");
  });
});

describe("registerHomeTabHandler — state quarantine actions", () => {
  function registerCron() {
    registerQuarantineStore({
      storeId: "cron",
      label: "cron schedules",
      getSummaries: async () => [],
      retry: mockStoreRetry,
      remove: mockStoreRemove,
      isFrozen: () => false,
    });
  }

  it("retry routes to the store's retry with the parsed key and refreshes the Home Tab", async () => {
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U_ADMIN1" }, trigger_id: "t1" },
      client,
      action: { value: "cron::5", action_id: "state_quarantine_retry" },
    });
    assert.equal(mockStoreRetry.mock.calls.length, 1);
    assert.equal(mockStoreRetry.mock.calls[0]![0], "5");
    assert.equal(client.views.publish.mock.calls.length, 1);
  });

  it("removal routes to the store's remove with the parsed key", async () => {
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_delete")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U_ADMIN1" }, trigger_id: "t1" },
      client,
      action: { value: "cron::2", action_id: "state_quarantine_delete" },
    });
    assert.equal(mockStoreRemove.mock.calls.length, 1);
    assert.equal(mockStoreRemove.mock.calls[0]![0], "2");
  });

  it("only routes to the named store, not another registered store", async () => {
    registerCron();
    const otherRetry = vi.fn<(key: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    registerQuarantineStore({
      storeId: "memory",
      label: "memory",
      getSummaries: async () => [],
      retry: otherRetry,
      remove: async () => true,
      isFrozen: () => false,
    });
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U_ADMIN1" }, trigger_id: "t1" },
      client,
      action: { value: "memory::U9", action_id: "state_quarantine_retry" },
    });
    assert.equal(otherRetry.mock.calls.length, 1);
    assert.equal(mockStoreRetry.mock.calls.length, 0);
  });

  it("ignores an unknown store id", async () => {
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U_ADMIN1" }, trigger_id: "t1" },
      client,
      action: { value: "ghost::x", action_id: "state_quarantine_retry" },
    });
    assert.equal(mockStoreRetry.mock.calls.length, 0);
  });

  it("ignores a malformed value with no separator", async () => {
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U_ADMIN1" }, trigger_id: "t1" },
      client,
      action: { value: "noseparator", action_id: "state_quarantine_retry" },
    });
    assert.equal(mockStoreRetry.mock.calls.length, 0);
  });

  it("rejects retry when the user lacks edit permission", async () => {
    mockUserCanEditConfig.mockImplementation(async () => false);
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U_MEMBER" }, trigger_id: "t1" },
      client,
      action: { value: "cron::0", action_id: "state_quarantine_retry" },
    });
    assert.equal(mockStoreRetry.mock.calls.length, 0);
  });

  it("still refreshes the Home Tab when retry reports the entry is still invalid", async () => {
    mockStoreRetry.mockImplementation(async () => ({ ok: false, error: "still bad" }));
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry")!;
    await handler({
      ack: async () => {},
      body: { user: { id: "U_ADMIN1" }, trigger_id: "t1" },
      client,
      action: { value: "cron::0", action_id: "state_quarantine_retry" },
    });
    assert.equal(mockStoreRetry.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
  });
});
