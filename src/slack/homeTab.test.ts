import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { UserRole, RolesConfig } from "../roles.js";
import type { RepositoryConfig } from "../config.js";
import type { InstructionFileListing } from "../configurationFiles.js";
import type { ActiveWorker } from "../changes/activeState.js";
import type { PluginInfo } from "../plugins.js";
import type { MigrationError } from "../migrations/types.js";
import type { KnownBlock } from "@slack/types";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockGetRole = mock.fn<(userId: string) => Promise<UserRole>>();
const mockHasOwner = mock.fn<() => Promise<boolean>>();
const mockLoadRoles = mock.fn<() => Promise<RolesConfig>>();

const mockCanEditConfig = mock.fn<(role: UserRole) => boolean>();
const mockCanManageRoles = mock.fn<(role: UserRole) => boolean>();
const mockCanRequestChanges = mock.fn<(role: UserRole) => boolean>();

const mockGetConfig = mock.fn<() => Record<string, unknown>>();
const mockGetConfiguredMcpServerNames = mock.fn<() => string[]>();
const mockGetActiveWorkers = mock.fn<() => ActiveWorker[]>();
const mockListInstructionFiles = mock.fn<() => InstructionFileListing>();
const mockGetReactionDelivery = mock.fn<(userId: string) => Promise<string>>();
const mockGetUserPreference = mock.fn<(userId: string, key: string) => Promise<boolean>>();
const mockGetVisibleRepos = mock.fn<(role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[]>();
const mockCanWriteRepo = mock.fn<(role: UserRole, repo: RepositoryConfig) => boolean>();
const mockGetMigrationErrors = mock.fn<() => MigrationError[]>();
const mockDiscoverPluginInfo = mock.fn<() => PluginInfo[]>();

mock.module("../roles.js", {
  namedExports: {
    getRole: mockGetRole,
    hasOwner: mockHasOwner,
    loadRoles: mockLoadRoles,
  },
});

mock.module("../permissions.js", {
  namedExports: {
    canEditConfig: mockCanEditConfig,
    canManageRoles: mockCanManageRoles,
    canRequestChanges: mockCanRequestChanges,
  },
});

mock.module("../config.js", {
  namedExports: { getConfig: mockGetConfig },
});

mock.module("../mcp.js", {
  namedExports: { getConfiguredMcpServerNames: mockGetConfiguredMcpServerNames },
});

mock.module("../changes/activeState.js", {
  namedExports: {
    getActiveWorkers: mockGetActiveWorkers,
    getActiveChange: mock.fn(() => undefined),
    clearActiveChange: mock.fn(() => {}),
  },
});

mock.module("../configurationFiles.js", {
  namedExports: { listInstructionFiles: mockListInstructionFiles },
});

mock.module("../userPreferences.js", {
  namedExports: {
    getReactionDelivery: mockGetReactionDelivery,
    getUserPreference: mockGetUserPreference,
  },
});

mock.module("../repoAccess.js", {
  namedExports: {
    getVisibleRepos: mockGetVisibleRepos,
    canWriteRepo: mockCanWriteRepo,
  },
});

mock.module("../migrations/admin.js", {
  namedExports: { getMigrationErrors: mockGetMigrationErrors },
});

mock.module("../plugins.js", {
  namedExports: { discoverPluginInfo: mockDiscoverPluginInfo },
});

mock.module("../cronJobs.js", {
  namedExports: {
    getJobs: mock.fn(async () => []),
    getJobsByUser: mock.fn(async () => []),
  },
});

mock.module("../cronScheduler.js", {
  namedExports: {
    humanReadableSchedule: mock.fn(() => "Every day at 9:00 AM"),
  },
});

// Import after mocks
const {
  buildHomeView,
  buildRoleManagementSection,
  buildConfigurationSection,
  buildStatusSection,
  buildActiveWorkersSection,
  buildHelpSection,
  buildSettingsModal,
  buildUserSelectModal,
  buildRemoveUserModal,
  buildConfigFilePickerModal,
  buildConfigEditorModal,
  buildConfigCreateFileModal,
} = await import("./homeTab.js");

// ============================================================================
// Helpers
// ============================================================================

/** Extract text from section blocks (blocks are typed as KnownBlock which is a union). */
function getSectionTexts(blocks: KnownBlock[]): string[] {
  return blocks
    .filter((b): b is KnownBlock & { type: "section"; text: { text: string } } => b.type === "section")
    .map((b) => (b.text as { text: string })?.text ?? "");
}

/** Extract header texts from blocks. */
function getHeaderTexts(blocks: KnownBlock[]): string[] {
  return blocks
    .filter((b): b is KnownBlock & { type: "header"; text: { text: string } } => b.type === "header")
    .map((b) => (b.text as { text: string })?.text ?? "");
}

function defaultConfig() {
  return {
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: [
      { name: "my-repo", url: "https://github.com/test/my-repo", description: "Test repo" },
    ],
  };
}

function resetAllMocks() {
  mockGetRole.mock.resetCalls();
  mockHasOwner.mock.resetCalls();
  mockLoadRoles.mock.resetCalls();
  mockCanEditConfig.mock.resetCalls();
  mockCanManageRoles.mock.resetCalls();
  mockCanRequestChanges.mock.resetCalls();
  mockGetConfig.mock.resetCalls();
  mockGetConfiguredMcpServerNames.mock.resetCalls();
  mockGetActiveWorkers.mock.resetCalls();
  mockListInstructionFiles.mock.resetCalls();
  mockGetReactionDelivery.mock.resetCalls();
  mockGetUserPreference.mock.resetCalls();
  mockGetVisibleRepos.mock.resetCalls();
  mockCanWriteRepo.mock.resetCalls();
  mockGetMigrationErrors.mock.resetCalls();
  mockDiscoverPluginInfo.mock.resetCalls();
}

function setDefaultMocks(role: UserRole = "member") {
  mockGetRole.mock.mockImplementation(async () => role);
  mockHasOwner.mock.mockImplementation(async () => true);
  mockLoadRoles.mock.mockImplementation(async () => ({
    owner: "U_OWNER",
    admins: [],
    devs: [],
  }));
  mockCanEditConfig.mock.mockImplementation(() => role === "admin" || role === "owner");
  mockCanManageRoles.mock.mockImplementation(() => role === "admin" || role === "owner");
  mockCanRequestChanges.mock.mockImplementation(() => role === "dev" || role === "admin" || role === "owner");
  mockGetConfig.mock.mockImplementation(() => defaultConfig());
  mockGetConfiguredMcpServerNames.mock.mockImplementation(() => []);
  mockGetActiveWorkers.mock.mockImplementation(() => []);
  mockListInstructionFiles.mock.mockImplementation(() => ({ roles: [], repos: [] }));
  mockGetVisibleRepos.mock.mockImplementation((_role, repos) => repos);
  mockCanWriteRepo.mock.mockImplementation(() => false);
  mockGetMigrationErrors.mock.mockImplementation(() => []);
  mockDiscoverPluginInfo.mock.mockImplementation(() => []);
}

beforeEach(() => {
  resetAllMocks();
});

// ============================================================================
// buildHomeView
// ============================================================================

describe("buildHomeView", () => {
  it("returns a view of type home", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    assert.equal(view.type, "home");
    assert.ok(Array.isArray(view.blocks));
  });

  it("does not include role badge for members", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const roleBadge = texts.find((t) => t.includes("Your Role:"));
    assert.equal(roleBadge, undefined);
  });

  it("includes role badge for non-member roles", async () => {
    setDefaultMocks("admin");
    const view = await buildHomeView({ userId: "U001" });
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const roleBadge = texts.find((t) => t.includes("Your Role:"));
    assert.ok(roleBadge);
    assert.ok(roleBadge.includes("Admin"));
  });

  it("shows claim ownership section when no owner exists", async () => {
    setDefaultMocks("member");
    mockHasOwner.mock.mockImplementation(async () => false);
    const view = await buildHomeView({ userId: "U001" });
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const claimSection = texts.find((t) => t.includes("no owner yet"));
    assert.ok(claimSection);
  });

  it("shows claim ownership for admin when owner is disabled", async () => {
    setDefaultMocks("admin");
    const view = await buildHomeView({ userId: "U001", ownerDisabled: true });
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const claimSection = texts.find((t) => t.includes("inactive"));
    assert.ok(claimSection);
  });

  it("does not show claim ownership for member when owner is disabled", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001", ownerDisabled: true });
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const claimSection = texts.find((t) => t.includes("inactive"));
    assert.equal(claimSection, undefined);
  });

  it("includes role management section for admins", async () => {
    setDefaultMocks("admin");
    const view = await buildHomeView({ userId: "U001" });
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Role Management"));
  });

  it("does not include role management section for members", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(!headers.includes("Role Management"));
  });

  it("includes configuration section for admins", async () => {
    setDefaultMocks("admin");
    const view = await buildHomeView({ userId: "U001" });
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Configuration"));
  });

  it("shows configuration section for members with only Personal Preferences", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Configuration"));
    // Members should not have any view_config_dir buttons
    const actionsBlocks = (view.blocks as KnownBlock[]).filter((b) => b.type === "actions");
    const configButtons = actionsBlocks.flatMap((b) => {
      const elements = (b as unknown as { elements: Array<{ action_id: string }> }).elements;
      return elements.filter((e) => e.action_id?.startsWith("view_config_dir:"));
    });
    assert.equal(configButtons.length, 0);
  });

  it("includes active workers section for devs", async () => {
    setDefaultMocks("dev");
    const view = await buildHomeView({ userId: "U001" });
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Active Workers"));
  });

  it("does not include active workers section for members", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(!headers.includes("Active Workers"));
  });

  it("always includes status and help sections", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Status"));
    assert.ok(headers.includes("Help"));
  });

  it("always includes personal preferences button", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    const actionsBlocks = (view.blocks as KnownBlock[]).filter((b) => b.type === "actions");
    const hasPrefsButton = actionsBlocks.some((b) => {
      const elements = (b as unknown as { elements: Array<{ action_id: string }> }).elements;
      return elements.some((e) => e.action_id === "open_settings");
    });
    assert.ok(hasPrefsButton);
  });

  it("includes migration error banner when errors exist", async () => {
    setDefaultMocks("member");
    mockGetMigrationErrors.mock.mockImplementation(() => [
      { migrationName: "test-migration", version: 1, error: "something failed", timestamp: Date.now() },
    ]);
    const view = await buildHomeView({ userId: "U001" });
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const banner = texts.find((t) => t.includes("Migration Error"));
    assert.ok(banner);
    assert.ok(banner.includes("test-migration"));
  });

  it("adds admin guidance in migration banner for admin users", async () => {
    setDefaultMocks("admin");
    mockGetMigrationErrors.mock.mockImplementation(() => [
      { migrationName: "test-migration", version: 1, error: "something failed", timestamp: Date.now() },
    ]);
    const view = await buildHomeView({ userId: "U001" });
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const banner = texts.find((t) => t.includes("Migration Error"));
    assert.ok(banner);
    assert.ok(banner.includes("Check the logs"));
  });

  it("ends with spacer blocks to work around Slack rendering bug", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    const blocks = view.blocks as KnownBlock[];
    const lastFive = blocks.slice(-5);
    assert.equal(lastFive[0].type, "divider");
    for (let i = 1; i < 5; i++) {
      assert.equal(lastFive[i].type, "context");
    }
  });
});

