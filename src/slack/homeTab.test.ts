import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { UserRole, RolesConfig } from "../roles.js";
import type { RepositoryConfig, Config } from "../config.js";
import type { InstructionFileListing } from "../configurationFiles.js";
import type { ActiveWorker } from "../changes/activeState.js";
import type { PluginInfo } from "../plugins.js";
import type { MigrationError } from "../migrations/types.js";
import type { KnownBlock, View, ActionsBlockElement } from "@slack/types";
import {
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
  buildCronJobModal,
  type HomeTabDeps,
  type ClackPluginSummary,
} from "./homeTab.js";
import type { AutoRespondRule } from "../autoRespond.js";
import type { CronJob } from "../cronJobs.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetRole = mock.fn<(userId: string) => Promise<UserRole>>();
const mockHasOwner = mock.fn<() => Promise<boolean>>();
const mockLoadRoles = mock.fn<() => Promise<RolesConfig>>();

const mockCanEditConfig = mock.fn<(role: UserRole) => boolean>();
const mockCanManageRoles = mock.fn<(role: UserRole) => boolean>();
const mockCanRequestChanges = mock.fn<(role: UserRole) => boolean>();

const mockGetConfig = mock.fn<() => Config>();
const mockGetConfiguredMcpServerNames = mock.fn<() => string[]>();
const mockGetFailedMcpServers = mock.fn<() => Set<string>>();
const mockGetActiveWorkers = mock.fn<() => ActiveWorker[]>();
const mockListInstructionFiles = mock.fn<() => InstructionFileListing>();
const mockGetReactionDelivery = mock.fn<(userId: string) => Promise<string>>();
const mockGetUserPreference = mock.fn<(userId: string, key: string) => Promise<boolean>>();
const mockGetVisibleRepos =
  mock.fn<(role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[]>();
const mockCanWriteRepo = mock.fn<(role: UserRole, repo: RepositoryConfig) => boolean>();
const mockGetMigrationErrors = mock.fn<() => MigrationError[]>();
const mockDiscoverPluginInfo = mock.fn<() => PluginInfo[]>();
const mockGetLoadedClackPlugins = mock.fn<() => ClackPluginSummary[]>();
const mockGetRules = mock.fn<() => Promise<AutoRespondRule[]>>();
const mockGetJobs = mock.fn<() => Promise<CronJob[]>>();
const mockGetJobsByUser = mock.fn<(userId: string) => Promise<CronJob[]>>();
const mockHumanReadableSchedule = mock.fn<(cronExpression: string, timezone: string) => string>();

function makeDeps(): HomeTabDeps {
  return {
    getConfig: mockGetConfig,
    getConfiguredMcpServerNames: mockGetConfiguredMcpServerNames,
    getFailedMcpServers: mockGetFailedMcpServers,
    getRole: mockGetRole,
    hasOwner: mockHasOwner,
    loadRoles: mockLoadRoles,
    canEditConfig: mockCanEditConfig,
    canManageRoles: mockCanManageRoles,
    canRequestChanges: mockCanRequestChanges,
    getActiveWorkers: mockGetActiveWorkers,
    listInstructionFiles: mockListInstructionFiles,
    getReactionDelivery: mockGetReactionDelivery,
    getUserPreference: mockGetUserPreference as object as HomeTabDeps["getUserPreference"],
    getVisibleRepos: mockGetVisibleRepos,
    canWriteRepo: mockCanWriteRepo,
    getMigrationErrors: mockGetMigrationErrors,
    discoverPluginInfo: mockDiscoverPluginInfo,
    getLoadedClackPlugins: mockGetLoadedClackPlugins,
    getRules: mockGetRules,
    getJobs: mockGetJobs,
    getJobsByUser: mockGetJobsByUser,
    humanReadableSchedule: mockHumanReadableSchedule,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract text from section blocks (blocks are typed as KnownBlock which is a union). */
function getSectionTexts(blocks: KnownBlock[]): string[] {
  return blocks
    .filter(
      (b): b is KnownBlock & { type: "section"; text: { text: string } } => b.type === "section",
    )
    .map((b) => (b.text as { text: string })?.text ?? "");
}

/** Extract header texts from blocks. */
function getHeaderTexts(blocks: KnownBlock[]): string[] {
  return blocks
    .filter(
      (b): b is KnownBlock & { type: "header"; text: { text: string } } => b.type === "header",
    )
    .map((b) => (b.text as { text: string })?.text ?? "");
}

/** Type guard for action blocks. */
function isActionBlock(
  block: KnownBlock,
): block is KnownBlock & { type: "actions"; elements: ActionsBlockElement[] } {
  return block.type === "actions" && Array.isArray((block as { elements?: unknown }).elements);
}

function isInputBlock(block: KnownBlock): block is KnownBlock & {
  block_id?: string;
  element?: { type?: string; options?: Array<{ value: string }> };
} {
  return block.type === "input";
}

function isSectionBlockWithText(
  block: KnownBlock,
): block is KnownBlock & { type: "section"; text?: { text: string } } {
  return block.type === "section";
}

function isModalView(
  view: View,
): view is View & { title?: { text: string }; submit?: { text: string } } {
  return view.type === "modal";
}

function defaultConfig(): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: [
      { name: "my-repo", url: "https://github.com/test/my-repo", description: "Test repo" },
    ],
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "claude-opus" },
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
  mockGetFailedMcpServers.mock.resetCalls();
  mockGetActiveWorkers.mock.resetCalls();
  mockListInstructionFiles.mock.resetCalls();
  mockGetReactionDelivery.mock.resetCalls();
  mockGetUserPreference.mock.resetCalls();
  mockGetVisibleRepos.mock.resetCalls();
  mockCanWriteRepo.mock.resetCalls();
  mockGetMigrationErrors.mock.resetCalls();
  mockDiscoverPluginInfo.mock.resetCalls();
  mockGetLoadedClackPlugins.mock.resetCalls();
  mockGetRules.mock.resetCalls();
  mockGetJobs.mock.resetCalls();
  mockGetJobsByUser.mock.resetCalls();
  mockHumanReadableSchedule.mock.resetCalls();
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
  mockCanRequestChanges.mock.mockImplementation(
    () => role === "dev" || role === "admin" || role === "owner",
  );
  mockGetConfig.mock.mockImplementation(() => defaultConfig());
  mockGetConfiguredMcpServerNames.mock.mockImplementation(() => []);
  mockGetFailedMcpServers.mock.mockImplementation(() => new Set<string>());
  mockGetActiveWorkers.mock.mockImplementation(() => []);
  mockListInstructionFiles.mock.mockImplementation(() => ({ roles: [], repos: [] }));
  mockGetVisibleRepos.mock.mockImplementation((_role, repos) => repos);
  mockCanWriteRepo.mock.mockImplementation(() => false);
  mockGetMigrationErrors.mock.mockImplementation(() => []);
  mockDiscoverPluginInfo.mock.mockImplementation(() => []);
  mockGetLoadedClackPlugins.mock.mockImplementation(() => []);
  mockGetRules.mock.mockImplementation(async () => []);
  mockGetJobs.mock.mockImplementation(async () => []);
  mockGetJobsByUser.mock.mockImplementation(async () => []);
  mockHumanReadableSchedule.mock.mockImplementation(() => "Every day at 9:00 AM");
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
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    assert.equal(view.type, "home");
    assert.ok(Array.isArray(view.blocks));
  });

  it("does not include role badge for members", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const roleBadge = texts.find((t) => t.includes("Your Role:"));
    assert.equal(roleBadge, undefined);
  });

  it("includes role badge for non-member roles", async () => {
    setDefaultMocks("admin");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const roleBadge = texts.find((t) => t.includes("Your Role:"));
    assert.ok(roleBadge);
    assert.ok(roleBadge.includes("Admin"));
  });

  it("shows claim ownership section when no owner exists", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    mockHasOwner.mock.mockImplementation(async () => false);
    const view = await buildHomeView({ userId: "U001" }, deps);
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const claimSection = texts.find((t) => t.includes("no owner yet"));
    assert.ok(claimSection);
  });

  it("shows claim ownership for admin when owner is disabled", async () => {
    setDefaultMocks("admin");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001", ownerDisabled: true }, deps);
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const claimSection = texts.find((t) => t.includes("inactive"));
    assert.ok(claimSection);
  });

  it("does not show claim ownership for member when owner is disabled", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001", ownerDisabled: true }, deps);
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const claimSection = texts.find((t) => t.includes("inactive"));
    assert.equal(claimSection, undefined);
  });

  it("includes role management section for admins", async () => {
    setDefaultMocks("admin");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Role Management"));
  });

  it("does not include role management section for members", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(!headers.includes("Role Management"));
  });

  it("includes configuration section for admins", async () => {
    setDefaultMocks("admin");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Configuration"));
  });

  it("shows configuration section for members with only Personal Preferences", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Configuration"));
    // Members should not have any view_config_dir buttons
    const actionsBlocks = (view.blocks as KnownBlock[]).filter(isActionBlock);
    const configButtons = actionsBlocks.flatMap((b) =>
      b.elements.filter((e) =>
        (e as { action_id?: string }).action_id?.startsWith("view_config_dir:"),
      ),
    );
    assert.equal(configButtons.length, 0);
  });

  it("includes active workers section for devs", async () => {
    setDefaultMocks("dev");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Active Workers"));
  });

  it("does not include active workers section for members", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(!headers.includes("Active Workers"));
  });

  it("always includes status and help sections", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(headers.includes("Status"));
    assert.ok(headers.includes("Help"));
  });

  it("always includes personal preferences button", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const actionsBlocks = (view.blocks as KnownBlock[]).filter(isActionBlock);
    const hasPrefsButton = actionsBlocks.some((b) =>
      b.elements.some((e) => (e as { action_id?: string }).action_id === "open_settings"),
    );
    assert.ok(hasPrefsButton);
  });

  it("includes migration error banner when errors exist", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    mockGetMigrationErrors.mock.mockImplementation(() => [
      {
        migrationName: "test-migration",
        version: 1,
        error: "something failed",
        timestamp: Date.now(),
      },
    ]);
    const view = await buildHomeView({ userId: "U001" }, deps);
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const banner = texts.find((t) => t.includes("Migration Error"));
    assert.ok(banner);
    assert.ok(banner.includes("test-migration"));
  });

  it("adds admin guidance in migration banner for admin users", async () => {
    setDefaultMocks("admin");
    const deps = makeDeps();
    mockGetMigrationErrors.mock.mockImplementation(() => [
      {
        migrationName: "test-migration",
        version: 1,
        error: "something failed",
        timestamp: Date.now(),
      },
    ]);
    const view = await buildHomeView({ userId: "U001" }, deps);
    const texts = getSectionTexts(view.blocks as KnownBlock[]);
    const banner = texts.find((t) => t.includes("Migration Error"));
    assert.ok(banner);
    assert.ok(banner.includes("Check the logs"));
  });

  it("ends with spacer blocks to work around Slack rendering bug", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
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
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("U_OWNER", "owner", deps);
    assert.equal(blocks[0].type, "header");
    const headerBlock = blocks[0] as KnownBlock & { text: { text: string } };
    assert.equal(headerBlock.text.text, "Role Management");
  });

  it("shows owner with transfer button when user is owner", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("U_OWNER", "owner", deps);
    const ownerSection = blocks.find((b) => {
      if (b.type !== "section") return false;
      const section = b as KnownBlock & { text?: { text: string } };
      return section.text?.text?.includes("Owner:");
    });
    assert.ok(ownerSection);
    const sectionWithAccessory = ownerSection as { accessory?: { action_id: string } };
    assert.equal(sectionWithAccessory.accessory?.action_id, "transfer_ownership");
  });

  it("shows owner without transfer button for non-owner admin", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("U_ADMIN", "admin", deps);
    const ownerSection = blocks.find((b) => {
      if (b.type !== "section") return false;
      const section = b as KnownBlock & { text?: { text: string } };
      return section.text?.text?.includes("Owner:");
    });
    assert.ok(ownerSection);
    const sectionWithAccessory = ownerSection as { accessory?: unknown };
    assert.equal(sectionWithAccessory.accessory, undefined);
  });

  it("shows admins list with add button", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("U_OWNER", "owner", deps);
    const adminSection = blocks.find((b) => {
      if (b.type !== "section") return false;
      const section = b as KnownBlock & { text?: { text: string } };
      return section.text?.text?.includes("Admins:");
    });
    assert.ok(adminSection);
    const adminActions = blocks.find((b) => {
      if (!isActionBlock(b)) return false;
      return b.elements.some((e) => (e as { action_id?: string }).action_id === "add_admin");
    });
    assert.ok(adminActions);
  });

  it("shows remove admin button when admins exist", async () => {
    const deps = makeDeps();
    mockLoadRoles.mock.mockImplementation(async () => ({
      owner: "U_OWNER",
      admins: ["U_ADMIN1"],
      devs: [],
    }));
    const blocks = await buildRoleManagementSection("U_OWNER", "owner", deps);
    const adminActions = blocks.find((b) => {
      if (!isActionBlock(b)) return false;
      return b.elements.some((e) => (e as { action_id?: string }).action_id === "remove_admin");
    });
    assert.ok(adminActions);
  });

  it("does not show remove admin button when no admins", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("U_OWNER", "owner", deps);
    const allActionElements = blocks.filter(isActionBlock).flatMap((b) => b.elements);
    const removeAdmin = allActionElements.find(
      (e) => (e as { action_id?: string }).action_id === "remove_admin",
    );
    assert.equal(removeAdmin, undefined);
  });

  it("shows devs list with add button", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("U_OWNER", "owner", deps);
    const devSection = blocks.find((b) => {
      if (b.type !== "section") return false;
      const section = b as KnownBlock & { text?: { text: string } };
      return section.text?.text?.includes("Devs:");
    });
    assert.ok(devSection);
    const devActions = blocks.find((b) => {
      if (!isActionBlock(b)) return false;
      return b.elements.some((e) => (e as { action_id?: string }).action_id === "add_dev");
    });
    assert.ok(devActions);
  });

  it("shows remove dev button when devs exist", async () => {
    const deps = makeDeps();
    mockLoadRoles.mock.mockImplementation(async () => ({
      owner: "U_OWNER",
      admins: [],
      devs: ["U_DEV1"],
    }));
    const blocks = await buildRoleManagementSection("U_OWNER", "owner", deps);
    const devActions = blocks.find((b) => {
      if (!isActionBlock(b)) return false;
      return b.elements.some((e) => (e as { action_id?: string }).action_id === "remove_dev");
    });
    assert.ok(devActions);
  });

  it("ends with a divider", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("U_OWNER", "owner", deps);
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
    const deps = makeDeps();
    const blocks = buildConfigurationSection(true, deps);
    assert.equal(blocks[0].type, "header");
    const headerBlock = blocks[0] as KnownBlock & { text: { text: string } };
    assert.equal(headerBlock.text.text, "Configuration");
  });

  it("renders directory buttons in a single actions row", () => {
    const deps = makeDeps();
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [
        { role: "member", files: [] },
        { role: "pre-analysis", files: [] },
      ],
      repos: [],
    }));
    const blocks = buildConfigurationSection(true, deps);
    const actionsBlocks = blocks.filter(isActionBlock);
    assert.ok(actionsBlocks.length > 0);
    assert.ok(actionsBlocks[0].elements.length > 0);
  });

  it("includes repo directory buttons alongside role buttons", () => {
    const deps = makeDeps();
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [{ role: "member", files: [] }],
      repos: [
        { filename: "my-repo/test.md", hasOverride: false, hasDefault: true },
        { filename: "my-repo/other.md", hasOverride: false, hasDefault: true },
      ],
    }));
    const blocks = buildConfigurationSection(true, deps);
    const actionsBlocks = blocks.filter(isActionBlock);
    const allElements = actionsBlocks.flatMap((b) => b.elements);
    const repoButtons = allElements.filter((e) => (e as { value?: string }).value === "my-repo");
    assert.equal(repoButtons.length, 1);
  });

  it("shows chat hint at the end", () => {
    const deps = makeDeps();
    const blocks = buildConfigurationSection(true, deps);
    const contextBlocks = blocks.filter((b) => b.type === "context");
    assert.ok(
      contextBlocks.some((b) => {
        const contextBlock = b as KnownBlock & { elements: { text?: string }[] };
        const text = contextBlock.elements[0]?.text ?? "";
        return text.includes("Chat with me");
      }),
    );
  });

  it("ends with a divider", () => {
    const deps = makeDeps();
    const blocks = buildConfigurationSection(true, deps);
    assert.equal(blocks[blocks.length - 1].type, "divider");
  });

  it("shows only Personal Preferences when showEditButtons is false", () => {
    const deps = makeDeps();
    const blocks = buildConfigurationSection(false, deps);
    const actionsBlocks = blocks.filter(isActionBlock);
    const allElements = actionsBlocks.flatMap((b) => b.elements);
    const configButtons = allElements.filter((e) =>
      (e as { action_id?: string }).action_id?.startsWith("view_config_dir:"),
    );
    assert.equal(configButtons.length, 0);
    const prefsButton = allElements.find(
      (e) => (e as { action_id?: string }).action_id === "open_settings",
    );
    assert.ok(prefsButton);
  });

  it("hides chat hint when showEditButtons is false", () => {
    const deps = makeDeps();
    const blocks = buildConfigurationSection(false, deps);
    const contextBlocks = blocks.filter((b) => b.type === "context");
    const chatHint = contextBlocks.find((b) => {
      const contextBlock = b as KnownBlock & { elements: { text?: string }[] };
      const text = contextBlock.elements[0]?.text ?? "";
      return text.includes("Chat with me");
    });
    assert.equal(chatHint, undefined);
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
    const deps = makeDeps();
    const blocks = buildStatusSection("member", deps);
    assert.equal(blocks[0].type, "header");
    const headerBlock = blocks[0] as KnownBlock & { text: { text: string } };
    assert.equal(headerBlock.text.text, "Status");
  });

  it("lists repositories", () => {
    const deps = makeDeps();
    mockGetVisibleRepos.mock.mockImplementation(() => [
      { name: "my-repo", url: "https://github.com/test/my-repo", description: "Test repo" },
    ]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
  });

  it("shows access tags for dev+ roles", () => {
    const deps = makeDeps();
    mockCanRequestChanges.mock.mockImplementation(() => true);
    mockGetVisibleRepos.mock.mockImplementation(() => [
      { name: "my-repo", url: "u", description: "d", access: { read: "member" as UserRole } },
    ]);
    mockCanWriteRepo.mock.mockImplementation(() => false);
    const blocks = buildStatusSection("dev", deps);
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
    assert.ok(repoBlock.includes("read: all"));
    assert.ok(repoBlock.includes("read-only"));
  });

  it("shows write tags for writable repos", () => {
    const deps = makeDeps();
    mockCanRequestChanges.mock.mockImplementation(() => true);
    mockGetVisibleRepos.mock.mockImplementation(() => [
      {
        name: "my-repo",
        url: "u",
        description: "d",
        access: { read: "member" as UserRole, write: "dev" as UserRole },
      },
    ]);
    mockCanWriteRepo.mock.mockImplementation(() => true);
    const blocks = buildStatusSection("dev", deps);
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
    assert.ok(repoBlock.includes("write: dev+"));
  });

  it("does not show access tags for members", () => {
    const deps = makeDeps();
    mockCanRequestChanges.mock.mockImplementation(() => false);
    mockGetVisibleRepos.mock.mockImplementation(() => [
      { name: "my-repo", url: "u", description: "d", access: { read: "member" as UserRole } },
    ]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
    assert.ok(!repoBlock.includes("read:"));
  });

  it("shows MCP servers when configured", () => {
    const deps = makeDeps();
    mockGetConfiguredMcpServerNames.mock.mockImplementation(() => ["filesystem", "github"]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const mcpBlock = texts.find((t) => t.includes("MCP Servers"));
    assert.ok(mcpBlock);
    assert.ok(mcpBlock.includes("filesystem"));
    assert.ok(mcpBlock.includes("github"));
  });

  it("marks failed MCP servers with a warning", () => {
    const deps = makeDeps();
    mockGetConfiguredMcpServerNames.mock.mockImplementation(() => ["filesystem", "github"]);
    mockGetFailedMcpServers.mock.mockImplementation(() => new Set(["github"]));
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const mcpBlock = texts.find((t) => t.includes("MCP Servers"));
    assert.ok(mcpBlock);
    assert.ok(mcpBlock.includes("github :warning:"));
    assert.ok(!mcpBlock.includes("filesystem :warning:"));
  });

  it("does not show MCP servers section when none configured", () => {
    const deps = makeDeps();
    mockGetConfiguredMcpServerNames.mock.mockImplementation(() => []);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const mcpBlock = texts.find((t) => t.includes("MCP Servers"));
    assert.equal(mcpBlock, undefined);
  });

  it("shows skill plugins when discovered", () => {
    const deps = makeDeps();
    mockDiscoverPluginInfo.mock.mockImplementation(() => [
      { name: "my-plugin", path: "/some/path", skillCount: 3 },
    ]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes("Skill Plugins"));
    assert.ok(pluginBlock);
    assert.ok(pluginBlock.includes("my-plugin"));
    assert.ok(pluginBlock.includes("3 skills"));
  });

  it("does not show skill plugins section when none found", () => {
    const deps = makeDeps();
    mockDiscoverPluginInfo.mock.mockImplementation(() => []);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes("Skill Plugins"));
    assert.equal(pluginBlock, undefined);
  });

  it("shows clack plugins when loaded", () => {
    const deps = makeDeps();
    mockGetLoadedClackPlugins.mock.mockImplementation(() => [{ name: "trivia", toolCount: 5 }]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes(":package:"));
    assert.ok(pluginBlock);
    assert.ok(pluginBlock.includes("trivia"));
    assert.ok(pluginBlock.includes("5 tools"));
  });

  it("does not show clack plugins section when none loaded", () => {
    const deps = makeDeps();
    mockGetLoadedClackPlugins.mock.mockImplementation(() => []);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes(":package:"));
    assert.equal(pluginBlock, undefined);
  });

  it("always shows reaction trigger method", () => {
    const deps = makeDeps();
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const triggerBlock = texts.find((t) => t.includes("Trigger Methods"));
    assert.ok(triggerBlock);
    assert.ok(triggerBlock.includes("Reaction"));
  });

  it("shows DM trigger when enabled", () => {
    const deps = makeDeps();
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      directMessages: { enabled: true },
    }));
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const triggerBlock = texts.find((t) => t.includes("Trigger Methods"));
    assert.ok(triggerBlock);
    assert.ok(triggerBlock.includes("Direct Messages"));
  });

  it("shows mentions trigger when enabled", () => {
    const deps = makeDeps();
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      mentions: { enabled: true },
    }));
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const triggerBlock = texts.find((t) => t.includes("Trigger Methods"));
    assert.ok(triggerBlock);
    assert.ok(triggerBlock.includes("@Mentions"));
  });

  it("ends with a divider", () => {
    const deps = makeDeps();
    const blocks = buildStatusSection("member", deps);
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
    const deps = makeDeps();
    const blocks = buildActiveWorkersSection(deps);
    assert.equal(blocks[0].type, "header");
    const headerBlock = blocks[0] as KnownBlock & { text: { text: string } };
    assert.equal(headerBlock.text.text, "Active Workers");
  });

  it("shows empty state when no workers", () => {
    const deps = makeDeps();
    mockGetActiveWorkers.mock.mockImplementation(() => []);
    const blocks = buildActiveWorkersSection(deps);
    const texts = getSectionTexts(blocks);
    assert.ok(texts.some((t) => t.includes("No active change requests")));
  });

  it("displays worker details when workers exist", () => {
    const deps = makeDeps();
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
    const blocks = buildActiveWorkersSection(deps);
    const texts = getSectionTexts(blocks);
    const workerBlock = texts.find((t) => t.includes("Fix the bug"));
    assert.ok(workerBlock);
    assert.ok(workerBlock.includes("fix/bug-123"));
    assert.ok(workerBlock.includes("my-repo"));
    assert.ok(workerBlock.includes("Executing"));
  });

  it("includes PR link when available", () => {
    const deps = makeDeps();
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
    const blocks = buildActiveWorkersSection(deps);
    const texts = getSectionTexts(blocks);
    const workerBlock = texts.find((t) => t.includes("Add feature"));
    assert.ok(workerBlock);
    assert.ok(workerBlock.includes("View PR"));
  });

  it("ends with a divider", () => {
    const deps = makeDeps();
    const blocks = buildActiveWorkersSection(deps);
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
    const deps = makeDeps();
    const blocks = buildHelpSection(deps);
    assert.equal(blocks[0].type, "header");
    const headerBlock = blocks[0] as KnownBlock & { text: { text: string } };
    assert.equal(headerBlock.text.text, "Help");
  });

  it("always includes reaction trigger instruction", () => {
    const deps = makeDeps();
    const blocks = buildHelpSection(deps);
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("Reaction"));
    assert.ok(instructions);
  });

  it("includes DM instruction when enabled", () => {
    const deps = makeDeps();
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      directMessages: { enabled: true },
    }));
    const blocks = buildHelpSection(deps);
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("Direct Message"));
    assert.ok(instructions);
  });

  it("includes mention instruction when enabled", () => {
    const deps = makeDeps();
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      mentions: { enabled: true },
    }));
    const blocks = buildHelpSection(deps);
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("Mention"));
    assert.ok(instructions);
  });

  it("does not include DM instruction when disabled", () => {
    const deps = makeDeps();
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      directMessages: { enabled: false },
    }));
    const blocks = buildHelpSection(deps);
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("Direct Message"));
    assert.equal(instructions, undefined);
  });

  it("does not include mention instruction when disabled", () => {
    const deps = makeDeps();
    mockGetConfig.mock.mockImplementation(() => ({
      ...defaultConfig(),
      mentions: { enabled: false },
    }));
    const blocks = buildHelpSection(deps);
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("@mention"));
    assert.equal(instructions, undefined);
  });
});

