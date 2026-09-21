import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import type { App, ViewOutput, ViewStateValue } from "@slack/bolt";
import type { View } from "@slack/types";
import type { HomeTabDeps } from "./homeTab.js";
import { registerHomeTabHandler } from "./homeTab.js";
import { createSlackClientMock, type MockSlackClient } from "../testSlackClient.js";
import {
  createAppHomeOpenedArgs,
  createBlockActionArgs,
  createSlackAppMock,
  createViewSubmitArgs,
  type MockSlackApp,
} from "../testBoltApp.js";
import {
  registerQuarantineStore,
  clearQuarantineStores,
} from "../../state/stateQuarantineRegistry.js";
import type { AutoRespondRule } from "../../autoRespond.js";
import type { CronJob } from "../../cronJobs.js";
import type { UserRole } from "../../roles.js";
import type { JobOutcome } from "../../cronScheduler.js";
import type { JsonObject } from "../../config.js";
import type { RegisteredPreferences } from "../../plugins-sdk/sdk.js";

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
const mockToggleJob = vi.fn<(jobId: string) => Promise<CronJob | null>>(async () => null);
const mockDeleteJob = vi.fn<(jobId: string) => Promise<boolean>>(async () => true);
const mockGetJob = vi.fn<(jobId: string) => Promise<CronJob | null>>(async () => null);
const mockUpdateJob = vi.fn<(jobId: string, params: Partial<CronJob>) => Promise<CronJob | null>>(
  async () => null,
);
const mockGetRole = vi.fn<(userId: string) => Promise<UserRole>>(async () => "member" as UserRole);
const mockRunJobNow = vi.fn<(job: CronJob, client: App["client"]) => Promise<JobOutcome>>(
  async () => ({ skipped: false }),
);
const mockStoreRetry = vi.fn<(key: string) => Promise<{ ok: boolean; error?: string }>>(
  async () => ({
    ok: true,
  }),
);
const mockStoreRemove = vi.fn<(key: string) => Promise<boolean>>(async () => true);
const mockGetInvestigationsChannel = vi.fn<() => string | null>(() => null);
const mockListOpenInvestigations = vi.fn<() => object[]>(() => []);
const mockMergePluginPreferenceSlice = vi.fn<
  (plugin: string, userId: string, partial: JsonObject) => Promise<void>
>(async () => {});
const mockGetLoadedPluginPreferences = vi.fn<
  () => Array<{ plugin: string; preferences: RegisteredPreferences }>
>(() => []);

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
    setUserPreference: mockSetUserPreference as HomeTabDeps["setUserPreference"],
    toggleJob: mockToggleJob as HomeTabDeps["toggleJob"],
    deleteJob: mockDeleteJob as HomeTabDeps["deleteJob"],
    getJob: mockGetJob,
    getRole: mockGetRole,
    mergePluginPreferenceSlice: mockMergePluginPreferenceSlice,
    getLoadedPluginPreferences: mockGetLoadedPluginPreferences,
    clearQuarantinedWorker: async () => ({ ok: false, reason: "stubbed in tests" }),
    getInvestigationsChannel: mockGetInvestigationsChannel,
    listOpenInvestigations: mockListOpenInvestigations,
    updateJob: mockUpdateJob as HomeTabDeps["updateJob"],
    runJobNow: mockRunJobNow as HomeTabDeps["runJobNow"],
  };
}

// ============================================================================
// Helpers
// ============================================================================

let app: MockSlackApp;

function makeApp(deps: HomeTabDeps): MockSlackApp {
  app = createSlackAppMock();
  registerHomeTabHandler(app, deps);
  return app;
}

/** Find a registered `app.action(...)` call by exact ID, or by regex pattern matching `id`. */
function findActionHandler(id: string) {
  const exact = app.action.mock.calls.find(
    ([pattern]) => typeof pattern === "string" && pattern === id,
  );
  if (exact) return exact[1];
  return app.action.mock.calls.find(
    ([pattern]) => pattern instanceof RegExp && pattern.test(id),
  )?.[1];
}

/** Same as `findActionHandler`, but throws when nothing matches — for direct invocation. */
function getActionHandler(id: string) {
  const handler = findActionHandler(id);
  if (!handler) throw new Error(`no action handler registered matching "${id}"`);
  return handler;
}

function findViewHandler(id: string) {
  return app.view.mock.calls.find(
    ([callbackId]) => typeof callbackId === "string" && callbackId === id,
  )?.[1];
}

function getViewHandler(id: string) {
  const handler = findViewHandler(id);
  if (!handler) throw new Error(`no view handler registered for "${id}"`);
  return handler;
}

function findEventHandler(name: string) {
  return app.event.mock.calls.find(
    ([eventName]) => typeof eventName === "string" && eventName === name,
  )?.[1];
}

function getEventHandler(name: string) {
  const handler = findEventHandler(name);
  if (!handler) throw new Error(`no event handler registered for "${name}"`);
  return handler;
}