// ============================================================================
// buildRoleManagementSection
// ============================================================================

describe("buildRoleManagementSection", () => {
  beforeEach(() => {
    setDefaultMocks("owner");
  });

  it("starts with a Role Management header", async () => {
    const blocks = await buildRoleManagementSection("U_OWNER", "owner");
    assert.equal(blocks[0].type, "header");
    assert.equal((blocks[0] as unknown as { text: { text: string } }).text.text, "Role Management");
  });

  it("shows owner with transfer button when user is owner", async () => {
    const blocks = await buildRoleManagementSection("U_OWNER", "owner");
    const ownerSection = blocks.find(
      (b) => b.type === "section" && ((b as unknown as { text: { text: string } }).text?.text ?? "").includes("Owner:")
    );
    assert.ok(ownerSection);
    const accessory = (ownerSection as unknown as { accessory?: { action_id: string } }).accessory;
    assert.ok(accessory);
    assert.equal(accessory!.action_id, "transfer_ownership");
  });

  it("shows owner without transfer button for non-owner admin", async () => {
    const blocks = await buildRoleManagementSection("U_ADMIN", "admin");
    const ownerSection = blocks.find(
      (b) => b.type === "section" && ((b as unknown as { text: { text: string } }).text?.text ?? "").includes("Owner:")
    );
    assert.ok(ownerSection);
    const accessory = (ownerSection as unknown as { accessory?: unknown }).accessory;
    assert.equal(accessory, undefined);
  });

  it("shows admins list with add button", async () => {
    const blocks = await buildRoleManagementSection("U_OWNER", "owner");
    const adminSection = blocks.find(
      (b) => b.type === "section" && ((b as unknown as { text: { text: string } }).text?.text ?? "").includes("Admins:")
    );
    assert.ok(adminSection);
    const adminActions = blocks.find(
      (b) => b.type === "actions" && ((b as unknown as { elements: Array<{ action_id: string }> }).elements ?? []).some((e) => e.action_id === "add_admin")
    );
    assert.ok(adminActions);
  });

  it("shows remove admin button when admins exist", async () => {
    mockLoadRoles.mock.mockImplementation(async () => ({
      owner: "U_OWNER",
      admins: ["U_ADMIN1"],
      devs: [],
    }));
    const blocks = await buildRoleManagementSection("U_OWNER", "owner");
    const adminActions = blocks.find(
      (b) => b.type === "actions" && ((b as unknown as { elements: Array<{ action_id: string }> }).elements ?? []).some((e) => e.action_id === "remove_admin")
    );
    assert.ok(adminActions);
  });

  it("does not show remove admin button when no admins", async () => {
    const blocks = await buildRoleManagementSection("U_OWNER", "owner");
    const allActionElements = blocks
      .filter((b) => b.type === "actions")
      .flatMap((b) => (b as unknown as { elements: Array<{ action_id: string }> }).elements);
    const removeAdmin = allActionElements.find((e) => e.action_id === "remove_admin");
    assert.equal(removeAdmin, undefined);
  });

  it("shows devs list with add button", async () => {
    const blocks = await buildRoleManagementSection("U_OWNER", "owner");
    const devSection = blocks.find(
      (b) => b.type === "section" && ((b as unknown as { text: { text: string } }).text?.text ?? "").includes("Devs:")
    );
    assert.ok(devSection);
    const devActions = blocks.find(
      (b) => b.type === "actions" && ((b as unknown as { elements: Array<{ action_id: string }> }).elements ?? []).some((e) => e.action_id === "add_dev")
    );
    assert.ok(devActions);
  });

  it("shows remove dev button when devs exist", async () => {
    mockLoadRoles.mock.mockImplementation(async () => ({
      owner: "U_OWNER",
      admins: [],
      devs: ["U_DEV1"],
    }));
    const blocks = await buildRoleManagementSection("U_OWNER", "owner");
    const allActionElements = blocks
      .filter((b) => b.type === "actions")
      .flatMap((b) => (b as unknown as { elements: Array<{ action_id: string }> }).elements);
    const removeDev = allActionElements.find((e) => e.action_id === "remove_dev");
    assert.ok(removeDev);
  });

  it("ends with a divider", async () => {
    const blocks = await buildRoleManagementSection("U_OWNER", "owner");
    assert.equal(blocks[blocks.length - 1].type, "divider");
  });
});

