import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { UserRole, RolesConfig } from "../roles.js";
import type { RepositoryConfig, Config } from "../config.js";
import type { InstructionFileListing } from "../configurationFiles.js";
import type { ActiveWorker } from "../changes/activeState.js";
import type { SkillPluginInfo } from "../skillPlugins.js";
import type { MigrationError } from "../migrations/types.js";
import type { KnownBlock, View, ActionsBlockElement } from "@slack/types";
import {
  buildHomeView,
  buildRoleManagementSection,
  buildConfigurationSection,
  buildStatusSection,
  buildWorkersSection,
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

const mockGetRole = vi.fn<(userId: string) => Promise<UserRole>>();
const mockHasOwner = vi.fn<() => Promise<boolean>>();
const mockLoadRoles = vi.fn<() => Promise<RolesConfig>>();

const mockCanEditConfig = vi.fn<(role: UserRole) => boolean>();
const mockCanManageRoles = vi.fn<(role: UserRole) => boolean>();
const mockCanRequestChanges = vi.fn<(role: UserRole) => boolean>();

const mockGetConfig = vi.fn<() => Config>();
const mockGetConfiguredMcpServerNames = vi.fn<() => string[]>();
const mockGetFailedMcpServers = vi.fn<() => Set<string>>();
const mockGetActiveWorkers = vi.fn<() => ActiveWorker[]>();
const mockListInstructionFiles = vi.fn<() => InstructionFileListing>();
const mockGetReactionDelivery = vi.fn<(userId: string) => Promise<string>>();
const mockGetUserPreference = vi.fn<(userId: string, key: string) => Promise<boolean>>();
const mockGetVisibleRepos =
  vi.fn<(role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[]>();
const mockCanWriteRepo = vi.fn<(role: UserRole, repo: RepositoryConfig) => boolean>();
const mockGetMigrationErrors = vi.fn<() => MigrationError[]>();
const mockDiscoverSkillPluginInfo = vi.fn<() => SkillPluginInfo[]>();
const mockGetLoadedClackPlugins = vi.fn<() => ClackPluginSummary[]>();
const mockGetRules = vi.fn<() => Promise<AutoRespondRule[]>>();
const mockGetJobs = vi.fn<() => Promise<CronJob[]>>();
const mockGetJobsByUser = vi.fn<(userId: string) => Promise<CronJob[]>>();
const mockGetUserTimezone = vi.fn<(userId: string) => Promise<string | undefined>>();
const mockHumanReadableSchedule =
  vi.fn<(cronExpression: string, timezone: string, viewerTimezone?: string) => string>();

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
    discoverSkillPluginInfo: mockDiscoverSkillPluginInfo,
    getLoadedClackPlugins: mockGetLoadedClackPlugins,
    getRules: mockGetRules,
    getJobs: mockGetJobs,
    getJobsByUser: mockGetJobsByUser,
    getUserTimezone: mockGetUserTimezone,
    humanReadableSchedule: mockHumanReadableSchedule,
    getWorkerPoolSnapshot: () => ({ reusable: false, byRepo: [] }),
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
    directMessages: { enabled: false, dmType: "assistant" },
    mentions: { enabled: false },
    repositories: [
      { name: "my-repo", url: "https://github.com/test/my-repo", description: "Test repo" },
    ],
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "claude-opus" },
    // Existing tests assume user-facing scheduled messages render; set the flag here
    // so they keep doing so. Tests for the "hidden when off" path override this.
    cron: { enabled: true, userSchedules: true },
  };
}

function resetAllMocks() {
  mockGetRole.mockClear();
  mockHasOwner.mockClear();
  mockLoadRoles.mockClear();
  mockCanEditConfig.mockClear();
  mockCanManageRoles.mockClear();
  mockCanRequestChanges.mockClear();
  mockGetConfig.mockClear();
  mockGetConfiguredMcpServerNames.mockClear();
  mockGetFailedMcpServers.mockClear();
  mockGetActiveWorkers.mockClear();
  mockListInstructionFiles.mockClear();
  mockGetReactionDelivery.mockClear();
  mockGetUserPreference.mockClear();
  mockGetVisibleRepos.mockClear();
  mockCanWriteRepo.mockClear();
  mockGetMigrationErrors.mockClear();
  mockDiscoverSkillPluginInfo.mockClear();
  mockGetLoadedClackPlugins.mockClear();
  mockGetRules.mockClear();
  mockGetJobs.mockClear();
  mockGetJobsByUser.mockClear();
  mockGetUserTimezone.mockClear();
  mockHumanReadableSchedule.mockClear();
}