function makeClient(): MockSlackClient {
  const client = createSlackClientMock();
  client.conversations.open.mockResolvedValue({ ok: true, channel: { id: "D_DM_CHANNEL" } });
  return client;
}

// ----------------------------------------------------------------------------
// `ViewStateValue` builders — typed state.values entries for view submissions
// ----------------------------------------------------------------------------

function usersSelectValue(userId: string | null): ViewStateValue {
  return { type: "users_select", selected_user: userId };
}

function staticSelectValue(value: string | null): ViewStateValue {
  return {
    type: "static_select",
    selected_option: value === null ? null : { value, text: { type: "plain_text", text: value } },
  };
}

function checkboxesValue(values: string[]): ViewStateValue {
  return {
    type: "checkboxes",
    selected_options: values.map((value) => ({
      value,
      text: { type: "plain_text", text: value },
    })),
  };
}

function textInputValue(value: string): ViewStateValue {
  return { type: "plain_text_input", value };
}

/** A minimal but fully-typed `ViewOutput`, for tests that only care about `body.view.id`. */
function stubViewOutput(id: string): ViewOutput {
  return {
    id,
    callback_id: "test_view",
    team_id: "T_TEST",
    app_id: "A_TEST",
    bot_id: "B_TEST",
    title: { type: "plain_text", text: "Test" },
    type: "modal",
    blocks: [],
    close: null,
    submit: null,
    state: { values: {} },
    hash: "test-hash",
    private_metadata: "",
    root_view_id: null,
    previous_view_id: null,
    clear_on_close: false,
    notify_on_close: false,
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
  mockMergePluginPreferenceSlice.mockClear();
  mockGetLoadedPluginPreferences.mockClear();
  mockGetJob.mockClear();
  mockUpdateJob.mockClear();
  mockGetRole.mockClear();
  clearQuarantineStores();
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
  mockMergePluginPreferenceSlice.mockImplementation(async () => {});
  mockGetLoadedPluginPreferences.mockImplementation(() => []);
  mockGetRole.mockImplementation(async () => "member" as UserRole);
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
    assert.ok(findEventHandler("app_home_opened"));
    assert.ok(findActionHandler("claim_ownership"));
    assert.ok(findActionHandler("transfer_ownership"));
    assert.ok(findActionHandler("add_admin"));
    assert.ok(findActionHandler("remove_admin"));
    assert.ok(findActionHandler("add_dev"));
    assert.ok(findActionHandler("remove_dev"));
    assert.ok(findActionHandler("open_settings"));
    assert.ok(findActionHandler("view_config_dir:user"));
    assert.ok(findActionHandler("edit_config_file"));
    assert.ok(findActionHandler("create_config_file"));
    assert.ok(findActionHandler("delete_config_file"));
    assert.ok(findActionHandler("chat_edit_config_file"));
    assert.ok(findViewHandler("transfer_ownership_modal"));
    assert.ok(findViewHandler("add_admin_modal"));
    assert.ok(findViewHandler("remove_admin_modal"));
    assert.ok(findViewHandler("add_dev_modal"));
    assert.ok(findViewHandler("remove_dev_modal"));
    assert.ok(findViewHandler("settings_modal"));
    assert.ok(findViewHandler("config_editor_modal"));
    assert.ok(findViewHandler("config_create_modal"));
  });
});

// ============================================================================
// app_home_opened event
// ============================================================================