// ============================================================================
// buildConfigurationSection
// ============================================================================

describe("buildConfigurationSection", () => {
  beforeEach(() => {
    setDefaultMocks("admin");
  });

  it("starts with a Configuration header", () => {
    const blocks = buildConfigurationSection(true);
    assert.equal(blocks[0].type, "header");
    assert.equal((blocks[0] as unknown as { text: { text: string } }).text.text, "Configuration");
  });

  it("renders directory buttons in a single actions row", () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [
        { role: "user", files: [
          { filename: "identity.md", source: "default" as const },
          { filename: "response-style.md", source: "customized" as const },
          { filename: "company.md", source: "custom-only" as const },
        ]},
        { role: "dev", files: [
          { filename: "changes.md", source: "default" as const },
        ]},
      ],
      repos: [],
    }));
    const blocks = buildConfigurationSection(true);
    const actionsBlocks = blocks.filter((b) => b.type === "actions");
    assert.equal(actionsBlocks.length, 1);

    const elements = (actionsBlocks[0] as unknown as { elements: Array<{ text: { text: string }; action_id: string; value: string }> }).elements;
    // 2 config buttons + 1 Personal Preferences button
    assert.equal(elements.length, 3);
    assert.equal(elements[0].text.text, ":bust_in_silhouette: Edit User Config");
    assert.equal(elements[0].action_id, "view_config_dir:user");
    assert.equal(elements[0].value, "user");
    assert.equal(elements[1].text.text, ":hammer_and_wrench: Edit Dev Config");
    assert.equal(elements[1].value, "dev");
    assert.equal(elements[2].action_id, "open_settings");
  });

  it("includes repo directory buttons alongside role buttons", () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [
        { role: "user", files: [{ filename: "identity.md", source: "default" as const }] },
      ],
      repos: [
        { filename: "my-repo/changes_instructions.md", hasOverride: false, hasDefault: true },
        { filename: "my-repo/worktree_setup_instructions.md", hasOverride: false, hasDefault: false },
      ],
    }));
    const blocks = buildConfigurationSection(true);
    const actionsBlocks = blocks.filter((b) => b.type === "actions");
    assert.equal(actionsBlocks.length, 1);

    const elements = (actionsBlocks[0] as unknown as { elements: Array<{ text: { text: string }; value: string }> }).elements;
    // 1 role button + 1 repo button + 1 Personal Preferences button
    assert.equal(elements.length, 3);
    assert.equal(elements[0].text.text, ":bust_in_silhouette: Edit User Config");
    assert.equal(elements[1].text.text, ":file_folder: Edit my-repo Config");
    assert.equal(elements[1].value, "my-repo");
  });

  it("shows chat hint at the end", () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({ roles: [], repos: [] }));
    const blocks = buildConfigurationSection(true);
    const contextBlocks = blocks.filter((b) => b.type === "context");
    assert.ok(contextBlocks.length > 0);
    const contextText = ((contextBlocks[0] as unknown as { elements: Array<{ text: string }> }).elements)[0].text;
    assert.ok(contextText.includes("advanced configuration"));
  });

  it("ends with a divider", () => {
    const blocks = buildConfigurationSection(true);
    assert.equal(blocks[blocks.length - 1].type, "divider");
  });

  it("shows only Personal Preferences when showEditButtons is false", () => {
    const blocks = buildConfigurationSection(false);
    const actionsBlocks = blocks.filter((b) => b.type === "actions");
    assert.equal(actionsBlocks.length, 1);

    const elements = (actionsBlocks[0] as unknown as { elements: Array<{ text: { text: string }; action_id: string }> }).elements;
    assert.equal(elements.length, 1);
    assert.equal(elements[0].action_id, "open_settings");
  });

  it("hides chat hint when showEditButtons is false", () => {
    const blocks = buildConfigurationSection(false);
    const contextBlocks = blocks.filter((b) => b.type === "context");
    assert.equal(contextBlocks.length, 0);
  });
});