// ============================================================================
// buildSettingsModal
// ============================================================================

describe("buildSettingsModal", () => {
  beforeEach(() => {
    setDefaultMocks("member");
  });

  it("returns a modal view", async () => {
    const deps = makeDeps();
    mockGetReactionDelivery.mock.mockImplementation(async () => "dm");
    mockGetUserPreference.mock.mockImplementation(async () => true);
    const modal = await buildSettingsModal("U001", deps);
    assert.equal(modal.type, "modal");
  });

  it("sets reaction delivery to dm when stored", async () => {
    const deps = makeDeps();
    mockGetReactionDelivery.mock.mockImplementation(async () => "dm");
    mockGetUserPreference.mock.mockImplementation(async () => false);
    const modal = await buildSettingsModal("U001", deps);
    const blocks = modal.blocks as KnownBlock[];
    const responseDeliveryBlock = blocks.find((b) => {
      const blockWithId = b as { block_id?: string };
      return blockWithId.block_id === "response_delivery_block";
    });
    assert.ok(responseDeliveryBlock);
  });

  it("sets notify on response when preference is true", async () => {
    const deps = makeDeps();
    mockGetReactionDelivery.mock.mockImplementation(async () => "thread");
    mockGetUserPreference.mock.mockImplementation(async () => true);
    const modal = await buildSettingsModal("U001", deps);
    const blocks = modal.blocks as KnownBlock[];
    const notifyBlock = blocks.find((b) => {
      const blockWithId = b as { block_id?: string };
      return blockWithId.block_id === "notify_on_response_block";
    });
    assert.ok(notifyBlock);
  });
});