describe("app_home_opened event", () => {
  it("publishes the home view for the user", async () => {
    const client = makeClient();
    const handler = getEventHandler("app_home_opened");

    await handler(createAppHomeOpenedArgs({ userId: "U001", client }));

    assert.equal(mockBuildHomeView.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
    const publishArgs = client.views.publish.mock.calls[0]?.[0];
    assert.ok(publishArgs);
    assert.equal(publishArgs.user_id, "U001");
  });

  it("checks if owner is disabled and passes ownerDisabled flag", async () => {
    mockIsUserDisabled.mockImplementation(async () => true);
    const client = makeClient();
    const handler = getEventHandler("app_home_opened");

    await handler(createAppHomeOpenedArgs({ userId: "U001", client }));

    const buildArgs = mockBuildHomeView.mock.calls[0][0];
    assert.equal(buildArgs.ownerDisabled, true);
  });

  it("does not check owner disabled when no owner", async () => {
    mockLoadRoles.mockImplementation(async () => ({
      owner: null,
      admins: [],
      devs: [],
    }));
    const client = makeClient();
    const handler = getEventHandler("app_home_opened");

    await handler(createAppHomeOpenedArgs({ userId: "U001", client }));

    assert.equal(mockIsUserDisabled.mock.calls.length, 0);
    const buildArgs = mockBuildHomeView.mock.calls[0][0];
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
    const handler = getActionHandler("claim_ownership");

    await handler(createBlockActionArgs({ userId: "U001", triggerId: "t1", client }));

    assert.equal(mockSetOwner.mock.calls.length, 1);
    assert.equal(mockSetOwner.mock.calls[0][0], "U001");
  });

  it("calls claimOwnershipFromDisabled when owner exists", async () => {
    mockHasOwner.mockImplementation(async () => true);
    mockClaimOwnershipFromDisabled.mockImplementation(async () => ({ success: true }));
    const client = makeClient();
    const handler = getActionHandler("claim_ownership");

    await handler(createBlockActionArgs({ userId: "U001", triggerId: "t1", client }));

    assert.equal(mockClaimOwnershipFromDisabled.mock.calls.length, 1);
  });

  it("does not refresh home view when claim fails", async () => {
    mockHasOwner.mockImplementation(async () => true);
    mockClaimOwnershipFromDisabled.mockImplementation(async () => ({
      success: false,
      error: "Owner is active",
    }));
    const client = makeClient();
    const handler = getActionHandler("claim_ownership");

    await handler(createBlockActionArgs({ userId: "U001", triggerId: "t1", client }));

    // buildHomeView is still called 0 times because the claim failed and we returned early
    assert.equal(client.views.publish.mock.calls.length, 0);
  });

  it("refreshes home view after successful claim", async () => {
    mockHasOwner.mockImplementation(async () => false);
    const client = makeClient();
    const handler = getActionHandler("claim_ownership");

    await handler(createBlockActionArgs({ userId: "U001", triggerId: "t1", client }));

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
    const handler = getActionHandler("transfer_ownership");

    await handler(createBlockActionArgs({ userId: "U_OWNER", triggerId: "t1", client }));

    assert.equal(mockBuildUserSelectModal.mock.calls.length, 1);
    assert.equal(client.views.open.mock.calls.length, 1);
  });
});

describe("transfer_ownership_modal submission", () => {
  it("returns error when no user selected", async () => {
    const handler = getViewHandler("transfer_ownership_modal");
    const args = createViewSubmitArgs({
      userId: "U_OWNER",
      values: { user_select_block: { selected_user: usersSelectValue(null) } },
    });

    await handler(args);

    const ackResponse = args.ack.mock.calls[0]?.[0];
    assert.ok(ackResponse);
    assert.ok(ackResponse.response_action === "errors");
    assert.ok(ackResponse.errors.user_select_block.includes("select a user"));
  });

  it("returns error when transfer fails", async () => {
    mockTransferOwnership.mockImplementation(async () => ({
      success: false,
      error: "Cannot transfer to yourself",
    }));
    const handler = getViewHandler("transfer_ownership_modal");
    const args = createViewSubmitArgs({
      userId: "U_OWNER",
      values: { user_select_block: { selected_user: usersSelectValue("U_NEW") } },
    });

    await handler(args);

    const ackResponse = args.ack.mock.calls[0]?.[0];
    assert.ok(ackResponse);
    assert.equal(ackResponse.response_action, "errors");
  });

  it("refreshes both users home views on success", async () => {
    mockTransferOwnership.mockImplementation(async () => ({ success: true }));
    const client = makeClient();
    const handler = getViewHandler("transfer_ownership_modal");
    const args = createViewSubmitArgs({
      userId: "U_OWNER",
      values: { user_select_block: { selected_user: usersSelectValue("U_NEW") } },
      client,
    });

    await handler(args);

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
    const handler = getViewHandler("add_admin_modal");
    const args = createViewSubmitArgs({
      userId: "U_OWNER",
      values: { user_select_block: { selected_user: usersSelectValue("U_NEW_ADMIN") } },
      client,
    });

    await handler(args);

    assert.equal(mockSetRole.mock.calls.length, 1);
    assert.equal(mockSetRole.mock.calls[0][0], "U_NEW_ADMIN");
    assert.equal(mockSetRole.mock.calls[0][1], "admin");
  });

  it("returns error when user has no permission", async () => {
    mockUserCanManageRoles.mockImplementation(async () => false);
    const handler = getViewHandler("add_admin_modal");
    const args = createViewSubmitArgs({
      userId: "U_MEMBER",
      values: { user_select_block: { selected_user: usersSelectValue("U_NEW_ADMIN") } },
    });

    await handler(args);

    const ackResponse = args.ack.mock.calls[0]?.[0];
    assert.ok(ackResponse);
    assert.ok(ackResponse.response_action === "errors");
    assert.ok(ackResponse.errors.user_select_block.includes("permission"));
  });

  it("returns error when addAdmin fails", async () => {
    mockSetRole.mockImplementation(async () => ({
      success: false,
      error: "User is already an admin",
    }));
    const handler = getViewHandler("add_admin_modal");
    const args = createViewSubmitArgs({
      userId: "U_OWNER",
      values: { user_select_block: { selected_user: usersSelectValue("U_EXISTING_ADMIN") } },
    });

    await handler(args);

    const ackResponse = args.ack.mock.calls[0]?.[0];
    assert.ok(ackResponse);
    assert.ok(ackResponse.response_action === "errors");
    assert.ok(ackResponse.errors.user_select_block.includes("already an admin"));
  });
});

// ============================================================================
// remove_admin action
// ============================================================================

describe("remove_admin action", () => {
  it("opens remove modal when admins exist", async () => {
    const client = makeClient();
    const handler = getActionHandler("remove_admin");

    await handler(createBlockActionArgs({ userId: "U_OWNER", triggerId: "t1", client }));

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
    const handler = getActionHandler("remove_admin");

    await handler(createBlockActionArgs({ userId: "U_OWNER", triggerId: "t1", client }));

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
    const handler = getViewHandler("remove_admin_modal");
    const args = createViewSubmitArgs({
      userId: "U_OWNER",
      values: { user_select_block: { selected_user: staticSelectValue("U_ADMIN1") } },
      client,
    });

    await handler(args);

    assert.equal(mockSetRole.mock.calls.length, 1);
    assert.equal(mockSetRole.mock.calls[0][0], "U_ADMIN1");
    assert.equal(mockSetRole.mock.calls[0][1], "member");
  });

  it("returns error when no user selected", async () => {
    const handler = getViewHandler("remove_admin_modal");
    const args = createViewSubmitArgs({
      userId: "U_OWNER",
      values: { user_select_block: { selected_user: staticSelectValue(null) } },
    });

    await handler(args);

    const ackResponse = args.ack.mock.calls[0]?.[0];
    assert.ok(ackResponse);
    assert.equal(ackResponse.response_action, "errors");
  });
});

// ============================================================================
// open_settings action + settings_modal
// ============================================================================

describe("open_settings action", () => {
  it("opens the settings modal", async () => {
    const client = makeClient();
    const handler = getActionHandler("open_settings");

    await handler(createBlockActionArgs({ userId: "U001", triggerId: "t1", client }));

    assert.equal(mockBuildSettingsModal.mock.calls.length, 1);
    assert.equal(client.views.open.mock.calls.length, 1);
  });
});

describe("settings_modal submission", () => {
  it("saves delivery preference when dm is selected", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue("dm") },
        notify_on_response_block: { notify_on_response: staticSelectValue("false") },
      },
      client,
    });

    await handler(args);

    assert.equal(mockSetUserPreference.mock.calls.length, 2);
    const firstCall = mockSetUserPreference.mock.calls[0];
    assert.equal(firstCall[0], "U001");
    assert.equal(firstCall[1], "reactionDelivery");
    assert.equal(firstCall[2], "dm");
  });

  it("saves delivery preference when thread is selected", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue("thread") },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
      },
      client,
    });

    await handler(args);

    const deliveryCall = mockSetUserPreference.mock.calls.find((c) => c[1] === "reactionDelivery");
    assert.ok(deliveryCall);
    assert.equal(deliveryCall[2], "thread");
  });

  it("saves notify preference when true", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue(null) },
        notify_on_response_block: { notify_on_response: staticSelectValue("true") },
      },
      client,
    });

    await handler(args);

    const notifyCall = mockSetUserPreference.mock.calls.find((c) => c[1] === "notifyOnResponse");
    assert.ok(notifyCall);
    assert.equal(notifyCall[2], true);
  });

  it("does not save preferences when no options selected", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue(null) },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
      },
      client,
    });

    await handler(args);

    assert.equal(mockSetUserPreference.mock.calls.length, 0);
  });

  it("refreshes home view after saving", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue("dm") },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
        investigation_tag_block: { investigation_tag: staticSelectValue(null) },
        investigation_breadcrumb_block: { investigation_breadcrumb: staticSelectValue(null) },
      },
      client,
    });

    await handler(args);

    assert.equal(mockBuildHomeView.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
  });

  it("saves investigation tag preference when true", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue(null) },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
        investigation_tag_block: { investigation_tag: staticSelectValue("true") },
        investigation_breadcrumb_block: { investigation_breadcrumb: staticSelectValue(null) },
      },
      client,
    });

    await handler(args);

    const tagCall = mockSetUserPreference.mock.calls.find((c) => c[1] === "investigationTag");
    assert.ok(tagCall);
    assert.equal(tagCall[2], true);
  });

  it("saves investigation tag preference when false", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue(null) },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
        investigation_tag_block: { investigation_tag: staticSelectValue("false") },
        investigation_breadcrumb_block: { investigation_breadcrumb: staticSelectValue(null) },
      },
      client,
    });

    await handler(args);

    const tagCall = mockSetUserPreference.mock.calls.find((c) => c[1] === "investigationTag");
    assert.ok(tagCall);
    assert.equal(tagCall[2], false);
  });

  it("saves investigation breadcrumb preference when explicit", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue(null) },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
        investigation_tag_block: { investigation_tag: staticSelectValue(null) },
        investigation_breadcrumb_block: {
          investigation_breadcrumb: staticSelectValue("explicit"),
        },
      },
      client,
    });

    await handler(args);

    const breadcrumbCall = mockSetUserPreference.mock.calls.find(
      (c) => c[1] === "investigationBreadcrumb",
    );
    assert.ok(breadcrumbCall);
    assert.equal(breadcrumbCall[2], "explicit");
  });

  it("saves investigation breadcrumb preference when silent", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue(null) },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
        investigation_tag_block: { investigation_tag: staticSelectValue(null) },
        investigation_breadcrumb_block: { investigation_breadcrumb: staticSelectValue("silent") },
      },
      client,
    });

    await handler(args);

    const breadcrumbCall = mockSetUserPreference.mock.calls.find(
      (c) => c[1] === "investigationBreadcrumb",
    );
    assert.ok(breadcrumbCall);
    assert.equal(breadcrumbCall[2], "silent");
  });

  it("persists plugin preferences and core prefs in one submit", async () => {
    mockGetLoadedPluginPreferences.mockReturnValue([
      {
        plugin: "trivia",
        preferences: {
          fields: [
            {
              key: "revealReminders",
              type: "toggle",
              label: "prefs.reveal_reminders",
              default: false,
            },
          ],
          schema: z.object({ revealReminders: z.boolean() }),
          translate: (key: string) => key,
        },
      },
    ]);
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue("dm") },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
        investigation_tag_block: { investigation_tag: staticSelectValue(null) },
        investigation_breadcrumb_block: { investigation_breadcrumb: staticSelectValue(null) },
        "plugin_pref:trivia:revealReminders": {
          revealReminders: checkboxesValue(["revealReminders"]),
        },
      },
      client,
    });

    await handler(args);

    // Plugin slice merged with the parsed boolean value.
    assert.equal(mockMergePluginPreferenceSlice.mock.calls.length, 1);
    assert.deepEqual(mockMergePluginPreferenceSlice.mock.calls[0], [
      "trivia",
      "U001",
      { revealReminders: true },
    ]);
    // Core preference persisted in the same submit.
    assert.ok(
      mockSetUserPreference.mock.calls.some(
        (call) => call[1] === "reactionDelivery" && call[2] === "dm",
      ),
    );
  });

  it("leaves the plugin slice unchanged when its value fails the schema", async () => {
    // Schema expects a string, so the boolean the modal produces is rejected.
    mockGetLoadedPluginPreferences.mockReturnValue([
      {
        plugin: "trivia",
        preferences: {
          fields: [
            {
              key: "revealReminders",
              type: "toggle",
              label: "prefs.reveal_reminders",
              default: false,
            },
          ],
          schema: z.object({ revealReminders: z.string() }),
          translate: (key: string) => key,
        },
      },
    ]);
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue("dm") },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
        investigation_tag_block: { investigation_tag: staticSelectValue(null) },
        investigation_breadcrumb_block: { investigation_breadcrumb: staticSelectValue(null) },
        "plugin_pref:trivia:revealReminders": {
          revealReminders: checkboxesValue(["revealReminders"]),
        },
      },
      client,
    });

    await handler(args);

    // Invalid slice never written; core preference still persisted.
    assert.equal(mockMergePluginPreferenceSlice.mock.calls.length, 0);
    assert.ok(
      mockSetUserPreference.mock.calls.some(
        (call) => call[1] === "reactionDelivery" && call[2] === "dm",
      ),
    );
  });

  it("skips plugin fan-out when no plugins loaded", async () => {
    const client = makeClient();
    const handler = getViewHandler("settings_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        response_delivery_block: { response_delivery: staticSelectValue(null) },
        notify_on_response_block: { notify_on_response: staticSelectValue(null) },
        investigation_tag_block: { investigation_tag: staticSelectValue(null) },
        investigation_breadcrumb_block: { investigation_breadcrumb: staticSelectValue(null) },
      },
      client,
    });

    await handler(args);

    assert.equal(mockMergePluginPreferenceSlice.mock.calls.length, 0);
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
    const handler = getActionHandler("view_config_dir:user");

    await handler(
      createBlockActionArgs({ userId: "U001", triggerId: "t1", value: "user", client }),
    );

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
    const handler = getActionHandler("view_config_dir:user");

    await handler(
      createBlockActionArgs({ userId: "U001", triggerId: "t1", value: "my-repo", client }),
    );

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
    const handler = getActionHandler("edit_config_file");
    const args = createBlockActionArgs({
      userId: "U001",
      triggerId: "t1",
      value: "user/identity.md",
      client,
    });
    args.body.view = stubViewOutput("V123");

    await handler(args);

    assert.equal(mockBuildConfigEditorModal.mock.calls.length, 1);
    const modalArgs = mockBuildConfigEditorModal.mock.calls[0];
    assert.equal(modalArgs[0], "user"); // dir
    assert.equal(modalArgs[1], "identity.md"); // filename
    assert.equal(modalArgs[2], "default content"); // content
    assert.equal(modalArgs[3], "default-only"); // fileState
    assert.equal(client.views.push.mock.calls.length, 1);
  });

  it("pushes editor modal for overridden file with custom content", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
      default_content: "default content",
      custom_content: "custom override",
    }));
    const client = makeClient();
    const handler = getActionHandler("edit_config_file");
    const args = createBlockActionArgs({
      userId: "U001",
      triggerId: "t1",
      value: "user/identity.md",
      client,
    });
    args.body.view = stubViewOutput("V123");

    await handler(args);

    const modalArgs = mockBuildConfigEditorModal.mock.calls[0];
    assert.equal(modalArgs[2], "custom override"); // content
    assert.equal(modalArgs[3], "has-override"); // fileState
  });

  it("pushes editor modal for custom-only file", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
      default_content: null,
      custom_content: "custom only content",
    }));
    const client = makeClient();
    const handler = getActionHandler("edit_config_file");
    const args = createBlockActionArgs({
      userId: "U001",
      triggerId: "t1",
      value: "dev/custom-rule.md",
      client,
    });
    args.body.view = stubViewOutput("V123");

    await handler(args);

    const modalArgs = mockBuildConfigEditorModal.mock.calls[0];
    assert.equal(modalArgs[2], "custom only content"); // content
    assert.equal(modalArgs[3], "custom-only"); // fileState
  });
});