// ============================================================================
// buildStatusSection
// ============================================================================

describe("buildStatusSection", () => {
  beforeEach(() => {
    setDefaultMocks("member");
  });

  it("starts with a Status header", () => {
    const blocks = buildStatusSection("member");
    assert.equal(blocks[0].type, "header");
    assert.equal((blocks[0] as unknown as { text: { text: string } }).text.text, "Status");
  });

  it("lists repositories", () => {
    mockGetVisibleRepos.mock.mockImplementation(() => [
      { name: "my-repo", url: "https://github.com/test/my-repo", description: "Test repo" },
    ]);
    const blocks = buildStatusSection("member");
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
  });

  it("shows access tags for dev+ roles", () => {
    mockCanRequestChanges.mock.mockImplementation(() => true);
    mockGetVisibleRepos.mock.mockImplementation(() => [
      { name: "my-repo", url: "u", description: "d", access: { read: "member" as UserRole } },
    ]);
    mockCanWriteRepo.mock.mockImplementation(() => false);
    const blocks = buildStatusSection("dev");
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
    assert.ok(repoBlock.includes("read: all"));
    assert.ok(repoBlock.includes("read-only"));
  });

  it("shows write tags for writable repos", () => {
    mockCanRequestChanges.mock.mockImplementation(() => true);
    mockGetVisibleRepos.mock.mockImplementation(() => [
      { name: "my-repo", url: "u", description: "d", access: { read: "member" as UserRole, write: "dev" as UserRole } },
    ]);
    mockCanWriteRepo.mock.mockImplementation(() => true);
    const blocks = buildStatusSection("dev");
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
    assert.ok(repoBlock.includes("write: dev+"));
  });

  it("does not show access tags for members", () => {
    mockCanRequestChanges.mock.mockImplementation(() => false);
    mockGetVisibleRepos.mock.mockImplementation(() => [
      { name: "my-repo", url: "u", description: "d", access: { read: "member" as UserRole } },
    ]);
    const blocks = buildStatusSection("member");
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
    assert.ok(!repoBlock.includes("read:"));
  });

  it("shows MCP servers when configured", () => {
    mockGetConfiguredMcpServerNames.mock.mockImplementation(() => ["filesystem", "github"]);
    const blocks = buildStatusSection("member");
    const texts = getSectionTexts(blocks);
    const mcpBlock = texts.find((t) => t.includes("MCP Servers"));
    assert.ok(mcpBlock);
    assert.ok(mcpBlock.includes("filesystem"));
    assert.ok(mcpBlock.includes("github"));
  });

  it("does not show MCP servers section when none configured", () => {
    mockGetConfiguredMcpServerNames.mock.mockImplementation(() => []);
    const blocks = buildStatusSection("member");
    const texts = getSectionTexts(blocks);
    const mcpBlock = texts.find((t) => t.includes("MCP Servers"));
    assert.equal(mcpBlock, undefined);
  });

  it("shows plugins when discovered", () => {
    mockDiscoverPluginInfo.mock.mockImplementation(() => [
      { name: "my-plugin", path: "/some/path", skillCount: 3 },
    ]);
    const blocks = buildStatusSection("member");
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes("Plugins"));
    assert.ok(pluginBlock);
    assert.ok(pluginBlock.includes("my-plugin"));
    assert.ok(pluginBlock.includes("3 skills"));
  });

  it("does not show plugins section when none found", () => {
    mockDiscoverPluginInfo.mock.mockImplementation(() => []);
    const blocks = buildStatusSection("member");
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes("Plugins"));
    assert.equal(pluginBlock, undefined);
  });

  it("always shows reaction trigger method", () => {
    const blocks = buildStatusSection("member");
    const texts = getSectionTexts(blocks);
    const triggerBlock = texts.find((t) => t.includes("Trigger Methods"));
    assert.ok(triggerBlock);
    assert.ok(triggerBlock.includes("Reaction"));
  });

  it("shows DM trigger when enabled", () => {
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      directMessages: { enabled: true },
    }));
    const blocks = buildStatusSection("member");
    const texts = getSectionTexts(blocks);
    const triggerBlock = texts.find((t) => t.includes("Trigger Methods"));
    assert.ok(triggerBlock);
    assert.ok(triggerBlock.includes("Direct Messages"));
  });

  it("shows mentions trigger when enabled", () => {
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      mentions: { enabled: true },
    }));
    const blocks = buildStatusSection("member");
    const texts = getSectionTexts(blocks);
    const triggerBlock = texts.find((t) => t.includes("Trigger Methods"));
    assert.ok(triggerBlock);
    assert.ok(triggerBlock.includes("@Mentions"));
  });

  it("ends with a divider", () => {
    const blocks = buildStatusSection("member");
    assert.equal(blocks[blocks.length - 1].type, "divider");
  });
});

