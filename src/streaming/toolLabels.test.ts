import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getToolLabel, getToolGroup, getToolDetails } from "./toolLabels.js";

// ---------------------------------------------------------------------------
// getToolLabel
// ---------------------------------------------------------------------------
describe("getToolLabel", () => {
  describe("built-in Claude Code tools", () => {
    it("returns dynamic label for Read with file_path", () => {
      assert.equal(
        getToolLabel("Read", { file_path: "/home/user/projects/my-app/src/index.ts" }),
        "Reading src/index.ts"
      );
    });

    it("returns fallback for Read without file_path", () => {
      assert.equal(getToolLabel("Read", {}), "Reading file");
    });

    it("returns static label for Glob", () => {
      assert.equal(getToolLabel("Glob", {}), "Searching for files");
    });

    it("returns dynamic label for Grep with pattern", () => {
      assert.equal(
        getToolLabel("Grep", { pattern: "TODO" }),
        'Searching for "TODO"'
      );
    });

    it("returns fallback for Grep without pattern", () => {
      assert.equal(getToolLabel("Grep", {}), "Searching codebase");
    });

    it("truncates long Grep pattern", () => {
      const longPattern = "a".repeat(50);
      const label = getToolLabel("Grep", { pattern: longPattern })!;
      assert.ok(label.length < 60, "Label should be truncated");
      assert.ok(label.includes("…"), "Should end with ellipsis");
    });

    it("returns dynamic label for Write with file_path", () => {
      assert.equal(
        getToolLabel("Write", { file_path: "/app/src/utils.ts" }),
        "Writing src/utils.ts"
      );
    });

    it("returns dynamic label for Edit with file_path", () => {
      assert.equal(
        getToolLabel("Edit", { file_path: "/app/src/config.ts" }),
        "Editing src/config.ts"
      );
    });

    it("returns description for Bash when provided", () => {
      assert.equal(
        getToolLabel("Bash", { description: "Install dependencies", command: "npm install" }),
        "Install dependencies"
      );
    });

    it("returns command for Bash when no description", () => {
      assert.equal(
        getToolLabel("Bash", { command: "npm install" }),
        "Running `npm install`"
      );
    });

    it("returns fallback for Bash with no args", () => {
      assert.equal(getToolLabel("Bash", {}), "Running command");
    });

    it("returns dynamic label for Skill with skill name", () => {
      assert.equal(
        getToolLabel("Skill", { skill: "commit" }),
        "Running skill commit"
      );
    });

    it("returns fallback for Skill without skill name", () => {
      assert.equal(getToolLabel("Skill", {}), "Running skill");
    });
  });

  describe("clack tools", () => {
    it("returns static labels for query tools", () => {
      assert.equal(getToolLabel("mcp__clack__list_repositories", {}), "Listing repositories");
      assert.equal(getToolLabel("mcp__clack__git_log", {}), "Reading git history");
      assert.equal(getToolLabel("mcp__clack__deepen_history", {}), "Loading more history");
      assert.equal(getToolLabel("mcp__clack__find_sessions", {}), "Finding sessions");
      assert.equal(getToolLabel("mcp__clack__find_changes", {}), "Finding changes");
      assert.equal(getToolLabel("mcp__clack__find_pull_requests", {}), "Finding pull requests");
      assert.equal(getToolLabel("mcp__clack__find_user", {}), "Looking up user");
    });

    it("returns null for submit_response (excluded from task cards)", () => {
      assert.equal(getToolLabel("mcp__clack__submit_response", {}), null);
    });

    it("returns null for report_status (excluded from task cards)", () => {
      assert.equal(getToolLabel("mcp__clack__report_status", {}), null);
    });

    it("returns static labels for action tools", () => {
      assert.equal(getToolLabel("mcp__clack__propose_change", {}), "Proposing change");
      assert.equal(getToolLabel("mcp__clack__request_update", {}), "Requesting update");
    });

    it("returns static labels for worker tools", () => {
      assert.equal(getToolLabel("mcp__clack__git_push", {}), "Pushing to remote");
      assert.equal(getToolLabel("mcp__clack__ensure_pr", {}), "Creating pull request");
      assert.equal(getToolLabel("mcp__clack__merge_pr", {}), "Merging pull request");
    });
  });

  describe("GitHub MCP tools", () => {
    it("returns labels for known GitHub tools", () => {
      assert.equal(getToolLabel("mcp__github__get_pull_request", {}), "Reading pull request");
      assert.equal(getToolLabel("mcp__github__create_pull_request", {}), "Creating pull request");
      assert.equal(getToolLabel("mcp__github__search_code", {}), "Searching code on GitHub");
    });
  });

  describe("Sentry MCP tools", () => {
    it("returns labels for known Sentry tools", () => {
      assert.equal(getToolLabel("mcp__sentry__search_issues", {}), "Searching Sentry issues");
      assert.equal(getToolLabel("mcp__sentry__get_issue_details", {}), "Reading Sentry issue");
    });

    it("uses prefix fallback for unknown Sentry tools", () => {
      assert.equal(getToolLabel("mcp__sentry__some_new_tool", {}), "Checking Sentry");
    });
  });

  describe("Statsig MCP tools", () => {
    it("returns dynamic label with ID for experiment details", () => {
      assert.equal(
        getToolLabel("mcp__statsig__Get_Experiment_Details_by_ID", { id: "my-experiment" }),
        "Reading experiment my-experiment"
      );
    });

    it("returns ellipsis when ID is missing", () => {
      assert.equal(
        getToolLabel("mcp__statsig__Get_Gate_Details_by_ID", {}),
        "Reading gate \u2026"
      );
    });

    it("uses prefix fallback for unknown Statsig tools", () => {
      assert.equal(
        getToolLabel("mcp__statsig__Some_New_Endpoint", {}),
        "Checking Statsig feature flags"
      );
    });
  });

  describe("generic MCP fallback", () => {
    it("formats unknown MCP tool with capitalized server name", () => {
      assert.equal(
        getToolLabel("mcp__jira__create_issue", {}),
        "Checking Jira"
      );
    });

    it("falls back to Running <name> for non-MCP tools", () => {
      assert.equal(getToolLabel("custom_tool", {}), "Running custom_tool");
    });
  });

  describe("path shortening", () => {
    it("shows last 2 segments for long paths", () => {
      const label = getToolLabel("Read", { file_path: "/a/b/c/d/e/file.ts" });
      assert.equal(label, "Reading e/file.ts");
    });

    it("shows full path for short paths", () => {
      const label = getToolLabel("Read", { file_path: "ab" });
      assert.equal(label, "Reading ab");
    });

    it("shows last 2 segments for exactly 3 segments", () => {
      const label = getToolLabel("Read", { file_path: "a/b/c" });
      assert.equal(label, "Reading b/c");
    });
  });
});