// ============================================================================
// config_editor_modal submission
// ============================================================================

describe("config_editor_modal submission", () => {
  it("saves file content via writeInstructionFile", async () => {
    const client = makeClient();
    const handler = getViewHandler("config_editor_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: { content_block: { file_content: textInputValue("new content") } },
      privateMetadata: JSON.stringify({
        dir: "user",
        filename: "identity.md",
        hasDefault: true,
        hasOverride: false,
      }),
      client,
    });

    await handler(args);

    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0];
    assert.equal(writeArgs[0], "user/identity.md");
    assert.equal(writeArgs[1], "new content");
    assert.equal(client.views.publish.mock.calls.length, 1); // home tab refreshed
  });

  it("rejects when user has no edit permission", async () => {
    mockUserCanEditConfig.mockImplementation(async () => false);
    const client = makeClient();
    const handler = getViewHandler("config_editor_modal");
    const args = createViewSubmitArgs({
      userId: "U_MEMBER",
      values: { content_block: { file_content: textInputValue("content") } },
      privateMetadata: JSON.stringify({ dir: "user", filename: "identity.md" }),
      client,
    });

    await handler(args);

    const ackResponse = args.ack.mock.calls[0]?.[0];
    assert.ok(ackResponse);
    assert.ok(ackResponse.response_action === "errors");
    assert.ok(ackResponse.errors.content_block.includes("permission"));
    assert.equal(mockWriteInstructionFile.mock.calls.length, 0);
  });
});