// ============================================================================
// buildActiveWorkersSection
// ============================================================================

describe("buildActiveWorkersSection", () => {
  beforeEach(() => {
    setDefaultMocks("dev");
  });

  it("starts with Active Workers header", () => {
    const blocks = buildActiveWorkersSection();
    assert.equal(blocks[0].type, "header");
    assert.equal((blocks[0] as unknown as { text: { text: string } }).text.text, "Active Workers");
  });

  it("shows empty state when no workers", () => {
    mockGetActiveWorkers.mock.mockImplementation(() => []);
    const blocks = buildActiveWorkersSection();
    const texts = getSectionTexts(blocks);
    assert.ok(texts.some((t) => t.includes("No active change requests")));
  });

  it("displays worker details when workers exist", () => {
    mockGetActiveWorkers.mock.mockImplementation(() => [
      {
        id: "w1",
        userId: "U001",
        status: "executing" as const,
        description: "Fix the bug",
        branch: "fix/bug-123",
        repo: "my-repo",
        channel: "C123",
        threadTs: "1700000000.000001",
        startedAt: new Date(),
      },
    ]);
    const blocks = buildActiveWorkersSection();
    const texts = getSectionTexts(blocks);
    const workerBlock = texts.find((t) => t.includes("Fix the bug"));
    assert.ok(workerBlock);
    assert.ok(workerBlock.includes("fix/bug-123"));
    assert.ok(workerBlock.includes("my-repo"));
    assert.ok(workerBlock.includes("Executing"));
  });

  it("includes PR link when available", () => {
    mockGetActiveWorkers.mock.mockImplementation(() => [
      {
        id: "w1",
        userId: "U001",
        status: "reviewing" as const,
        description: "Add feature",
        branch: "feat/thing",
        repo: "my-repo",
        prUrl: "https://github.com/org/repo/pull/42",
        channel: "C123",
        threadTs: "1700000000.000001",
        startedAt: new Date(),
      },
    ]);
    const blocks = buildActiveWorkersSection();
    const texts = getSectionTexts(blocks);
    const workerBlock = texts.find((t) => t.includes("Add feature"));
    assert.ok(workerBlock);
    assert.ok(workerBlock.includes("View PR"));
  });

  it("ends with a divider", () => {
    const blocks = buildActiveWorkersSection();
    assert.equal(blocks[blocks.length - 1].type, "divider");
  });
});