// ---------------------------------------------------------------------------
// getToolGroup
// ---------------------------------------------------------------------------
describe("getToolGroup", () => {
  it("groups Read under search", () => {
    const group = getToolGroup("Read", { file_path: "/app/src/index.ts" });
    assert.ok(group);
    assert.equal(group.key, "search");
    assert.equal(group.title, "Searching codebase");
    assert.equal(group.itemDetail, "src/index.ts");
  });

  it("groups Glob under search", () => {
    const group = getToolGroup("Glob", { pattern: "**/*.ts" });
    assert.ok(group);
    assert.equal(group.key, "search");
    assert.equal(group.title, "Searching codebase");
    assert.equal(group.itemDetail, "**/*.ts");
  });

  it("groups Grep under search with quoted pattern", () => {
    const group = getToolGroup("Grep", { pattern: "TODO" });
    assert.ok(group);
    assert.equal(group.key, "search");
    assert.equal(group.itemDetail, '"TODO"');
  });

  it("groups Edit under edit", () => {
    const group = getToolGroup("Edit", { file_path: "/app/src/foo.ts" });
    assert.ok(group);
    assert.equal(group.key, "edit");
    assert.equal(group.title, "Editing files");
    assert.equal(group.itemDetail, "src/foo.ts");
  });

  it("groups Write under write", () => {
    const group = getToolGroup("Write", { file_path: "/app/src/new.ts" });
    assert.ok(group);
    assert.equal(group.key, "write");
    assert.equal(group.title, "Writing files");
  });

  it("groups Bash under bash", () => {
    const group = getToolGroup("Bash", { description: "Run tests", command: "npm test" });
    assert.ok(group);
    assert.equal(group.key, "bash");
    assert.equal(group.title, "Running commands");
    assert.equal(group.itemDetail, "Run tests");
  });

  it("uses command as Bash item detail when no description", () => {
    const group = getToolGroup("Bash", { command: "npm install" });
    assert.ok(group);
    assert.equal(group.itemDetail, "npm install");
  });

  it("returns 'command' as Bash item detail when no args", () => {
    const group = getToolGroup("Bash", {});
    assert.ok(group);
    assert.equal(group.itemDetail, "command");
  });

  it("groups GitHub MCP tools under github", () => {
    const group = getToolGroup("mcp__github__get_pull_request", {});
    assert.ok(group);
    assert.equal(group.key, "github");
    assert.equal(group.title, "Checking GitHub");
    assert.equal(group.itemDetail, "get_pull_request");
  });

  it("returns null for non-grouped tools", () => {
    assert.equal(getToolGroup("mcp__clack__list_repositories", {}), null);
    assert.equal(getToolGroup("mcp__sentry__search_issues", {}), null);
    assert.equal(getToolGroup("custom_tool", {}), null);
  });

  it("truncates long Grep patterns in itemDetail", () => {
    const longPattern = "a".repeat(50);
    const group = getToolGroup("Grep", { pattern: longPattern });
    assert.ok(group);
    assert.ok(group.itemDetail.length <= 35, "itemDetail should be truncated");
  });

  it("truncates long Bash descriptions in itemDetail", () => {
    const longDesc = "a".repeat(50);
    const group = getToolGroup("Bash", { description: longDesc });
    assert.ok(group);
    assert.ok(group.itemDetail.length <= 45, "itemDetail should be truncated");
  });
});