// ============================================================================
// create_config_file action + config_create_modal submission
// ============================================================================

describe("create_config_file action", () => {
  it("pushes the create file modal", async () => {
    const client = makeClient();
    const handler = getActionHandler("create_config_file");

    await handler(
      createBlockActionArgs({ userId: "U001", triggerId: "t1", value: "user", client }),
    );

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
    const handler = getViewHandler("config_create_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        filename_block: { filename: textInputValue("my-instructions") },
        content_block: { file_content: textInputValue("the content") },
      },
      privateMetadata: JSON.stringify({ dir: "user" }),
      client,
    });

    await handler(args);

    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0];
    assert.equal(writeArgs[0], "user/my-instructions.md");
    assert.equal(writeArgs[1], "the content");
  });

  it("rejects duplicate filename", async () => {
    mockReadInstructionFile.mockImplementation(() => ({
      default_content: "existing",
      custom_content: null,
    }));
    const handler = getViewHandler("config_create_modal");
    const args = createViewSubmitArgs({
      userId: "U001",
      values: {
        filename_block: { filename: textInputValue("identity.md") },
        content_block: { file_content: textInputValue("content") },
      },
      privateMetadata: JSON.stringify({ dir: "user" }),
    });

    await handler(args);

    const ackResponse = args.ack.mock.calls[0]?.[0];
    assert.ok(ackResponse);
    assert.ok(ackResponse.response_action === "errors");
    assert.ok(ackResponse.errors.filename_block.includes("already exists"));
    assert.equal(mockWriteInstructionFile.mock.calls.length, 0);
  });

  it("rejects when user has no permission", async () => {
    mockUserCanEditConfig.mockImplementation(async () => false);
    const handler = getViewHandler("config_create_modal");
    const args = createViewSubmitArgs({
      userId: "U_MEMBER",
      values: {
        filename_block: { filename: textInputValue("test") },
        content_block: { file_content: textInputValue("content") },
      },
      privateMetadata: JSON.stringify({ dir: "user" }),
    });

    await handler(args);

    const ackResponse = args.ack.mock.calls[0]?.[0];
    assert.ok(ackResponse);
    assert.ok(ackResponse.response_action === "errors");
    assert.ok(ackResponse.errors.filename_block.includes("permission"));
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
    const handler = getActionHandler("delete_config_file");
    const args = createBlockActionArgs({
      userId: "U001",
      triggerId: "t1",
      value: "user/identity.md",
      client,
    });
    args.body.view = stubViewOutput("V123");

    await handler(args);

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
    const handler = getActionHandler("delete_config_file");
    const args = createBlockActionArgs({
      userId: "U001",
      triggerId: "t1",
      value: "user/custom.md",
      client,
    });
    args.body.view = stubViewOutput("V123");

    await handler(args);

    assert.equal(mockDeleteInstructionFile.mock.calls.length, 1);
    assert.equal(mockBuildConfigEditorModal.mock.calls.length, 0);
    assert.equal(client.views.update.mock.calls.length, 1);
  });

  it("skips deletion when user has no permission", async () => {
    mockUserCanEditConfig.mockImplementation(async () => false);
    const client = makeClient();
    const handler = getActionHandler("delete_config_file");
    const args = createBlockActionArgs({
      userId: "U_MEMBER",
      triggerId: "t1",
      value: "user/identity.md",
      client,
    });
    args.body.view = stubViewOutput("V123");

    await handler(args);

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
    const handler = getActionHandler("chat_edit_config_file");
    const args = createBlockActionArgs({
      userId: "U001",
      triggerId: "t1",
      value: "user/identity.md",
      client,
    });
    args.body.view = stubViewOutput("V123");

    await handler(args);

    // Opens a DM conversation with the user
    assert.equal(client.conversations.open.mock.calls.length, 1);
    // Uploads file content via files.uploadV2
    assert.equal(client.files.uploadV2.mock.calls.length, 1);
    const uploadArgs = client.files.uploadV2.mock.calls[0]?.[0];
    assert.ok(uploadArgs);
    assert.equal(uploadArgs.channel_id, "D_DM_CHANNEL");
    assert.ok("content" in uploadArgs);
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
    const handler = getActionHandler("chat_edit_config_file");
    const args = createBlockActionArgs({
      userId: "U001",
      triggerId: "t1",
      value: "user/identity.md",
      client,
    });
    args.body.view = stubViewOutput("V123");

    await handler(args);

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
    const handler = getActionHandler("ai_stop_following:rule-123");
    await handler(
      createBlockActionArgs({
        userId: "U001",
        triggerId: "t1",
        actionId: "ai_stop_following:rule-123",
        client,
      }),
    );
    assert.equal(mockDeleteRule.mock.calls.length, 1);
    assert.equal(mockDeleteRule.mock.calls[0]![0], "rule-123");
  });

  it("republishes Home Tab after stop following", async () => {
    const client = makeClient();
    const handler = getActionHandler("ai_stop_following:rule-abc");
    await handler(
      createBlockActionArgs({
        userId: "U_ADMIN",
        triggerId: "t1",
        actionId: "ai_stop_following:rule-abc",
        client,
      }),
    );
    assert.equal(mockBuildHomeView.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
  });

  it("requires manage_roles permission", async () => {
    mockUserCanManageRoles.mockImplementation(async () => false);
    const client = makeClient();
    const handler = getActionHandler("ai_stop_following:rule-xyz");
    await handler(
      createBlockActionArgs({
        userId: "U_MEMBER",
        triggerId: "t1",
        actionId: "ai_stop_following:rule-xyz",
        client,
      }),
    );
    assert.equal(mockDeleteRule.mock.calls.length, 0);
  });

  it("parses rule ID correctly", async () => {
    const client = makeClient();
    const handler = getActionHandler("ai_stop_following:my-rule-id");
    await handler(
      createBlockActionArgs({
        userId: "U001",
        triggerId: "t1",
        actionId: "ai_stop_following:my-rule-id",
        client,
      }),
    );
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
    const handler = getActionHandler("state_quarantine_retry");
    await handler(
      createBlockActionArgs({
        userId: "U_ADMIN1",
        triggerId: "t1",
        value: "cron::5",
        actionId: "state_quarantine_retry",
        client,
      }),
    );
    assert.equal(mockStoreRetry.mock.calls.length, 1);
    assert.equal(mockStoreRetry.mock.calls[0]![0], "5");
    assert.equal(client.views.publish.mock.calls.length, 1);
  });

  it("removal routes to the store's remove with the parsed key", async () => {
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_delete");
    await handler(
      createBlockActionArgs({
        userId: "U_ADMIN1",
        triggerId: "t1",
        value: "cron::2",
        actionId: "state_quarantine_delete",
        client,
      }),
    );
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
    const handler = getActionHandler("state_quarantine_retry");
    await handler(
      createBlockActionArgs({
        userId: "U_ADMIN1",
        triggerId: "t1",
        value: "memory::U9",
        actionId: "state_quarantine_retry",
        client,
      }),
    );
    assert.equal(otherRetry.mock.calls.length, 1);
    assert.equal(mockStoreRetry.mock.calls.length, 0);
  });

  it("ignores an unknown store id", async () => {
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry");
    await handler(
      createBlockActionArgs({
        userId: "U_ADMIN1",
        triggerId: "t1",
        value: "ghost::x",
        actionId: "state_quarantine_retry",
        client,
      }),
    );
    assert.equal(mockStoreRetry.mock.calls.length, 0);
  });

  it("ignores a malformed value with no separator", async () => {
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry");
    await handler(
      createBlockActionArgs({
        userId: "U_ADMIN1",
        triggerId: "t1",
        value: "noseparator",
        actionId: "state_quarantine_retry",
        client,
      }),
    );
    assert.equal(mockStoreRetry.mock.calls.length, 0);
  });

  it("rejects retry when the user lacks edit permission", async () => {
    mockUserCanEditConfig.mockImplementation(async () => false);
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry");
    await handler(
      createBlockActionArgs({
        userId: "U_MEMBER",
        triggerId: "t1",
        value: "cron::0",
        actionId: "state_quarantine_retry",
        client,
      }),
    );
    assert.equal(mockStoreRetry.mock.calls.length, 0);
  });

  it("still refreshes the Home Tab when retry reports the entry is still invalid", async () => {
    mockStoreRetry.mockImplementation(async () => ({ ok: false, error: "still bad" }));
    registerCron();
    const client = makeClient();
    const handler = getActionHandler("state_quarantine_retry");
    await handler(
      createBlockActionArgs({
        userId: "U_ADMIN1",
        triggerId: "t1",
        value: "cron::0",
        actionId: "state_quarantine_retry",
        client,
      }),
    );
    assert.equal(mockStoreRetry.mock.calls.length, 1);
    assert.equal(client.views.publish.mock.calls.length, 1);
  });
});