// ============================================================================
// buildHelpSection
// ============================================================================

describe("buildHelpSection", () => {
  beforeEach(() => {
    setDefaultMocks("member");
  });

  it("starts with a Help header", () => {
    const blocks = buildHelpSection();
    assert.equal(blocks[0].type, "header");
    assert.equal((blocks[0] as unknown as { text: { text: string } }).text.text, "Help");
  });

  it("always includes reaction trigger instruction", () => {
    const blocks = buildHelpSection();
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("Reaction"));
    assert.ok(instructions);
  });

  it("includes DM instruction when enabled", () => {
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      directMessages: { enabled: true },
    }));
    const blocks = buildHelpSection();
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("Direct Message"));
    assert.ok(instructions);
  });

  it("includes mention instruction when enabled", () => {
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      mentions: { enabled: true },
    }));
    const blocks = buildHelpSection();
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("Mention"));
    assert.ok(instructions);
  });

  it("does not include DM instruction when disabled", () => {
    const blocks = buildHelpSection();
    const allText = getSectionTexts(blocks).join(" ");
    assert.ok(!allText.includes("Direct Message"));
  });
});

// ============================================================================
// buildSettingsModal
// ============================================================================

describe("buildSettingsModal", () => {
  beforeEach(() => {
    setDefaultMocks("member");
  });

  it("returns a modal view with correct callback_id", async () => {
    mockGetReactionDelivery.mock.mockImplementation(async () => "dm");
    mockGetUserPreference.mock.mockImplementation(async () => false);
    const view = await buildSettingsModal("U001");
    assert.equal(view.type, "modal");
    assert.equal(view.callback_id, "settings_modal");
  });

  it("has submit and close buttons", async () => {
    mockGetReactionDelivery.mock.mockImplementation(async () => "dm");
    mockGetUserPreference.mock.mockImplementation(async () => false);
    const view = await buildSettingsModal("U001");
    const modal = view as unknown as { submit: { text: string }; close: { text: string } };
    assert.equal(modal.submit.text, "Save");
    assert.equal(modal.close.text, "Cancel");
  });

  it("sets initial delivery option to dm when user prefers dm", async () => {
    mockGetReactionDelivery.mock.mockImplementation(async () => "dm");
    mockGetUserPreference.mock.mockImplementation(async () => false);
    const view = await buildSettingsModal("U001");
    const deliveryBlock = (view.blocks as unknown[]).find(
      (b) => (b as { block_id?: string }).block_id === "response_delivery_block"
    ) as { elements: Array<{ initial_option: { value: string } }> } | undefined;
    assert.ok(deliveryBlock);
    assert.equal(deliveryBlock!.elements[0].initial_option.value, "dm");
  });

  it("sets initial delivery option to thread when user prefers thread", async () => {
    mockGetReactionDelivery.mock.mockImplementation(async () => "thread");
    mockGetUserPreference.mock.mockImplementation(async () => false);
    const view = await buildSettingsModal("U001");
    const deliveryBlock = (view.blocks as unknown[]).find(
      (b) => (b as { block_id?: string }).block_id === "response_delivery_block"
    ) as { elements: Array<{ initial_option: { value: string } }> } | undefined;
    assert.ok(deliveryBlock);
    assert.equal(deliveryBlock!.elements[0].initial_option.value, "thread");
  });

  it("sets notification initial option based on preference", async () => {
    mockGetReactionDelivery.mock.mockImplementation(async () => "dm");
    mockGetUserPreference.mock.mockImplementation(async () => true);
    const view = await buildSettingsModal("U001");
    const notifyBlock = (view.blocks as unknown[]).find(
      (b) => (b as { block_id?: string }).block_id === "notify_on_response_block"
    ) as { elements: Array<{ initial_option: { value: string } }> } | undefined;
    assert.ok(notifyBlock);
    assert.equal(notifyBlock!.elements[0].initial_option.value, "true");
  });
});

// ============================================================================
// buildUserSelectModal
// ============================================================================

describe("buildUserSelectModal", () => {
  it("returns a modal view with the given callback_id", () => {
    const view = buildUserSelectModal("Add Admin", "add_admin_modal", "Select admin");
    assert.equal(view.type, "modal");
    assert.equal(view.callback_id, "add_admin_modal");
  });

  it("uses the title as modal title", () => {
    const view = buildUserSelectModal("Add Admin", "add_admin_modal", "Select admin");
    const modal = view as unknown as { title: { text: string } };
    assert.equal(modal.title.text, "Add Admin");
  });

  it("includes a users_select element with the placeholder", () => {
    const view = buildUserSelectModal("Add Admin", "add_admin_modal", "Select admin");
    const inputBlock = view.blocks[0] as unknown as { element: { type: string; placeholder: { text: string } } };
    assert.equal(inputBlock.element.type, "users_select");
    assert.equal(inputBlock.element.placeholder.text, "Select admin");
  });
});