// ---------------------------------------------------------------------------
// getToolDetails
// ---------------------------------------------------------------------------
describe("getToolDetails", () => {
  it("returns channel link for fetch_channel_messages", () => {
    const details = getToolDetails("mcp__clack__fetch_channel_messages", { channel_id: "C12345" });
    assert.equal(details, "<#C12345>");
  });

  it("returns null for fetch_channel_messages without channel_id", () => {
    assert.equal(getToolDetails("mcp__clack__fetch_channel_messages", {}), null);
  });

  it("returns message link for fetch_slack_message", () => {
    const url = "https://slack.com/archives/C123/p456";
    const details = getToolDetails("mcp__clack__fetch_slack_message", { url });
    assert.equal(details, `<${url}|View message>`);
  });

  it("returns null for fetch_slack_message without url", () => {
    assert.equal(getToolDetails("mcp__clack__fetch_slack_message", {}), null);
  });

  it("returns PR link for GitHub pull_request tools", () => {
    const details = getToolDetails("mcp__github__get_pull_request", {
      owner: "org",
      repo: "my-repo",
      pullNumber: 42,
    });
    assert.equal(details, "<https://github.com/org/my-repo/pull/42|org/my-repo#42>");
  });

  it("returns null for GitHub PR tools with missing fields", () => {
    assert.equal(getToolDetails("mcp__github__get_pull_request", { owner: "org" }), null);
    assert.equal(getToolDetails("mcp__github__get_pull_request", { owner: "org", repo: "r" }), null);
    assert.equal(getToolDetails("mcp__github__get_pull_request", {}), null);
  });

  it("returns null for non-matching tools", () => {
    assert.equal(getToolDetails("Read", { file_path: "/foo" }), null);
    assert.equal(getToolDetails("Bash", { command: "echo hi" }), null);
    assert.equal(getToolDetails("mcp__clack__list_repositories", {}), null);
  });

  it("returns PR link for update_pull_request tool", () => {
    const details = getToolDetails("mcp__github__update_pull_request", {
      owner: "owner",
      repo: "repo",
      pullNumber: 7,
    });
    assert.equal(details, "<https://github.com/owner/repo/pull/7|owner/repo#7>");
  });
});