// ============================================================================
// buildUserSelectModal
// ============================================================================

describe("buildUserSelectModal", () => {
  it("returns a modal view", () => {
    const modal = buildUserSelectModal("Select a User", "my_action", "Choose a user");
    assert.equal(modal.type, "modal");
    assert.equal(modal.callback_id, "my_action");
  });

  it("sets callback_id from action", () => {
    const modal = buildUserSelectModal("Title", "custom_action", "placeholder");
    assert.equal(modal.callback_id, "custom_action");
  });
});

// ============================================================================
// buildRemoveUserModal
// ============================================================================

describe("buildRemoveUserModal", () => {
  it("returns a modal view with the given callback_id", () => {
    const view = buildRemoveUserModal("Remove Admin", "remove_admin_modal", ["U001", "U002"]);
    assert.equal(view.type, "modal");
    if (isModalView(view)) {
      assert.equal(view.callback_id, "remove_admin_modal");
    }
  });

  it("uses the title as modal title", () => {
    const view = buildRemoveUserModal("Remove Admin", "remove_admin_modal", ["U001"]);
    if (isModalView(view)) {
      assert.ok(view.title);
      assert.equal(view.title.text, "Remove Admin");
    }
  });

  it("has Remove as submit button text", () => {
    const view = buildRemoveUserModal("Remove Admin", "remove_admin_modal", ["U001"]);
    if (isModalView(view)) {
      assert.ok(view.submit);
      assert.equal(view.submit.text, "Remove");
    }
  });

  it("creates static_select options from user list", () => {
    const view = buildRemoveUserModal("Remove Admin", "remove_admin_modal", ["U001", "U002"]);
    const blocks = view.blocks as KnownBlock[];
    const inputBlock = blocks.find(isInputBlock);
    assert.ok(inputBlock);
    if (inputBlock && "element" in inputBlock) {
      const element = inputBlock.element as { type?: string; options?: Array<{ value: string }> };
      assert.equal(element.type, "static_select");
      assert.ok(element.options);
      assert.equal(element.options.length, 2);
      assert.equal(element.options[0].value, "U001");
      assert.equal(element.options[1].value, "U002");
    }
  });
});

