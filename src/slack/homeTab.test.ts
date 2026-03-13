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
  namedExports: { getActiveWorkers: mockGetActiveWorkers },
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

  it("does not include configuration section for members", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(!headers.includes("Configuration"));
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

  it("always includes settings, status, and help sections", async () => {
    setDefaultMocks("member");
    const view = await buildHomeView({ userId: "U001" });
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Settings"));
    assert.ok(headers.includes("Status"));
    assert.ok(headers.includes("Help"));
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
    const blocks = buildConfigurationSection();
    assert.equal(blocks[0].type, "header");
    assert.equal((blocks[0] as unknown as { text: { text: string } }).text.text, "Configuration");
  });

  it("renders role directories with file hierarchy", () => {
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
      repos: [
        { filename: "repo/changes_instructions.md", hasOverride: false, hasDefault: false },
      ],
    }));
    const blocks = buildConfigurationSection();
    const texts = getSectionTexts(blocks);

    // user/ directory should list files with appropriate markers
    const userBlock = texts.find((t) => t.includes("user/"));
    assert.ok(userBlock, "should have a user/ block");
    assert.ok(userBlock.includes("identity.md"), "should list identity.md");
    assert.ok(userBlock.includes("response-style.md"), "should list response-style.md");
    assert.ok(userBlock.includes("Customized"), "should mark customized file");
    assert.ok(userBlock.includes("company.md"), "should list custom-only file");
    assert.ok(userBlock.includes("Custom"), "should mark custom-only file");

    // dev/ directory
    const devBlock = texts.find((t) => t.includes("dev/"));
    assert.ok(devBlock, "should have a dev/ block");
    assert.ok(devBlock.includes("changes.md"), "should list changes.md");

    // Repo files
    assert.ok(texts.some((t) => t.includes("changes_instructions.md") && t.includes("Not created")));
  });

  it("shows instruction context at the end", () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({ roles: [], repos: [] }));
    const blocks = buildConfigurationSection();
    const contextBlocks = blocks.filter((b) => b.type === "context");
    assert.ok(contextBlocks.length > 0);
    const contextText = ((contextBlocks[0] as unknown as { elements: Array<{ text: string }> }).elements)[0].text;
    assert.ok(contextText.includes("Chat with Clack"));
  });

  it("ends with a divider", () => {
    const blocks = buildConfigurationSection();
    assert.equal(blocks[blocks.length - 1].type, "divider");
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