function setDefaultMocks(role: UserRole = "member") {
  mockGetRole.mockImplementation(async () => role);
  mockHasOwner.mockImplementation(async () => true);
  mockLoadRoles.mockImplementation(async () => ({
    owner: "U_OWNER",
    admins: [],
    devs: [],
  }));
  mockCanEditConfig.mockImplementation((r = role) => r === "admin" || r === "owner");
  mockCanManageRoles.mockImplementation((r = role) => r === "admin" || r === "owner");
  mockCanRequestChanges.mockImplementation(
    (r = role) => r === "dev" || r === "admin" || r === "owner",
  );
  mockGetConfig.mockImplementation(() => defaultConfig());
  mockGetConfiguredMcpServerNames.mockImplementation(() => []);
  mockGetFailedMcpServers.mockImplementation(() => new Set<string>());
  mockGetActiveWorkers.mockImplementation(() => []);
  mockListInstructionFiles.mockImplementation(() => ({
    roles: [],
    preAnalysis: [],
    repos: [],
  }));
  mockGetVisibleRepos.mockImplementation((_role, repos) => repos);
  mockCanWriteRepo.mockImplementation(() => false);
  mockGetMigrationErrors.mockImplementation(() => []);
  mockDiscoverSkillPluginInfo.mockImplementation(() => []);
  mockGetLoadedClackPlugins.mockImplementation(() => []);
  mockGetRules.mockImplementation(async () => []);
  mockGetJobs.mockImplementation(async () => []);
  mockGetJobsByUser.mockImplementation(async () => []);
  mockGetUserTimezone.mockImplementation(async () => undefined);
  mockHumanReadableSchedule.mockImplementation(() => "Every day at 9:00 AM");
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
    mockHasOwner.mockImplementation(async () => false);
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
    assert.ok(headers.includes("Workers"));
  });

  it("does not include active workers section for members", async () => {
    setDefaultMocks("member");
    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const headers = getHeaderTexts(view.blocks as KnownBlock[]);
    assert.ok(!headers.includes("Workers"));
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
    mockGetMigrationErrors.mockImplementation(() => [
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
    mockGetMigrationErrors.mockImplementation(() => [
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
    const blocks = await buildRoleManagementSection("owner", deps);
    assert.equal(blocks[0].type, "header");
    const headerBlock = blocks[0] as KnownBlock & { text: { text: string } };
    assert.equal(headerBlock.text.text, "Role Management");
  });

  it("shows owner with transfer button when user is owner", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("owner", deps);
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
    const blocks = await buildRoleManagementSection("admin", deps);
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
    const blocks = await buildRoleManagementSection("owner", deps);
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
    mockLoadRoles.mockImplementation(async () => ({
      owner: "U_OWNER",
      admins: ["U_ADMIN1"],
      devs: [],
    }));
    const blocks = await buildRoleManagementSection("owner", deps);
    const adminActions = blocks.find((b) => {
      if (!isActionBlock(b)) return false;
      return b.elements.some((e) => (e as { action_id?: string }).action_id === "remove_admin");
    });
    assert.ok(adminActions);
  });

  it("does not show remove admin button when no admins", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("owner", deps);
    const allActionElements = blocks.filter(isActionBlock).flatMap((b) => b.elements);
    const removeAdmin = allActionElements.find(
      (e) => (e as { action_id?: string }).action_id === "remove_admin",
    );
    assert.equal(removeAdmin, undefined);
  });

  it("shows devs list with add button", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("owner", deps);
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
    mockLoadRoles.mockImplementation(async () => ({
      owner: "U_OWNER",
      admins: [],
      devs: ["U_DEV1"],
    }));
    const blocks = await buildRoleManagementSection("owner", deps);
    const devActions = blocks.find((b) => {
      if (!isActionBlock(b)) return false;
      return b.elements.some((e) => (e as { action_id?: string }).action_id === "remove_dev");
    });
    assert.ok(devActions);
  });

  it("ends with a divider", async () => {
    const deps = makeDeps();
    const blocks = await buildRoleManagementSection("owner", deps);
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
    mockListInstructionFiles.mockImplementation(() => ({
      roles: [{ role: "member", files: [], topics: [] }],
      preAnalysis: [],
      repos: [],
    }));
    const blocks = buildConfigurationSection(true, deps);
    const actionsBlocks = blocks.filter(isActionBlock);
    assert.ok(actionsBlocks.length > 0);
    assert.ok(actionsBlocks[0].elements.length > 0);
  });

  it("includes repo directory buttons alongside role buttons", () => {
    const deps = makeDeps();
    mockListInstructionFiles.mockImplementation(() => ({
      roles: [{ role: "member", files: [], topics: [] }],
      preAnalysis: [],
      repos: [
        {
          repo: "my-repo",
          files: [
            { file: "test.md", status: "default" },
            { file: "other.md", status: "default" },
          ],
        },
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
    mockGetVisibleRepos.mockImplementation(() => [
      { name: "my-repo", url: "https://github.com/test/my-repo", description: "Test repo" },
    ]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
  });

  it("shows access tags for dev+ roles", () => {
    const deps = makeDeps();
    mockCanRequestChanges.mockImplementation(() => true);
    mockGetVisibleRepos.mockImplementation(() => [
      { name: "my-repo", url: "u", description: "d", access: { read: "member" as UserRole } },
    ]);
    mockCanWriteRepo.mockImplementation(() => false);
    const blocks = buildStatusSection("dev", deps);
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
    assert.ok(repoBlock.includes("read: all"));
    assert.ok(repoBlock.includes("read-only"));
  });

  it("shows write tags for writable repos", () => {
    const deps = makeDeps();
    mockCanRequestChanges.mockImplementation(() => true);
    mockGetVisibleRepos.mockImplementation(() => [
      {
        name: "my-repo",
        url: "u",
        description: "d",
        access: { read: "member" as UserRole, write: "dev" as UserRole },
      },
    ]);
    mockCanWriteRepo.mockImplementation(() => true);
    const blocks = buildStatusSection("dev", deps);
    const texts = getSectionTexts(blocks);
    const repoBlock = texts.find((t) => t.includes("my-repo"));
    assert.ok(repoBlock);
    assert.ok(repoBlock.includes("write: dev+"));
  });

  it("does not show access tags for members", () => {
    const deps = makeDeps();
    mockCanRequestChanges.mockImplementation(() => false);
    mockGetVisibleRepos.mockImplementation(() => [
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
    mockGetConfiguredMcpServerNames.mockImplementation(() => ["filesystem", "github"]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const mcpBlock = texts.find((t) => t.includes("MCP Servers"));
    assert.ok(mcpBlock);
    assert.ok(mcpBlock.includes("filesystem"));
    assert.ok(mcpBlock.includes("github"));
  });

  it("marks failed MCP servers with a warning", () => {
    const deps = makeDeps();
    mockGetConfiguredMcpServerNames.mockImplementation(() => ["filesystem", "github"]);
    mockGetFailedMcpServers.mockImplementation(() => new Set(["github"]));
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const mcpBlock = texts.find((t) => t.includes("MCP Servers"));
    assert.ok(mcpBlock);
    assert.ok(mcpBlock.includes("github :warning:"));
    assert.ok(!mcpBlock.includes("filesystem :warning:"));
  });

  it("does not show MCP servers section when none configured", () => {
    const deps = makeDeps();
    mockGetConfiguredMcpServerNames.mockImplementation(() => []);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const mcpBlock = texts.find((t) => t.includes("MCP Servers"));
    assert.equal(mcpBlock, undefined);
  });

  it("shows skill plugins when discovered", () => {
    const deps = makeDeps();
    mockDiscoverSkillPluginInfo.mockImplementation(() => [
      { name: "my-plugin", path: "/some/path", skillCount: 3, lazyLoad: false },
    ]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes("Skill Plugins"));
    assert.ok(pluginBlock);
    assert.ok(pluginBlock.includes("my-plugin"));
    assert.ok(pluginBlock.includes("3 skills"));
    assert.ok(pluginBlock.includes("Eager"));
  });

  it("groups skill plugins into Eager and Lazy sections", () => {
    const deps = makeDeps();
    mockDiscoverSkillPluginInfo.mockImplementation(() => [
      { name: "devtools", path: "/a", skillCount: 2, lazyLoad: false },
      { name: "marketingskills", path: "/b", skillCount: 32, lazyLoad: true },
    ]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes("Skill Plugins"));
    assert.ok(pluginBlock);
    assert.ok(pluginBlock.includes("Eager"));
    assert.ok(pluginBlock.includes("Lazy"));
    const eagerIdx = pluginBlock.indexOf("Eager");
    const lazyIdx = pluginBlock.indexOf("Lazy");
    const devtoolsIdx = pluginBlock.indexOf("devtools");
    const marketingIdx = pluginBlock.indexOf("marketingskills");
    assert.ok(eagerIdx < devtoolsIdx);
    assert.ok(devtoolsIdx < lazyIdx);
    assert.ok(lazyIdx < marketingIdx);
  });

  it("shows only the Lazy section when every plugin is lazy-tagged", () => {
    const deps = makeDeps();
    mockDiscoverSkillPluginInfo.mockImplementation(() => [
      { name: "marketingskills", path: "/b", skillCount: 32, lazyLoad: true },
    ]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes("Skill Plugins"));
    assert.ok(pluginBlock);
    assert.ok(pluginBlock.includes("Lazy"));
    assert.ok(!pluginBlock.includes("Eager"));
  });

  it("does not show skill plugins section when none found", () => {
    const deps = makeDeps();
    mockDiscoverSkillPluginInfo.mockImplementation(() => []);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes("Skill Plugins"));
    assert.equal(pluginBlock, undefined);
  });

  it("shows clack plugins when loaded", () => {
    const deps = makeDeps();
    mockGetLoadedClackPlugins.mockImplementation(() => [
      { name: "trivia", toolCount: 5, errors: [] },
    ]);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const headerBlock = texts.find((t) => t.includes(":package:") && t.includes("Plugins"));
    assert.ok(headerBlock);
    const entryBlock = texts.find((t) => t.includes("trivia") && t.includes("5 tools"));
    assert.ok(entryBlock);
  });

  it("does not show clack plugins section when none loaded", () => {
    const deps = makeDeps();
    mockGetLoadedClackPlugins.mockImplementation(() => []);
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const pluginBlock = texts.find((t) => t.includes(":package:"));
    assert.equal(pluginBlock, undefined);
  });

  it("renders a per-plugin error banner for admins when errors are present", () => {
    const deps = makeDeps();
    mockGetLoadedClackPlugins.mockImplementation(() => [
      {
        name: "trivia",
        toolCount: 0,
        errors: ["Trivia requires the cron scheduler. Enable it via `config.cron.enabled: true`."],
      },
    ]);
    const blocks = buildStatusSection("admin", deps);
    const contextBlock = blocks.find(
      (b) =>
        b.type === "context" &&
        b.elements?.some(
          (e) => e.type === "mrkdwn" && e.text.includes("Trivia requires the cron scheduler"),
        ),
    );
    assert.ok(contextBlock, "expected a context block with the error reason");
    const entryTexts = getSectionTexts(blocks);
    const entryBlock = entryTexts.find((t) => t.includes("trivia") && t.includes(":x:"));
    assert.ok(entryBlock, "expected the failing plugin's row to be prefixed with :x:");
  });

  it("renders multiple errors as separate lines in the banner", () => {
    const deps = makeDeps();
    mockGetLoadedClackPlugins.mockImplementation(() => [
      { name: "p", toolCount: 0, errors: ["reason A", "reason B"] },
    ]);
    const blocks = buildStatusSection("admin", deps);
    const contextBlock = blocks.find(
      (b) =>
        b.type === "context" &&
        b.elements?.some(
          (e) => e.type === "mrkdwn" && e.text.includes("reason A") && e.text.includes("reason B"),
        ),
    );
    assert.ok(contextBlock);
  });

  it("does not render the banner for non-admins even when errors exist", () => {
    const deps = makeDeps();
    mockGetLoadedClackPlugins.mockImplementation(() => [
      { name: "trivia", toolCount: 0, errors: ["Trivia requires the cron scheduler."] },
    ]);
    const blocks = buildStatusSection("member", deps);
    const contextBlock = blocks.find(
      (b) =>
        b.type === "context" &&
        b.elements?.some(
          (e) => e.type === "mrkdwn" && e.text.includes("Trivia requires the cron scheduler"),
        ),
    );
    assert.equal(contextBlock, undefined);
  });

  it("does not render a banner when errors[] is empty", () => {
    const deps = makeDeps();
    mockGetLoadedClackPlugins.mockImplementation(() => [
      { name: "tenor-gif", toolCount: 1, errors: [] },
    ]);
    const blocks = buildStatusSection("admin", deps);
    const entryTexts = getSectionTexts(blocks);
    const entryBlock = entryTexts.find((t) => t.includes("tenor-gif"));
    assert.ok(entryBlock);
    assert.equal(entryBlock.includes(":x:"), false);
    const contextBlocks = blocks.filter((b) => b.type === "context");
    assert.equal(contextBlocks.length, 0);
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
    mockGetConfig.mockImplementation(() => ({
      ...defaultConfig(),
      directMessages: { enabled: true, dmType: "assistant" },
    }));
    const blocks = buildStatusSection("member", deps);
    const texts = getSectionTexts(blocks);
    const triggerBlock = texts.find((t) => t.includes("Trigger Methods"));
    assert.ok(triggerBlock);
    assert.ok(triggerBlock.includes("Direct Messages"));
  });

  it("shows mentions trigger when enabled", () => {
    const deps = makeDeps();
    mockGetConfig.mockImplementation(() => ({
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
// buildWorkersSection — disposable mode (legacy active-changes view)
// ============================================================================

describe("buildWorkersSection (disposable mode)", () => {
  beforeEach(() => {
    setDefaultMocks("dev");
  });

  it("starts with a 'Workers' header", () => {
    const deps = makeDeps();
    const blocks = buildWorkersSection(deps);
    assert.equal(blocks[0].type, "header");
    const headerBlock = blocks[0] as KnownBlock & { text: { text: string } };
    assert.equal(headerBlock.text.text, "Workers");
  });

  it("shows empty state when there are no active changes", () => {
    const deps = makeDeps();
    mockGetActiveWorkers.mockImplementation(() => []);
    const blocks = buildWorkersSection(deps);
    const texts = getSectionTexts(blocks);
    assert.ok(texts.some((t) => t.includes("No active change requests")));
  });

  it("displays change details when active changes exist", () => {
    const deps = makeDeps();
    mockGetActiveWorkers.mockImplementation(() => [
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
    const blocks = buildWorkersSection(deps);
    const texts = getSectionTexts(blocks);
    const workerBlock = texts.find((t) => t.includes("Fix the bug"));
    assert.ok(workerBlock);
    assert.ok(workerBlock.includes("fix/bug-123"));
    assert.ok(workerBlock.includes("my-repo"));
    assert.ok(workerBlock.includes("Executing"));
  });

  it("includes PR link when available", () => {
    const deps = makeDeps();
    mockGetActiveWorkers.mockImplementation(() => [
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
    const blocks = buildWorkersSection(deps);
    const texts = getSectionTexts(blocks);
    const workerBlock = texts.find((t) => t.includes("Add feature"));
    assert.ok(workerBlock);
    assert.ok(workerBlock.includes("View PR"));
  });

  it("ends with a divider", () => {
    const deps = makeDeps();
    const blocks = buildWorkersSection(deps);
    assert.equal(blocks[blocks.length - 1].type, "divider");
  });
});

// ============================================================================
// buildWorkersSection — reusable mode (pool view)
// ============================================================================

describe("buildWorkersSection (reusable mode)", () => {
  beforeEach(() => {
    setDefaultMocks("admin");
  });

  it("falls back to the disposable view when reusable mode is off", () => {
    const deps: HomeTabDeps = {
      ...makeDeps(),
      getWorkerPoolSnapshot: () => ({ reusable: false, byRepo: [] }),
    };
    mockGetActiveWorkers.mockImplementation(() => []);
    const blocks = buildWorkersSection(deps);
    const texts = getSectionTexts(blocks);
    // Disposable mode shows the active-changes empty state, not the pool message.
    assert.ok(texts.some((t) => t.includes("No active change requests")));
    assert.ok(!texts.some((t) => /Reusable worker pool is not active/.test(t)));
  });

  it("renders 'no workers yet' when pool is reusable but empty", () => {
    const deps: HomeTabDeps = {
      ...makeDeps(),
      getWorkerPoolSnapshot: () => ({ reusable: true, byRepo: [] }),
    };
    const blocks = buildWorkersSection(deps);
    const texts = getSectionTexts(blocks);
    assert.ok(texts.some((t) => /No workers provisioned yet/.test(t)));
  });

  it("renders per-repo status counts", () => {
    const deps: HomeTabDeps = {
      ...makeDeps(),
      getWorkerPoolSnapshot: () => ({
        reusable: true,
        byRepo: [
          {
            repo: "alpha",
            idle: 1,
            busy: 2,
            initializing: 0,
            quarantined: 0,
            failed: 0,
            queueDepth: 0,
            workers: [],
            queued: [],
          },
        ],
      }),
    };
    const blocks = buildWorkersSection(deps);
    const texts = getSectionTexts(blocks);
    const repoText = texts.find((t) => t.includes("alpha"));
    assert.ok(repoText);
    assert.match(repoText!, /1 idle/);
    assert.match(repoText!, /2 busy/);
    assert.match(repoText!, /0 queued/);
  });

  it("emits a 'Discard & restore' button for each quarantined worker", () => {
    const deps: HomeTabDeps = {
      ...makeDeps(),
      getWorkerPoolSnapshot: () => ({
        reusable: true,
        byRepo: [
          {
            repo: "alpha",
            idle: 0,
            busy: 0,
            initializing: 0,
            quarantined: 2,
            failed: 0,
            queueDepth: 0,
            workers: [
              {
                id: "worker-1",
                status: "quarantined",
                currentBranch: "feat/x",
                claimedBy: null,
                setupComplete: true,
                setupVersionHash: null,
                lastUsedAt: new Date("2026-04-01"),
                createdAt: new Date("2026-04-01"),
              },
              {
                id: "worker-2",
                status: "quarantined",
                currentBranch: null,
                claimedBy: null,
                setupComplete: true,
                setupVersionHash: null,
                lastUsedAt: new Date("2026-04-02"),
                createdAt: new Date("2026-04-02"),
              },
            ],
            queued: [],
          },
        ],
      }),
    };
    const blocks = buildWorkersSection(deps);
    const sections = blocks.filter(
      (
        b,
      ): b is KnownBlock & {
        type: "section";
        accessory?: { action_id?: string; value?: string };
      } => b.type === "section",
    );
    const buttonValues = sections
      .filter((s) => s.accessory?.action_id === "clack_clear_quarantine")
      .map((s) => s.accessory?.value);
    assert.deepEqual(buttonValues.sort(), ["alpha/worker-1", "alpha/worker-2"]);
  });

  it("renders queued requests as context blocks", () => {
    const deps: HomeTabDeps = {
      ...makeDeps(),
      getWorkerPoolSnapshot: () => ({
        reusable: true,
        byRepo: [
          {
            repo: "alpha",
            idle: 0,
            busy: 3,
            initializing: 0,
            quarantined: 0,
            failed: 0,
            queueDepth: 2,
            workers: [],
            queued: [
              {
                sessionId: "sess-1",
                branch: "feat/queued-1",
                enqueuedAt: new Date("2026-04-01T12:00:00Z"),
              },
              {
                sessionId: "sess-2",
                branch: "feat/queued-2",
                enqueuedAt: new Date("2026-04-01T12:01:00Z"),
              },
            ],
          },
        ],
      }),
    };
    const blocks = buildWorkersSection(deps);
    // Filter to queue rows specifically — when `workers` is empty, the section
    // also emits a "no workers yet" context block which would otherwise inflate
    // the count.
    const queueBlocks = blocks.filter(
      (b): b is KnownBlock & { type: "context"; elements: Array<{ text?: string }> } => {
        if (b.type !== "context") return false;
        const elements = (b as { elements?: Array<{ text?: string }> }).elements ?? [];
        return elements.some((e) => typeof e.text === "string" && e.text.includes("queued:"));
      },
    );
    assert.equal(queueBlocks.length, 2);
  });

  it("ends with a divider", () => {
    const deps = makeDeps();
    const blocks = buildWorkersSection(deps);
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
    mockGetConfig.mockImplementation(() => ({
      ...defaultConfig(),
      directMessages: { enabled: true, dmType: "assistant" },
    }));
    const blocks = buildHelpSection(deps);
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("Direct Message"));
    assert.ok(instructions);
  });

  it("includes mention instruction when enabled", () => {
    const deps = makeDeps();
    mockGetConfig.mockImplementation(() => ({
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
    mockGetConfig.mockImplementation(() => ({
      ...defaultConfig(),
      directMessages: { enabled: false, dmType: "assistant" },
    }));
    const blocks = buildHelpSection(deps);
    const texts = getSectionTexts(blocks);
    const instructions = texts.find((t) => t.includes("Direct Message"));
    assert.equal(instructions, undefined);
  });

  it("does not include mention instruction when disabled", () => {
    const deps = makeDeps();
    mockGetConfig.mockImplementation(() => ({
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
    mockGetReactionDelivery.mockImplementation(async () => "dm");
    mockGetUserPreference.mockImplementation(async () => true);
    const modal = await buildSettingsModal("U001", deps);
    assert.equal(modal.type, "modal");
  });

  it("sets reaction delivery to dm when stored", async () => {
    const deps = makeDeps();
    mockGetReactionDelivery.mockImplementation(async () => "dm");
    mockGetUserPreference.mockImplementation(async () => false);
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
    mockGetReactionDelivery.mockImplementation(async () => "thread");
    mockGetUserPreference.mockImplementation(async () => true);
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
    mockGetJobsByUser.mockImplementation(async () => [
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

  it("passes the viewer's timezone to humanReadableSchedule", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mockImplementation(async () => [baseJob()]);
    mockGetUserTimezone.mockImplementation(async () => "America/Montreal");

    const deps = makeDeps();
    await buildHomeView({ userId: "U001" }, deps);

    assert.ok(
      mockHumanReadableSchedule.mock.calls.some(
        (call) => call[1] === "UTC" && call[2] === "America/Montreal",
      ),
      "humanReadableSchedule should receive the viewer's timezone as the third argument",
    );
  });

  it("passes undefined viewer timezone through when the viewer has none", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mockImplementation(async () => [baseJob()]);
    mockGetUserTimezone.mockImplementation(async () => undefined);

    const deps = makeDeps();
    await buildHomeView({ userId: "U001" }, deps);

    assert.ok(
      mockHumanReadableSchedule.mock.calls.every((call) => call[2] === undefined),
      "humanReadableSchedule should receive undefined when the viewer has no timezone",
    );
  });

  it("appends a 'jitter: Nm' suffix to the row when jitterMinutes is set", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mockImplementation(async () => [baseJob({ jitterMinutes: 5 })]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const blocks = view.blocks as KnownBlock[];
    const sections = blocks.filter((b) => b.type === "section");
    const jobLine = sections.find(
      (s) => s.text?.type === "mrkdwn" && s.text.text.includes("jitter: 5m"),
    );
    assert.ok(jobLine, "row should carry an inline 'jitter: 5m' suffix");
  });

  it("omits the jitter suffix when the job has no jitter", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mockImplementation(async () => [baseJob()]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const blocks = view.blocks as KnownBlock[];
    const sections = blocks.filter((b) => b.type === "section");
    assert.ok(
      !sections.some((s) => s.text?.type === "mrkdwn" && s.text.text.includes("jitter:")),
      "no jitter suffix should render when jitterMinutes is absent",
    );
  });

  it("renders a distinct 'last run skipped' indicator for skipped status", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mockImplementation(async () => [baseJob({ lastRunStatus: "skipped" })]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const blocks = view.blocks as KnownBlock[];
    const sections = blocks.filter((b) => b.type === "section");
    const jobLine = sections.find(
      (s) => s.text?.type === "mrkdwn" && s.text.text.includes("last run skipped"),
    );
    assert.ok(jobLine, "should render a 'last run skipped' indicator");
  });

  it("renders 'ran without responses' for skipped status when submitResponseMode is 'skipped'", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mockImplementation(async () => [
      baseJob({ lastRunStatus: "skipped", submitResponseMode: "skipped" }),
    ]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const blocks = view.blocks as KnownBlock[];
    const sections = blocks.filter((b) => b.type === "section");
    const jobLine = sections.find(
      (s) => s.text?.type === "mrkdwn" && s.text.text.includes("ran without responses"),
    );
    assert.ok(jobLine, "should render 'ran without responses' indicator");
    const skippedLine = sections.find(
      (s) => s.text?.type === "mrkdwn" && s.text.text.includes("last run skipped"),
    );
    assert.ok(!skippedLine, "should NOT render 'last run skipped' for submitResponseMode=skipped");
  });

  it("hides the user-created scheduled messages subsection when cron.userSchedules is false", async () => {
    setDefaultMocks("admin");
    mockGetConfig.mockImplementation(() => ({
      ...defaultConfig(),
      cron: { enabled: true, userSchedules: false },
    }));
    mockGetJobs.mockImplementation(async () => [baseJob()]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const blocks = view.blocks as KnownBlock[];
    const headers = blocks.filter((b) => b.type === "header");
    const userHeader = headers.find(
      (h) => h.text?.type === "plain_text" && h.text.text === "Scheduled Messages",
    );
    assert.equal(
      userHeader,
      undefined,
      "Scheduled Messages (user) header should be absent when userSchedules is false",
    );
  });

  it("still renders the Plugin Scheduled Messages subsection for admins when userSchedules is false", async () => {
    setDefaultMocks("admin");
    mockGetConfig.mockImplementation(() => ({
      ...defaultConfig(),
      cron: { enabled: true, userSchedules: false },
    }));
    mockGetJobs.mockImplementation(async () => [
      baseJob({
        id: "plugin-1",
        createdBy: null,
        plugin: "trivia",
        pluginManaged: true,
        specKey: "g:question",
      }),
    ]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const blocks = view.blocks as KnownBlock[];
    const headers = blocks.filter((b) => b.type === "header");
    const pluginHeader = headers.find(
      (h) => h.text?.type === "plain_text" && h.text.text === "Plugin Scheduled Messages",
    );
    assert.ok(pluginHeader, "Plugin Scheduled Messages header should still render");
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

describe("buildCronJobModal — jitter input", () => {
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

  function findJitterInput(view: View): KnownBlock | undefined {
    const blocks = view.blocks as KnownBlock[];
    return blocks.find((b) => "block_id" in b && b.block_id === "cron_jitter_block");
  }

  it("includes an optional jitter input in the modal", () => {
    const input = findJitterInput(buildCronJobModal(jobWith()));
    assert.ok(input, "modal should include the jitter input block");
    if (input.type === "input") {
      assert.equal(input.optional, true);
    }
  });

  it("pre-fills the input with the stored jitterMinutes as a string", () => {
    const input = findJitterInput(buildCronJobModal(jobWith({ jitterMinutes: 5 })));
    assert.ok(input);
    if (input.type === "input" && "initial_value" in input.element) {
      assert.equal(input.element.initial_value, "5");
    }
  });

  it("leaves the input empty when the job has no jitter", () => {
    const input = findJitterInput(buildCronJobModal(jobWith()));
    assert.ok(input);
    if (input.type === "input" && "initial_value" in input.element) {
      assert.equal(input.element.initial_value, undefined);
    }
  });
});

describe("buildCronJobModal — name input", () => {
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

  function findNameInput(view: View): KnownBlock | undefined {
    const blocks = view.blocks as KnownBlock[];
    return blocks.find((b) => "block_id" in b && b.block_id === "cron_name_block");
  }

  it("includes a name input block as the first input", () => {
    const modal = buildCronJobModal(jobWith());
    const input = findNameInput(modal);
    assert.ok(input, "modal should include the name input block");
    if (input.type === "input" && "max_length" in input.element) {
      assert.equal(input.element.max_length, 80);
    }
  });

  it("pre-fills initial_value with the stored job.name", () => {
    const modal = buildCronJobModal(jobWith({ name: "Morning PR roundup" }));
    const input = findNameInput(modal);
    assert.ok(input);
    if (input.type === "input" && "initial_value" in input.element) {
      assert.equal(input.element.initial_value, "Morning PR roundup");
    }
  });

  it("leaves initial_value undefined when the job has no name", () => {
    const modal = buildCronJobModal(jobWith());
    const input = findNameInput(modal);
    assert.ok(input);
    if (input.type === "input" && "initial_value" in input.element) {
      assert.equal(input.element.initial_value, undefined);
    }
  });
});

describe("buildHomeView — schedule name prefix", () => {
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

  function findScheduleRowText(view: View): string | undefined {
    const blocks = view.blocks as KnownBlock[];
    for (const b of blocks) {
      if (b.type === "section" && b.text?.type === "mrkdwn" && b.text.text.includes("<#C456>")) {
        return b.text.text;
      }
    }
    return undefined;
  }

  it("prepends a bold name and em-dash to the row when job.name is set", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mockImplementation(async () => [baseJob({ name: "Morning roundup" })]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const text = findScheduleRowText(view);
    assert.ok(text);
    assert.ok(text.startsWith("*Morning roundup* — "), `expected name prefix, got: ${text}`);
  });

  it("renders no prefix when job.name is absent", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mockImplementation(async () => [baseJob()]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const text = findScheduleRowText(view);
    assert.ok(text);
    assert.ok(text.startsWith("<#C456>"), `expected channel-led row, got: ${text}`);
  });

  it("strips mrkdwn special chars from the name to keep the row intact", async () => {
    setDefaultMocks("member");
    mockGetJobsByUser.mockImplementation(async () => [
      baseJob({ name: "*Sneaky* <link> & _italic_ ~strike~" }),
    ]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const text = findScheduleRowText(view);
    assert.ok(text);
    // The opening + closing bold markers belong to the wrapping, not the name content.
    // After escape, the body between the markers should contain none of `*`, `_`, `~`, `<`, `>`, `&`.
    const match = text.match(/^\*(.+?)\* — /);
    assert.ok(match, `expected bold-wrapped name prefix, got: ${text}`);
    assert.equal(match[1], "Sneaky link  italic strike");
  });
});

describe("buildHomeView — channelless plugin schedules", () => {
  function channellessPluginJob(overrides: Partial<CronJob> = {}): CronJob {
    return {
      id: "plugin-cl-1",
      cronExpression: "*/15 9-16 * * 1-5",
      // no channel — channelless plugin-managed job
      prompt: "Casual chatter",
      createdBy: null,
      systemActor: "plugin:casual-talk",
      plugin: "casual-talk",
      pluginManaged: true,
      specKey: "chatter",
      createdAt: new Date().toISOString(),
      enabled: true,
      timezone: "UTC",
      ...overrides,
    };
  }

  function findPluginScheduleRow(view: View): string | undefined {
    const blocks = view.blocks as KnownBlock[];
    // Find rows under the "Plugin Scheduled Messages" header — text mentions the plugin
    for (const b of blocks) {
      if (
        b.type === "section" &&
        b.text?.type === "mrkdwn" &&
        b.text.text.includes("casual-talk")
      ) {
        return b.text.text;
      }
    }
    return undefined;
  }

  it("omits any <#…> channel reference for channelless plugin rows", async () => {
    setDefaultMocks("admin");
    mockGetJobs.mockImplementation(async () => [channellessPluginJob()]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const text = findPluginScheduleRow(view);
    assert.ok(text, "expected to find the channelless plugin row");
    assert.ok(!text.includes("<#"), `row must not contain any <#…> channel mention — got: ${text}`);
    assert.ok(
      !text.includes("undefined"),
      `row must not render the literal word 'undefined' — got: ${text}`,
    );
  });

  it("preserves the bold name prefix on channelless rows", async () => {
    setDefaultMocks("admin");
    mockGetJobs.mockImplementation(async () => [channellessPluginJob({ name: "Random Chatter" })]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const text = findPluginScheduleRow(view);
    assert.ok(text);
    assert.ok(text.startsWith("*Random Chatter* — "), `expected name prefix, got: ${text}`);
  });

  it("renders the row cleanly when skipDates / skipConditions are absent (no crash)", async () => {
    setDefaultMocks("admin");
    mockGetJobs.mockImplementation(async () => [
      channellessPluginJob({ skipDates: undefined, skipConditions: undefined }),
    ]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const text = findPluginScheduleRow(view);
    assert.ok(text, "row should render without throwing");
  });

  it("uses the same row accessory as channel-bound plugin rows (no channelless-specific UX divergence)", async () => {
    setDefaultMocks("admin");
    mockGetJobs.mockImplementation(async () => [channellessPluginJob()]);

    const deps = makeDeps();
    const view = await buildHomeView({ userId: "U001" }, deps);
    const blocks = view.blocks as KnownBlock[];
    const row = blocks.find(
      (b) =>
        b.type === "section" && b.text?.type === "mrkdwn" && b.text.text.includes("casual-talk"),
    );
    assert.ok(row, "channelless plugin row must be present");
    // Whatever the accessory is for plugin rows (per existing implementation),
    // a channelless row uses the same one — this change only affects channel rendering.
    if (row.type === "section") {
      assert.ok(row.accessory, "plugin row must have an accessory");
    }
  });
});