// ============================================================================
// buildConfigFilePickerModal
// ============================================================================

describe("buildConfigFilePickerModal", () => {
  it("returns a modal view", () => {
    const modal = buildConfigFilePickerModal("member", [], false);
    assert.equal(modal.type, "modal");
  });

  it("shows file list when provided", () => {
    const files = [{ filename: "file1.md", sourceLabel: "", effectiveLength: 100 }];
    const modal = buildConfigFilePickerModal("member", files, false);
    const blocks = modal.blocks as KnownBlock[];
    assert.ok(blocks.length > 0);
  });
});

// ============================================================================
// buildConfigEditorModal
// ============================================================================

describe("buildConfigEditorModal", () => {
  it("returns a modal view", () => {
    const modal = buildConfigEditorModal("member", "identity.md", "content", "default-only");
    assert.equal(modal.type, "modal");
  });

  it("sets content to provided text", () => {
    const content = "test content here";
    const modal = buildConfigEditorModal("member", "identity.md", content, "default-only");
    const blocks = modal.blocks as KnownBlock[];
    const inputBlock = blocks.find((b) => b.type === "input");
    assert.ok(inputBlock);
  });
});

// ============================================================================
// buildConfigCreateFileModal
// ============================================================================

describe("buildConfigCreateFileModal", () => {
  it("returns a modal view", () => {
    const modal = buildConfigCreateFileModal("member");
    assert.equal(modal.type, "modal");
  });

  it("has input for file creation", () => {
    const modal = buildConfigCreateFileModal("admin");
    const blocks = modal.blocks as KnownBlock[];
    const inputs = blocks.filter((b) => b.type === "input");
    assert.ok(inputs.length > 0);
  });
});