// ============================================================================
// buildRemoveUserModal
// ============================================================================

describe("buildRemoveUserModal", () => {
  it("returns a modal view with the given callback_id", () => {
    const view = buildRemoveUserModal("Remove Admin", "remove_admin_modal", ["U001", "U002"]);
    assert.equal(view.type, "modal");
    assert.equal(view.callback_id, "remove_admin_modal");
  });

  it("uses the title as modal title", () => {
    const view = buildRemoveUserModal("Remove Admin", "remove_admin_modal", ["U001"]);
    const modal = view as unknown as { title: { text: string } };
    assert.equal(modal.title.text, "Remove Admin");
  });

  it("has Remove as submit button text", () => {
    const view = buildRemoveUserModal("Remove Admin", "remove_admin_modal", ["U001"]);
    const modal = view as unknown as { submit: { text: string } };
    assert.equal(modal.submit.text, "Remove");
  });

  it("creates static_select options from user list", () => {
    const view = buildRemoveUserModal("Remove Admin", "remove_admin_modal", ["U001", "U002"]);
    const inputBlock = (view.blocks as unknown[]).find(
      (b) => (b as { block_id?: string }).block_id === "user_select_block"
    ) as { element: { type: string; options: Array<{ value: string }> } } | undefined;
    assert.ok(inputBlock);
    assert.equal(inputBlock!.element.type, "static_select");
    assert.equal(inputBlock!.element.options.length, 2);
    assert.equal(inputBlock!.element.options[0].value, "U001");
    assert.equal(inputBlock!.element.options[1].value, "U002");
  });
});

// ============================================================================
// buildConfigFilePickerModal
// ============================================================================

describe("buildConfigFilePickerModal", () => {
  it("shows files with Edit buttons for editable files", () => {
    const files = [
      { filename: "identity.md", sourceLabel: "", effectiveLength: 500 },
      { filename: "behavior.md", sourceLabel: "Customized", effectiveLength: 800 },
    ];
    const view = buildConfigFilePickerModal("user", files, false);
    const sections = (view.blocks as KnownBlock[]).filter((b) => b.type === "section");

    assert.equal(sections.length, 2);
    const firstAccessory = (sections[0] as unknown as { accessory: { action_id: string; value: string } }).accessory;
    assert.equal(firstAccessory.action_id, "edit_config_file");
    assert.equal(firstAccessory.value, "user/identity.md");
  });

  it("shows source labels on files", () => {
    const files = [
      { filename: "identity.md", sourceLabel: "Customized", effectiveLength: 100 },
      { filename: "custom.md", sourceLabel: "Custom", effectiveLength: 100 },
    ];
    const view = buildConfigFilePickerModal("user", files, false);
    const texts = getSectionTexts(view.blocks as KnownBlock[]);

    assert.ok(texts.some((t) => t.includes("Customized")));
    assert.ok(texts.some((t) => t.includes("Custom")));
  });

  it("shows 'Chat to Edit' button for oversized files instead of Edit button", () => {
    const files = [
      { filename: "large-file.md", sourceLabel: "", effectiveLength: 3500 },
    ];
    const view = buildConfigFilePickerModal("user", files, false);
    const sections = (view.blocks as KnownBlock[]).filter((b) => b.type === "section");
    const text = (sections[0] as unknown as { text: { text: string } }).text.text;

    assert.ok(text.includes("Too large for modal editor"));
    const accessory = (sections[0] as unknown as { accessory: { action_id: string; value: string; text: { text: string } } }).accessory;
    assert.equal(accessory.action_id, "chat_edit_config_file");
    assert.equal(accessory.value, "user/large-file.md");
    assert.equal(accessory.text.text, "Chat to Edit");
  });

  it("shows Create New File button for role directories", () => {
    const view = buildConfigFilePickerModal("user", [], false);
    const actions = (view.blocks as KnownBlock[]).filter((b) => b.type === "actions");
    assert.equal(actions.length, 1);
    const elements = (actions[0] as unknown as { elements: Array<{ action_id: string }> }).elements;
    assert.equal(elements[0].action_id, "create_config_file");
  });

  it("does not show Create New File button for repo directories", () => {
    const view = buildConfigFilePickerModal("my-repo", [], true);
    const actions = (view.blocks as KnownBlock[]).filter((b) => b.type === "actions");
    assert.equal(actions.length, 0);
  });

  it("truncates long modal titles", () => {
    const view = buildConfigFilePickerModal("very-long-directory-name", [], false);
    const title = (view as unknown as { title: { text: string } }).title.text;
    assert.ok(title.length <= 24);
    assert.ok(title.endsWith("\u2026"));
  });
});

// ============================================================================
// buildConfigEditorModal
// ============================================================================