describe("See-… modal open handlers", () => {
  it("home_open_roles denies a non-admin (opens nothing)", async () => {
    mockUserCanManageRoles.mockResolvedValue(false);
    const client = makeClient();
    const handler = getActionHandler("home_open_roles");
    await handler(createBlockActionArgs({ userId: "U1", triggerId: "t1", client }));
    assert.equal(client.views.open.mock.calls.length, 0);
  });

  it("home_open_roles opens the Role Management modal for an admin", async () => {
    mockUserCanManageRoles.mockResolvedValue(true);
    const client = makeClient();
    const handler = getActionHandler("home_open_roles");
    await handler(createBlockActionArgs({ userId: "U1", triggerId: "t1", client }));
    assert.equal(client.views.open.mock.calls.length, 1);
    const opened = client.views.open.mock.calls[0]?.[0];
    assert.ok(opened);
    assert.equal(opened.view.callback_id, "roles_modal_view");
  });

  it("home_open_auto_respond denies a non-admin", async () => {
    mockUserCanManageRoles.mockResolvedValue(false);
    const client = makeClient();
    const handler = getActionHandler("home_open_auto_respond");
    await handler(createBlockActionArgs({ userId: "U1", triggerId: "t1", client }));
    assert.equal(client.views.open.mock.calls.length, 0);
  });

  it("home_open_investigations denies a non-admin", async () => {
    mockUserCanManageRoles.mockResolvedValue(false);
    const client = makeClient();
    const handler = getActionHandler("home_open_investigations");
    await handler(createBlockActionArgs({ userId: "U1", triggerId: "t1", client }));
    assert.equal(client.views.open.mock.calls.length, 0);
  });

  it("registers the plugins, MCP, status, and investigations open handlers", () => {
    assert.ok(findActionHandler("home_open_plugins"));
    assert.ok(findActionHandler("home_open_mcp"));
    assert.ok(findActionHandler("home_open_status"));
    assert.ok(findActionHandler("home_open_investigations"));
  });
});

describe("openOrPushModal (via transfer_ownership)", () => {
  it("pushes onto the stack when the interaction came from inside a modal", async () => {
    const client = makeClient();
    const handler = getActionHandler("transfer_ownership");
    const args = createBlockActionArgs({ userId: "U1", triggerId: "t1", client });
    args.body.view = stubViewOutput("V1");

    await handler(args);

    assert.equal(client.views.push.mock.calls.length, 1);
    assert.equal(client.views.open.mock.calls.length, 0);
  });
});

describe("publishHomeView block cap", () => {
  it("truncates a home view that exceeds Slack's 100-block limit", async () => {
    mockLoadRoles.mockResolvedValue({ owner: null, admins: [], devs: [] });
    mockBuildHomeView.mockResolvedValue({
      type: "home",
      blocks: Array.from({ length: 150 }, () => ({ type: "divider" })),
    } as View);
    const client = makeClient();
    const handler = getEventHandler("app_home_opened");
    await handler(createAppHomeOpenedArgs({ userId: "U001", client }));
    const published = client.views.publish.mock.calls[0]?.[0];
    assert.ok(published);
    assert.equal(published.view.blocks.length, 100);
    assert.equal(published.view.blocks[99]?.type, "context");
  });
});