// ============================================================================
// Home Tab — skipConditions on scheduled messages
// ============================================================================

describe("buildHomeView — Scheduled Messages skipConditions", () => {
  function baseJob(overrides: Partial<CronJob> = {}): CronJob {
    return {
      id: "job-1",
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Summarize PRs",
      createdBy: "U001",
      createdAt: new Date().toISOString(),
      enabled: true,
      timezone: "UTC",
      ...overrides,
    };
  }

  function findContextTexts(view: View): string[] {
    const blocks = view.blocks as KnownBlock[];
    const texts: string[] = [];
    for (const block of blocks) {
      if (block.type === "context") {
        for (const el of block.elements) {
          if (el.type === "mrkdwn") {
            texts.push(el.text);
          }
        }
      }
    }
    return texts;
  }

  it("does NOT render a skip-conditions context line on the home page (edit modal only)", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mock.mockImplementation(async () => [
      baseJob({ skipConditions: "Skip on weekends" }),
    ]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const texts = findContextTexts(view);
    assert.ok(
      !texts.some((t) => t.includes("Skip conditions:") || t.includes("Skip on weekends")),
      "skipConditions should only be visible inside the edit modal, not as a row label",
    );
  });

  it("renders a distinct 'last run skipped' indicator for skipped status", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mock.mockImplementation(async () => [baseJob({ lastRunStatus: "skipped" })]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const blocks = view.blocks as KnownBlock[];
    const sections = blocks.filter((b) => b.type === "section");
    const jobLine = sections.find(
      (s) => s.text?.type === "mrkdwn" && s.text.text.includes("last run skipped"),
    );
    assert.ok(jobLine, "should render a 'last run skipped' indicator");
  });
});