describe("buildConfigEditorModal", () => {
  it("shows 'Create Override' submit for default-only files", () => {
    const view = buildConfigEditorModal("user", "identity.md", "default content", "default-only");
    const submit = (view as unknown as { submit: { text: string } }).submit;
    assert.equal(submit.text, "Create Override");
  });

  it("shows 'Save' submit for files with existing override", () => {
    const view = buildConfigEditorModal("user", "identity.md", "custom content", "has-override");
    const submit = (view as unknown as { submit: { text: string } }).submit;
    assert.equal(submit.text, "Save");
  });

  it("shows 'Save' submit for custom-only files", () => {
    const view = buildConfigEditorModal("user", "custom.md", "custom content", "custom-only");
    const submit = (view as unknown as { submit: { text: string } }).submit;
    assert.equal(submit.text, "Save");
  });

  it("includes default status context for default-only files", () => {
    const view = buildConfigEditorModal("user", "identity.md", "content", "default-only");
    const contextBlocks = (view.blocks as KnownBlock[]).filter((b) => b.type === "context");
    assert.ok(contextBlocks.length > 0);
    const text = ((contextBlocks[0] as unknown as { elements: Array<{ text: string }> }).elements)[0].text;
    assert.ok(text.includes("no custom override"));
  });

  it("shows Reset to Default button for files with overrides", () => {
    const view = buildConfigEditorModal("user", "identity.md", "custom", "has-override");
    const actions = (view.blocks as KnownBlock[]).filter((b) => b.type === "actions");
    assert.equal(actions.length, 1);
    const elements = (actions[0] as unknown as { elements: Array<{ text: { text: string }; action_id: string }> }).elements;
    assert.ok(elements.some((e) => e.text.text === "Reset to Default"));
  });

  it("shows Delete File button for custom-only files", () => {
    const view = buildConfigEditorModal("user", "custom.md", "custom", "custom-only");
    const actions = (view.blocks as KnownBlock[]).filter((b) => b.type === "actions");
    assert.equal(actions.length, 1);
    const elements = (actions[0] as unknown as { elements: Array<{ text: { text: string }; action_id: string }> }).elements;
    assert.ok(elements.some((e) => e.text.text === "Delete File"));
  });

  it("does not show delete button for default-only files", () => {
    const view = buildConfigEditorModal("user", "identity.md", "content", "default-only");
    const actions = (view.blocks as KnownBlock[]).filter((b) => b.type === "actions");
    assert.equal(actions.length, 1);
    const elements = (actions[0] as unknown as { elements: Array<{ action_id: string }> }).elements;
    // Only "Chat to Edit", no delete/reset
    assert.equal(elements.length, 1);
    assert.equal(elements[0].action_id, "chat_edit_config_file");
  });

  it("always shows Chat to Edit button", () => {
    for (const state of ["default-only", "has-override", "custom-only"] as const) {
      const view = buildConfigEditorModal("user", "test.md", "content", state);
      const actions = (view.blocks as KnownBlock[]).filter((b) => b.type === "actions");
      const elements = (actions[0] as unknown as { elements: Array<{ action_id: string }> }).elements;
      assert.ok(elements.some((e) => e.action_id === "chat_edit_config_file"), `should have Chat to Edit for ${state}`);
    }
  });

  it("stores file state in private_metadata", () => {
    const view = buildConfigEditorModal("user", "identity.md", "content", "has-override");
    const metadata = JSON.parse(view.private_metadata!);
    assert.equal(metadata.dir, "user");
    assert.equal(metadata.filename, "identity.md");
    assert.equal(metadata.hasDefault, true);
    assert.equal(metadata.hasOverride, true);
  });

  it("truncates long title to 24 chars", () => {
    const view = buildConfigEditorModal("user", "very-long-filename-that-exceeds.md", "content", "default-only");
    const title = (view as unknown as { title: { text: string } }).title.text;
    assert.ok(title.length <= 24);
    assert.ok(title.endsWith("\u2026"));
  });

  it("uses full title when short enough", () => {
    const view = buildConfigEditorModal("user", "short.md", "content", "default-only");
    const title = (view as unknown as { title: { text: string } }).title.text;
    assert.equal(title, "user/short.md");
  });
});

// ============================================================================
// buildConfigCreateFileModal
// ============================================================================

describe("buildConfigCreateFileModal", () => {
  it("returns a modal with Create submit button", () => {
    const view = buildConfigCreateFileModal("user");
    assert.equal(view.type, "modal");
    const submit = (view as unknown as { submit: { text: string } }).submit;
    assert.equal(submit.text, "Create");
  });

  it("stores dir in private_metadata", () => {
    const view = buildConfigCreateFileModal("dev");
    const metadata = JSON.parse(view.private_metadata!);
    assert.equal(metadata.dir, "dev");
  });

  it("has filename and content input blocks", () => {
    const view = buildConfigCreateFileModal("user");
    const blocks = view.blocks as KnownBlock[];
    const filenameBlock = blocks.find(
      (b) => (b as unknown as { block_id?: string }).block_id === "filename_block"
    );
    const contentBlock = blocks.find(
      (b) => (b as unknown as { block_id?: string }).block_id === "content_block"
    );
    assert.ok(filenameBlock);
    assert.ok(contentBlock);
  });

  it("shows .md hint on filename field", () => {
    const view = buildConfigCreateFileModal("user");
    const blocks = view.blocks as KnownBlock[];
    const filenameBlock = blocks.find(
      (b) => (b as unknown as { block_id?: string }).block_id === "filename_block"
    ) as unknown as { hint?: { text: string } } | undefined;
    assert.ok(filenameBlock?.hint?.text.includes(".md"));
  });
});
