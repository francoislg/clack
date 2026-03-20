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
      assert.equal(getToolLabel("Grep", {}), 'Searching for "codebase"');
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

    it("falls back to generic label for Bash when no description", () => {
      // Config-driven labels use {description|Running command} — command arg
      // is no longer used in the label template (design decision: simplified).
      assert.equal(
        getToolLabel("Bash", { command: "npm install" }),
        "Running command"
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
    it("returns dynamic labels for query tools with args", () => {
      assert.equal(getToolLabel("mcp__clack__git_log", { repo: "my-app" }), "Reading git history my-app");
      assert.equal(getToolLabel("mcp__clack__find_sessions", { repo: "api" }), "Finding sessions api");
      assert.equal(getToolLabel("mcp__clack__find_changes", { repo: "web" }), "Finding changes web");
      assert.equal(getToolLabel("mcp__clack__find_pull_requests", { repo: "web" }), "Finding pull requests web");
    });

    it("returns labels without repo when arg is missing", () => {
      assert.equal(getToolLabel("mcp__clack__git_log", {}), "Reading git history");
      assert.equal(getToolLabel("mcp__clack__list_repositories", {}), "Listing repositories");
      assert.equal(getToolLabel("mcp__clack__deepen_history", {}), "Loading more history");
      assert.equal(getToolLabel("mcp__clack__find_user", {}), "Looking up user");
      assert.equal(getToolLabel("mcp__clack__find_user", { query: ["john"] }), "Looking up user john");
    });

    it("returns Slack mrkdwn links for channel/message tools", () => {
      assert.equal(
        getToolLabel("mcp__clack__fetch_channel_messages", { channel_id: "C12345" }),
        "Reading messages in <#C12345>"
      );
      assert.equal(
        getToolLabel("mcp__clack__fetch_slack_message", { url: "https://slack.com/archives/C123/p456" }),
        "Reading <https://slack.com/archives/C123/p456|Slack message>"
      );
    });

    it("returns null for submit_response (excluded from task cards)", () => {
      assert.equal(getToolLabel("mcp__clack__submit_response", {}), null);
    });

    it("returns null for report_status (excluded from task cards)", () => {
      assert.equal(getToolLabel("mcp__clack__report_status", {}), null);
    });

    it("returns dynamic labels for action tools with repo", () => {
      assert.equal(getToolLabel("mcp__clack__propose_change", { repo: "api" }), "Proposing change api");
      assert.equal(getToolLabel("mcp__clack__request_update", {}), "Requesting update");
    });

    it("returns static labels for worker tools", () => {
      assert.equal(getToolLabel("mcp__clack__git_push", {}), "Pushing to remote");
      assert.equal(getToolLabel("mcp__clack__ensure_pr", {}), "Creating pull request");
      assert.equal(getToolLabel("mcp__clack__merge_pr", {}), "Merging pull request");
    });
  });

  describe("GitHub MCP tools", () => {
    it("returns label with linked PR number when all args present", () => {
      assert.equal(
        getToolLabel("mcp__github__get_pull_request", { owner: "org", repo: "my-repo", pullNumber: 42 }),
        "Reading <https://github.com/org/my-repo/pull/42|PR #42>"
      );
    });

    it("returns label without link when args are missing", () => {
      assert.equal(getToolLabel("mcp__github__get_pull_request", {}), "Reading PR #");
    });

    it("returns static labels for tools without dynamic args", () => {
      assert.equal(getToolLabel("mcp__github__create_pull_request", {}), "Creating pull request");
    });

    it("returns dynamic labels for search", () => {
      assert.equal(
        getToolLabel("mcp__github__search_code", { query: "hello" }),
        'Searching GitHub for "hello"'
      );
    });
  });

  describe("Sentry MCP tools", () => {
    it("returns static labels for tools without dynamic args", () => {
      assert.equal(getToolLabel("mcp__sentry__search_issues", {}), "Searching Sentry issues");
    });

    it("extracts issueId from issueUrl and produces mrkdwn link", () => {
      assert.equal(
        getToolLabel("mcp__sentry__get_issue_details", { issueUrl: "https://myorg.sentry.io/issues/7313838390/" }),
        "Reading Sentry issue <https://myorg.sentry.io/issues/7313838390/|7313838390>"
      );
    });

    it("returns label without issueId when no URL provided", () => {
      assert.equal(getToolLabel("mcp__sentry__get_issue_details", {}), "Reading Sentry issue");
    });

    it("uses default fallback for unknown Sentry tools", () => {
      assert.equal(getToolLabel("mcp__sentry__some_new_tool", {}), "Checking Sentry");
    });
  });

  describe("Statsig MCP tools", () => {
    it("extracts id from nested params.path_id via extractor", () => {
      assert.equal(
        getToolLabel("mcp__statsig__Get_Experiment_Details_by_ID", { params: { path_id: "my-experiment" } }),
        "Reading experiment my-experiment"
      );
    });

    it("uses real id arg over extracted one (real args win)", () => {
      assert.equal(
        getToolLabel("mcp__statsig__Get_Experiment_Details_by_ID", { id: "direct-id", params: { path_id: "nested" } }),
        "Reading experiment direct-id"
      );
    });

    it("returns ellipsis when no id source is available", () => {
      assert.equal(
        getToolLabel("mcp__statsig__Get_Gate_Details_by_ID", {}),
        "Reading gate \u2026"
      );
    });

    it("uses default fallback for unknown Statsig tools", () => {
      assert.equal(
        getToolLabel("mcp__statsig__Some_New_Endpoint", {}),
        "Checking Statsig feature flags"
      );
    });
  });

  describe("conditionalHidden", () => {
    it("hides Read when file_path matches tool-results/ pattern", () => {
      assert.equal(
        getToolLabel("Read", { file_path: "tool-results/mcp-metabase-retrieve-1774" }),
        null
      );
    });

    it("shows Read normally when file_path does not match tool-results/", () => {
      assert.equal(
        getToolLabel("Read", { file_path: "/app/src/index.ts" }),
        "Reading src/index.ts"
      );
    });

    it("shows Read normally when file_path is missing (arg not present)", () => {
      assert.equal(getToolLabel("Read", {}), "Reading file");
    });

    it("does not hide non-matching tools even with tool-results/ path", () => {
      // The rule is scoped to "Read" — Grep with a tool-results arg should not be hidden
      assert.notEqual(
        getToolLabel("Grep", { pattern: "tool-results/" }),
        null
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

  it("groups Bash under commands", () => {
    const group = getToolGroup("Bash", { description: "Run tests", command: "npm test" });
    assert.ok(group);
    assert.equal(group.key, "commands");
    assert.equal(group.title, "Running commands");
    assert.equal(group.itemDetail, "Run tests");
  });

  it("uses command as Bash item detail when no description", () => {
    const group = getToolGroup("Bash", { command: "npm install" });
    assert.ok(group);
    // itemDetail template: {description|command|command} → tries description (missing), uses command arg
    assert.equal(group.itemDetail, "npm install");
  });

  it("returns 'command' as Bash item detail when no args", () => {
    const group = getToolGroup("Bash", {});
    assert.ok(group);
    assert.equal(group.itemDetail, "command");
  });

  it("groups GitHub MCP tools under github with PR number", () => {
    const group = getToolGroup("mcp__github__get_pull_request", { pullNumber: 42 });
    assert.ok(group);
    assert.equal(group.key, "github");
    assert.equal(group.title, "Checking GitHub");
    assert.equal(group.itemDetail, "Reading PR #42");
  });

  it("returns null for non-grouped tools", () => {
    assert.equal(getToolGroup("mcp__clack__list_repositories", {}), null);
    assert.equal(getToolGroup("custom_tool", {}), null);
  });

  it("groups Sentry tools under sentry", () => {
    const group = getToolGroup("mcp__sentry__search_issues", {});
    assert.ok(group);
    assert.equal(group.key, "sentry");
    assert.equal(group.title, "Checking Sentry");
  });

  it("truncates long Grep patterns in itemDetail", () => {
    const longPattern = "a".repeat(50);
    const group = getToolGroup("Grep", { pattern: longPattern });
    assert.ok(group);
    // sanitizeArgValue truncates at 40 chars, plus surrounding quotes
    assert.ok(group.itemDetail.length <= 45, "itemDetail should be truncated");
    assert.ok(group.itemDetail.includes("…"), "Should contain ellipsis");
  });

  it("truncates long Bash descriptions in itemDetail per argOptions", () => {
    const longDesc = "a".repeat(70);
    const group = getToolGroup("Bash", { description: longDesc });
    assert.ok(group);
    // _builtins.json configures description with truncate: 60
    assert.ok(group.itemDetail.length <= 65, "itemDetail should be truncated per argOptions");
    assert.ok(group.itemDetail.includes("…"), "Should contain ellipsis");
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

  it("returns null for non-matching tools", () => {
    assert.equal(getToolDetails("Read", { file_path: "/foo" }), null);
    assert.equal(getToolDetails("Bash", { command: "echo hi" }), null);
    assert.equal(getToolDetails("mcp__clack__list_repositories", {}), null);
    assert.equal(getToolDetails("mcp__github__get_pull_request", {}), null);
    assert.equal(getToolDetails("mcp__sentry__search_issues", {}), null);
  });
});