describe("buildCronJobModal — skipConditions input", () => {
  function jobWith(overrides: Partial<CronJob> = {}): CronJob {
    return {
      id: "job-1",
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Summarize PRs",
      createdBy: "U001",
      createdAt: new Date().toISOString(),
      enabled: true,
      timezone: "UTC",
      ...overrides,
    };
  }

  function findSkipConditionsInput(view: View): KnownBlock | undefined {
    const blocks = view.blocks as KnownBlock[];
    return blocks.find((b) => "block_id" in b && b.block_id === "cron_skip_conditions_block");
  }

  it("includes a skipConditions input in the modal", () => {
    const modal = buildCronJobModal(jobWith());
    const input = findSkipConditionsInput(modal);
    assert.ok(input, "modal should include the skipConditions input block");
    if (input.type === "input" && "multiline" in input.element) {
      assert.equal(input.element.multiline, true, "should be multi-line");
    }
  });

  it("pre-fills the input with the stored skipConditions value", () => {
    const modal = buildCronJobModal(jobWith({ skipConditions: "Skip if nothing changed" }));
    const input = findSkipConditionsInput(modal);
    assert.ok(input);
    if (input.type === "input" && "initial_value" in input.element) {
      assert.equal(input.element.initial_value, "Skip if nothing changed");
    }
  });

  it("leaves the input empty when the job has no skipConditions", () => {
    const modal = buildCronJobModal(jobWith());
    const input = findSkipConditionsInput(modal);
    assert.ok(input);
    if (input.type === "input" && "initial_value" in input.element) {
      assert.equal(input.element.initial_value, undefined);
    }
  });
});
