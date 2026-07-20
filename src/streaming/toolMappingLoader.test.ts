import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { setLoadedPlugins } from "../plugins-core/state.js";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { PluginLoadResult, ToolMapping } from "../plugins-sdk/sdk.js";
import { resolve } from "node:path";
import { truncate } from "../text.js";
import {
  interpolateLabel,
  sanitizeArgValue,
  shortenPath,
  resolveConfig,
  applyArgConfigs,
  resolveLocalized,
  substituteEnvVars,
  loadToolMappings,
  resetToolMappingCache,
  registerArgEnricher,
  applyArgEnrichers,
  clearArgEnrichers,
  type ToolMappingConfig,
  type ResolvedArgConfig,
  type ToolArgs,
} from "./toolMappingLoader.js";

// ---------------------------------------------------------------------------
// interpolateLabel
// ---------------------------------------------------------------------------
describe("interpolateLabel", () => {
  describe("simple arg substitution", () => {
    it("substitutes a single arg", () => {
      assert.equal(
        interpolateLabel("Reading {file_path}", { file_path: "foo.ts" }),
        "Reading foo.ts",
      );
    });

    it("substitutes multiple args", () => {
      assert.equal(
        interpolateLabel("{action} {target}", { action: "Reading", target: "file" }),
        "Reading file",
      );
    });

    it("returns trimmed result when arg is missing (no trailing space)", () => {
      assert.equal(interpolateLabel("Reading {file_path}", {}), "Reading");
    });
  });

  describe("fallback chains", () => {
    it("uses first available arg", () => {
      assert.equal(
        interpolateLabel("{description|command|Running command}", {
          description: "Install deps",
          command: "npm install",
        }),
        "Install deps",
      );
    });

    it("falls back to second arg when first is missing", () => {
      assert.equal(
        interpolateLabel("{description|command|Running command}", {
          command: "npm test",
        }),
        "npm test",
      );
    });

    it("falls back to literal when all args are missing", () => {
      assert.equal(
        interpolateLabel("{description|command|Running command}", {}),
        "Running command",
      );
    });

    it("handles single-arg fallback to literal", () => {
      // "unknown" matches \w+ so it's treated as an arg lookup, not a literal.
      // Use a non-word string for a true literal fallback.
      assert.equal(interpolateLabel("{name|unknown value}", {}), "unknown value");
    });

    it("tries multiple arg names before literal", () => {
      assert.equal(
        interpolateLabel("{id|name|gate_id|experiment_id|…}", { gate_id: "my-gate" }),
        "my-gate",
      );
    });
  });

  describe("empty string args treated as missing", () => {
    it("skips empty string and uses next in chain", () => {
      assert.equal(
        interpolateLabel("{description|fallback text}", { description: "" }),
        "fallback text",
      );
    });

    it("skips empty string and uses next arg", () => {
      assert.equal(interpolateLabel("{first|second}", { first: "", second: "value" }), "value");
    });
  });

  describe("sanitization of interpolated values", () => {
    it("strips < > @ ! from arg values", () => {
      assert.equal(interpolateLabel("User {name}", { name: "<@U123>" }), "User U123");
    });

    it("strips newlines from arg values", () => {
      assert.equal(interpolateLabel("Cmd {cmd}", { cmd: "line1\nline2" }), "Cmd line1line2");
    });

    it("shortens paths in arg values", () => {
      assert.equal(
        interpolateLabel("Reading {file_path}", { file_path: "/home/user/project/src/index.ts" }),
        "Reading src/index.ts",
      );
    });

    it("does not truncate arg values without per-arg truncation config", () => {
      const longVal = "a".repeat(50);
      const result = interpolateLabel("Pattern {pattern}", { pattern: longVal });
      assert.equal(result, "Pattern " + longVal);
    });
  });

  describe("no final label truncation", () => {
    it("does not truncate long labels (mrkdwn links can be long)", () => {
      const template = "X".repeat(100);
      const result = interpolateLabel(template, {});
      assert.equal(result.length, 100);
    });

    it("does not truncate arg values by default", () => {
      const longVal = "a".repeat(50);
      const result = interpolateLabel("Prefix {val}", { val: longVal });
      assert.ok(!result.includes("…"));
    });

    it("truncates arg values when truncation map is provided", () => {
      const longVal = "a".repeat(50);
      const truncations = new Map([["val", 20]]);
      const result = interpolateLabel("Prefix {val}", { val: longVal }, truncations);
      assert.ok(result.includes("…"));
      assert.ok(result.length < 30);
    });
  });

  describe("edge cases", () => {
    it("returns static string unchanged (no placeholders)", () => {
      assert.equal(interpolateLabel("Listing repositories", {}), "Listing repositories");
    });

    it("handles adjacent placeholders", () => {
      assert.equal(interpolateLabel("{a}{b}", { a: "hello", b: "world" }), "helloworld");
    });

    it("handles empty template", () => {
      assert.equal(interpolateLabel("", {}), "");
    });

    it("handles template with only a placeholder", () => {
      assert.equal(interpolateLabel("{name}", { name: "test" }), "test");
    });

    it("handles literal-only fallback chain (no arg names)", () => {
      // "some literal text" contains spaces, so it's not a \w+ arg name —
      // treated as literal and returned as-is.
      assert.equal(interpolateLabel("{some literal text}", {}), "some literal text");
    });

    it("handles curly braces with no content gracefully", () => {
      // {} doesn't match the regex {[^}]+} (requires at least one char),
      // so it passes through as literal text.
      assert.equal(interpolateLabel("test {} end", {}), "test {} end");
    });
  });

  describe("broken mrkdwn link cleanup", () => {
    it("strips link when both URL and text are empty", () => {
      assert.equal(interpolateLabel("<{url}|{text}>", {}), "");
    });

    it("strips link when URL is empty but text exists", () => {
      assert.equal(interpolateLabel("<{url}|hello>", {}), "");
    });

    it("strips link when text is empty but URL exists", () => {
      assert.equal(interpolateLabel("<https://example.com|{text}>", {}), "");
    });

    it("returns text only when URL has empty path segments from missing args", () => {
      assert.equal(
        interpolateLabel("<https://github.com/{owner}/{repo}/pull/{pr}|PR #{pr}>", {
          owner: "org",
        }),
        "PR #",
      );
    });

    it("preserves valid mrkdwn links", () => {
      assert.equal(
        interpolateLabel("<https://example.com/ok|text>", {}),
        "<https://example.com/ok|text>",
      );
    });

    it("preserves link when all args are present", () => {
      assert.equal(
        interpolateLabel("<https://github.com/{owner}/{repo}/pull/{pr}|PR #{pr}>", {
          owner: "org",
          repo: "my-repo",
          pr: 42,
        }),
        "<https://github.com/org/my-repo/pull/42|PR #42>",
      );
    });
  });

  describe("dot-notation for nested args", () => {
    it("resolves a nested arg path", () => {
      assert.equal(
        interpolateLabel("Reading {params.path_id}", { params: { path_id: "my-gate" } }),
        "Reading my-gate",
      );
    });

    it("resolves deeply nested paths", () => {
      assert.equal(interpolateLabel("{a.b.c}", { a: { b: { c: "deep" } } }), "deep");
    });

    it("falls back when nested path is missing", () => {
      assert.equal(interpolateLabel("{params.path_id|…}", {}), "…");
    });

    it("falls back when intermediate key is missing", () => {
      assert.equal(interpolateLabel("{params.path_id|…}", { params: {} }), "…");
    });

    it("works in a fallback chain with flat args", () => {
      assert.equal(interpolateLabel("{params.path_id|id|…}", { id: "flat-id" }), "flat-id");
    });

    it("sanitizes nested values", () => {
      assert.equal(
        interpolateLabel("{params.path_id}", { params: { path_id: "<script>alert</script>" } }),
        "scriptalert/script",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// applyArgConfigs
// ---------------------------------------------------------------------------
describe("applyArgConfigs", () => {
  it("extracts a value using a regex pattern", () => {
    const configs = new Map<string, ResolvedArgConfig>([
      ["issueId", { from: "issueUrl", regex: /\/issues\/(\d+)/ }],
    ]);
    const { args } = applyArgConfigs(
      { issueUrl: "https://org.sentry.io/issues/7313838390/" },
      configs,
    );
    assert.equal(args.issueId, "7313838390");
  });

  it("aliases a nested value without regex", () => {
    const configs = new Map<string, ResolvedArgConfig>([["id", { from: "params.path_id" }]]);
    const { args } = applyArgConfigs({ params: { path_id: "my-gate" } }, configs);
    assert.equal(args.id, "my-gate");
  });

  it("does NOT override a real arg (real args win)", () => {
    const configs = new Map<string, ResolvedArgConfig>([
      ["issueId", { from: "issueUrl", regex: /\/issues\/(\d+)/ }],
    ]);
    const { args } = applyArgConfigs(
      { issueId: "real-id", issueUrl: "https://sentry.io/issues/999/" },
      configs,
    );
    assert.equal(args.issueId, "real-id");
  });

  it("skips extraction when source arg is missing", () => {
    const configs = new Map<string, ResolvedArgConfig>([
      ["issueId", { from: "issueUrl", regex: /\/issues\/(\d+)/ }],
    ]);
    const { args } = applyArgConfigs({}, configs);
    assert.equal(args.issueId, undefined);
  });

  it("skips extraction when regex doesn't match", () => {
    const configs = new Map<string, ResolvedArgConfig>([
      ["issueId", { from: "issueUrl", regex: /\/issues\/(\d+)/ }],
    ]);
    const { args } = applyArgConfigs({ issueUrl: "https://sentry.io/projects/" }, configs);
    assert.equal(args.issueId, undefined);
  });

  it("returns original args when no configs", () => {
    const original = { foo: "bar" };
    const { args } = applyArgConfigs(original, new Map());
    assert.deepEqual(args, original);
  });

  it("collects truncation limits", () => {
    const configs = new Map<string, ResolvedArgConfig>([
      ["file_path", { truncate: 40 }],
      ["pattern", { truncate: 30 }],
    ]);
    const { truncations } = applyArgConfigs({}, configs);
    assert.equal(truncations.get("file_path"), 40);
    assert.equal(truncations.get("pattern"), 30);
  });
});

// ---------------------------------------------------------------------------
// sanitizeArgValue
// ---------------------------------------------------------------------------
describe("sanitizeArgValue", () => {
  it("strips < and > characters", () => {
    assert.equal(sanitizeArgValue("<hello>"), "hello");
  });

  it("strips @ and ! characters", () => {
    assert.equal(sanitizeArgValue("@user!"), "user");
  });

  it("strips newlines", () => {
    assert.equal(sanitizeArgValue("line1\nline2\rline3"), "line1line2line3");
  });

  it("shortens paths with more than 2 segments", () => {
    assert.equal(sanitizeArgValue("/a/b/c/d.ts"), "c/d.ts");
  });

  it("keeps short paths unchanged", () => {
    assert.equal(sanitizeArgValue("a/b"), "a/b");
  });

  it("does NOT truncate by default (truncation is per-arg config)", () => {
    const long = "a".repeat(50);
    const result = sanitizeArgValue(long);
    assert.equal(result.length, 50);
  });

  it("truncates when maxLength is provided", () => {
    const long = "a".repeat(50);
    const result = sanitizeArgValue(long, 40);
    assert.equal(result.length, 40);
    assert.ok(result.endsWith("…"));
  });

  it("does not shorten or truncate URLs", () => {
    const url = "https://myorg.sentry.io/issues/7313838390/";
    assert.equal(sanitizeArgValue(url), url);
  });

  it("passes through normal values unchanged", () => {
    assert.equal(sanitizeArgValue("normal-value"), "normal-value");
  });

  it("handles combined sanitization (strip + shorten)", () => {
    const input = "</very/long/deeply/nested/file.ts>";
    const result = sanitizeArgValue(input);
    assert.ok(!result.includes("<"));
    assert.ok(!result.includes(">"));
    assert.equal(result, "nested/file.ts");
  });
});

// ---------------------------------------------------------------------------
// shortenPath (helper)
// ---------------------------------------------------------------------------
describe("shortenPath", () => {
  it("shows last 2 segments for long paths", () => {
    assert.equal(shortenPath("/a/b/c/d/file.ts"), "d/file.ts");
  });

  it("keeps paths with 2 or fewer segments", () => {
    assert.equal(shortenPath("a/b"), "a/b");
    assert.equal(shortenPath("file.ts"), "file.ts");
  });

  it("handles exactly 3 segments", () => {
    assert.equal(shortenPath("a/b/c"), "b/c");
  });
});

// ---------------------------------------------------------------------------
// truncate (helper)
// ---------------------------------------------------------------------------
describe("truncate", () => {
  it("passes through strings under max", () => {
    assert.equal(truncate("short", 10), "short");
  });

  it("truncates strings over max with ellipsis", () => {
    assert.equal(truncate("hello world", 8), "hello w…");
  });

  it("handles exact length", () => {
    assert.equal(truncate("exact", 5), "exact");
  });
});

// ---------------------------------------------------------------------------
// substituteEnvVars
// ---------------------------------------------------------------------------
describe("substituteEnvVars", () => {
  it("replaces ${VAR} with env value", () => {
    process.env.__TEST_METABASE_URL = "https://metabase.example.com";
    try {
      assert.equal(
        substituteEnvVars("Reading <${__TEST_METABASE_URL}/question/{card_id}|link>"),
        "Reading <https://metabase.example.com/question/{card_id}|link>",
      );
    } finally {
      delete process.env.__TEST_METABASE_URL;
    }
  });

  it("replaces multiple vars in one string", () => {
    process.env.__TEST_A = "hello";
    process.env.__TEST_B = "world";
    try {
      assert.equal(substituteEnvVars("${__TEST_A} ${__TEST_B}"), "hello world");
    } finally {
      delete process.env.__TEST_A;
      delete process.env.__TEST_B;
    }
  });

  it("replaces missing env var with empty string", () => {
    delete process.env.__TEST_MISSING;
    assert.equal(substituteEnvVars("prefix-${__TEST_MISSING}-suffix"), "prefix--suffix");
  });

  it("passes through strings with no env vars unchanged", () => {
    assert.equal(substituteEnvVars("no vars here {arg}"), "no vars here {arg}");
  });

  it("does not confuse {arg} placeholders with ${ENV} vars", () => {
    assert.equal(substituteEnvVars("{card_id} vs ${__TEST_MISSING}"), "{card_id} vs ");
  });
});

// ---------------------------------------------------------------------------
// resolveConfig
// ---------------------------------------------------------------------------
describe("resolveConfig", () => {
  it("parses string tool entries as labels", () => {
    const resolved = resolveConfig({ tools: { myTool: "My label" } }, "test");
    assert.equal(resolved.labels.get("myTool"), "My label");
    assert.equal(resolved.toolGroups.has("myTool"), false);
  });

  it("parses object tool entries with group and itemDetail", () => {
    const resolved = resolveConfig(
      {
        tools: { Read: { label: "Reading {file}", group: "search", itemDetail: "{file}" } },
        groups: { search: "Searching codebase" },
      },
      "test",
    );
    assert.equal(resolved.labels.get("Read"), "Reading {file}");
    const group = resolved.toolGroups.get("Read");
    assert.ok(group);
    assert.equal(group.groupKey, "search");
    assert.equal(group.itemDetail, "{file}");
    assert.equal(resolved.groupTitles.get("search"), "Searching codebase");
  });

  it("creates file-level group from 'group' shorthand", () => {
    const resolved = resolveConfig({ group: "Checking GitHub" }, "github");
    assert.ok(resolved.fileGroup);
    assert.equal(resolved.fileGroup.key, "github");
    assert.equal(resolved.fileGroup.title, "Checking GitHub");
    assert.equal(resolved.groupTitles.get("github"), "Checking GitHub");
  });

  it("populates hidden set", () => {
    const resolved = resolveConfig({ hidden: ["submit_response", "report_status"] }, "test");
    assert.ok(resolved.hidden.has("submit_response"));
    assert.ok(resolved.hidden.has("report_status"));
    assert.equal(resolved.hidden.size, 2);
  });

  it("adds tool entries with hidden: true to the hidden set", () => {
    const resolved = resolveConfig(
      {
        tools: {
          visible_tool: { label: "Visible" },
          hidden_tool: { label: "Hidden fallback", hidden: true },
        },
      },
      "test",
    );
    assert.equal(resolved.hidden.has("hidden_tool"), true);
    assert.equal(resolved.hidden.has("visible_tool"), false);
    assert.equal(resolved.labels.get("hidden_tool"), "Hidden fallback");
  });

  it("merges entry-level hidden with config-level hidden array", () => {
    const resolved = resolveConfig(
      {
        hidden: ["foo"],
        tools: { bar: { label: "Bar", hidden: true } },
      },
      "test",
    );
    assert.ok(resolved.hidden.has("foo"));
    assert.ok(resolved.hidden.has("bar"));
  });

  it("sets defaultLabel from 'default' field", () => {
    const resolved = resolveConfig({ default: "Checking Sentry" }, "test");
    assert.equal(resolved.defaultLabel, "Checking Sentry");
  });

  it("parses argOptions with valid regex", () => {
    const resolved = resolveConfig(
      {
        argOptions: { issueId: { from: "issueUrl", pattern: "/issues/(\\d+)" } },
      },
      "test",
    );
    const config = resolved.argConfigs.get("issueId");
    assert.ok(config);
    assert.equal(config.from, "issueUrl");
    assert.ok(config.regex instanceof RegExp);
  });

  it("skips argOptions with invalid regex", () => {
    const resolved = resolveConfig(
      {
        argOptions: { bad: { from: "src", pattern: "([invalid" } },
      },
      "test",
    );
    assert.equal(resolved.argConfigs.has("bad"), false);
  });

  it("handles empty config gracefully", () => {
    const resolved = resolveConfig({}, "empty");
    assert.equal(resolved.labels.size, 0);
    assert.equal(resolved.toolGroups.size, 0);
    assert.equal(resolved.hidden.size, 0);
    assert.equal(resolved.conditionalHidden.length, 0);
    assert.equal(resolved.defaultLabel, undefined);
    assert.equal(resolved.fileGroup, undefined);
  });

  describe("conditionalHidden", () => {
    it("parses valid rules with pre-compiled regex", () => {
      const resolved = resolveConfig(
        {
          conditionalHidden: [{ tool: "Read", arg: "file_path", pattern: "^tool-results/" }],
        },
        "test",
      );
      assert.equal(resolved.conditionalHidden.length, 1);
      assert.equal(resolved.conditionalHidden[0].tool, "Read");
      assert.equal(resolved.conditionalHidden[0].arg, "file_path");
      assert.ok(resolved.conditionalHidden[0].regex instanceof RegExp);
      assert.ok(resolved.conditionalHidden[0].regex.test("tool-results/mcp-metabase-123"));
    });

    it("skips rules with invalid regex patterns", () => {
      const resolved = resolveConfig(
        {
          conditionalHidden: [
            { tool: "Read", arg: "file_path", pattern: "([invalid" },
            { tool: "Bash", arg: "command", pattern: "^echo" },
          ],
        },
        "test",
      );
      assert.equal(resolved.conditionalHidden.length, 1);
      assert.equal(resolved.conditionalHidden[0].tool, "Bash");
    });

    it("handles empty conditionalHidden array", () => {
      const resolved = resolveConfig({ conditionalHidden: [] }, "test");
      assert.equal(resolved.conditionalHidden.length, 0);
    });

    it("handles multiple valid rules", () => {
      const resolved = resolveConfig(
        {
          conditionalHidden: [
            { tool: "Read", arg: "file_path", pattern: "^tool-results/" },
            { tool: "Read", arg: "file_path", pattern: "^/tmp/" },
          ],
        },
        "test",
      );
      assert.equal(resolved.conditionalHidden.length, 2);
    });
  });
});

// ---------------------------------------------------------------------------
// Default config validation (Layer 2)
// ---------------------------------------------------------------------------

const TOOL_MAPPING_DIR = resolve(process.cwd(), "data/default_configuration/tool_mapping");
const GENERIC_ARGS: Record<string, unknown> = {
  file_path: "/a/b/c.ts",
  pattern: "foo",
  description: "test",
  id: "test-id",
  name: "test-name",
  command: "npm test",
  skill: "commit",
  board_id: "board-1",
  gate_id: "gate-1",
  experiment_id: "exp-1",
  config_id: "config-1",
};

describe("shipped default tool mapping configs", () => {
  const files = readdirSync(TOOL_MAPPING_DIR).filter((f) => f.endsWith(".json"));

  it("has at least one config file", () => {
    assert.ok(files.length > 0, "No config files found");
  });

  for (const file of files) {
    const serverName = file.replace(".json", "");

    describe(file, () => {
      let config: ToolMappingConfig;

      it("parses as valid JSON", () => {
        const raw = readFileSync(resolve(TOOL_MAPPING_DIR, file), "utf-8");
        config = JSON.parse(raw) as ToolMappingConfig;
      });

      it("has valid schema structure", () => {
        // tools must be an object if present
        if (config.tools !== undefined) {
          assert.equal(typeof config.tools, "object");
          assert.ok(!Array.isArray(config.tools), "tools must be a Record, not an array");
        }

        // hidden must be a string array if present
        if (config.hidden !== undefined) {
          assert.ok(Array.isArray(config.hidden), "hidden must be an array");
          for (const h of config.hidden) {
            assert.equal(typeof h, "string", `hidden entry must be a string, got ${typeof h}`);
          }
        }

        // conditionalHidden must be an array of valid rule objects if present
        if (config.conditionalHidden !== undefined) {
          assert.ok(Array.isArray(config.conditionalHidden), "conditionalHidden must be an array");
          for (const rule of config.conditionalHidden) {
            assert.equal(typeof rule.tool, "string", "rule.tool must be a string");
            assert.equal(typeof rule.arg, "string", "rule.arg must be a string");
            assert.equal(typeof rule.pattern, "string", "rule.pattern must be a string");
            // Validate that the pattern compiles
            assert.doesNotThrow(
              () => new RegExp(rule.pattern),
              `Invalid regex pattern: ${rule.pattern}`,
            );
          }
        }

        // A LocalizedString is either a plain string or a `{ lang: string }` map.
        const assertLocalized = (val: unknown, ctx: string) => {
          if (typeof val === "string") return;
          assert.ok(
            typeof val === "object" && val !== null && !Array.isArray(val),
            `${ctx} must be a string or language map`,
          );
          for (const [lang, str] of Object.entries(val as Record<string, unknown>)) {
            assert.equal(typeof str, "string", `${ctx}.${lang} must be a string`);
          }
        };

        // default must be a LocalizedString if present
        if (config.default !== undefined) {
          assertLocalized(config.default, "default");
        }

        // group must be a LocalizedString if present
        if (config.group !== undefined) {
          assertLocalized(config.group, "group");
        }

        // groups values may be a title string OR { title, maxDetails? } object
        if (config.groups !== undefined) {
          assert.equal(typeof config.groups, "object");
          for (const [key, val] of Object.entries(config.groups)) {
            assert.equal(typeof key, "string");
            if (typeof val === "string") {
              // legacy string form
            } else {
              assert.equal(typeof val, "object", `groups["${key}"] must be string or object`);
              assertLocalized(val.title, `groups["${key}"].title`);
              if (val.maxDetails !== undefined) {
                assert.equal(
                  typeof val.maxDetails,
                  "number",
                  `groups["${key}"].maxDetails must be a number`,
                );
              }
            }
          }
        }
      });

      it("every tool entry interpolates to a non-empty string with empty args", () => {
        if (!config.tools) return;
        for (const [toolName, entry] of Object.entries(config.tools)) {
          const template = resolveLocalized(typeof entry === "string" ? entry : entry.label);
          const result = interpolateLabel(template, {});
          assert.ok(
            result.length > 0,
            `Tool "${toolName}" produced empty label with empty args (template: "${template}")`,
          );
        }
      });

      it("every tool entry interpolates to a non-empty string with generic args", () => {
        if (!config.tools) return;
        for (const [toolName, entry] of Object.entries(config.tools)) {
          const template = resolveLocalized(typeof entry === "string" ? entry : entry.label);
          const result = interpolateLabel(template, GENERIC_ARGS);
          assert.ok(
            result.length > 0,
            `Tool "${toolName}" produced empty label with generic args (template: "${template}")`,
          );
        }
      });

      it("every tool with a group reference has a matching group definition", () => {
        if (!config.tools) return;
        const resolved = resolveConfig(config, serverName);

        for (const [toolName, entry] of Object.entries(config.tools)) {
          if (typeof entry === "object" && entry.group) {
            assert.ok(
              resolved.groupTitles.has(entry.group),
              `Tool "${toolName}" references group "${entry.group}" but no matching group title found`,
            );
          }
        }
      });

      it("default label interpolates to a non-empty string if present", () => {
        if (!config.default) return;
        const result = interpolateLabel(resolveLocalized(config.default), {});
        assert.ok(
          result.length > 0,
          `Default label produced empty string (template: "${config.default}")`,
        );
      });
    });
  }
});

// ---------------------------------------------------------------------------
// resolveLocalized — language-aware label resolution
// ---------------------------------------------------------------------------

describe("resolveLocalized", () => {
  it("passes plain strings through unchanged", () => {
    assert.equal(resolveLocalized("Reading file {path}", "fr"), "Reading file {path}");
  });

  it("picks the requested language from a language map", () => {
    const value = { en: "Reading file", fr: "Lecture du fichier" };
    assert.equal(resolveLocalized(value, "fr"), "Lecture du fichier");
    assert.equal(resolveLocalized(value, "en"), "Reading file");
  });

  it("falls back to en when the requested language is absent", () => {
    assert.equal(resolveLocalized({ en: "Save", fr: "Enregistrer" }, "de"), "Save");
  });

  it("falls back to any present value when en is also absent", () => {
    assert.equal(resolveLocalized({ fr: "Enregistrer" }, "de"), "Enregistrer");
  });

  it("returns undefined for undefined input", () => {
    assert.equal(resolveLocalized(undefined, "fr"), undefined);
  });

  it("preserves {placeholders} for downstream interpolation", () => {
    const resolved = resolveLocalized({ en: "Reading {repo}", fr: "Lecture de {repo}" }, "fr");
    assert.equal(interpolateLabel(resolved, { repo: "clack" }), "Lecture de clack");
  });
});

describe("resolveConfig with language maps", () => {
  it("resolves label, itemDetail, group title, and default for the active language", () => {
    const config: ToolMappingConfig = {
      tools: {
        do_thing: {
          label: { en: "Doing thing {x}", fr: "Action sur {x}" },
          group: "g1",
          itemDetail: { en: "thing {x}", fr: "chose {x}" },
        },
        plain: "Plain {y}",
      },
      groups: { g1: { title: { en: "Group One", fr: "Groupe Un" } } },
      default: { en: "Running {tool}", fr: "Exécution de {tool}" },
    };
    // Default language in tests is "en" (getConfig() unavailable → falls back to en).
    const resolved = resolveConfig(config, "test");
    assert.equal(resolved.labels.get("do_thing"), "Doing thing {x}");
    assert.equal(resolved.labels.get("plain"), "Plain {y}");
    assert.equal(resolved.toolGroups.get("do_thing")?.itemDetail, "thing {x}");
    assert.equal(resolved.groupTitles.get("g1"), "Group One");
    assert.equal(resolved.defaultLabel, "Running {tool}");
  });
});

// ---------------------------------------------------------------------------
// loadToolMappings — error handling
// ---------------------------------------------------------------------------

const USER_TOOL_MAPPING_DIR = resolve(process.cwd(), "data/configuration/tool_mapping");

describe("loadToolMappings error handling", () => {
  afterEach(() => {
    // Clean up any test files
    const badFile = resolve(USER_TOOL_MAPPING_DIR, "_test_malformed.json");
    if (existsSync(badFile)) rmSync(badFile);
    const appleDouble = resolve(USER_TOOL_MAPPING_DIR, "._github.json");
    if (existsSync(appleDouble)) rmSync(appleDouble);
    const emacsLock = resolve(USER_TOOL_MAPPING_DIR, ".#github.json");
    if (existsSync(emacsLock)) rmSync(emacsLock);
    resetToolMappingCache();
  });

  it("skips hidden dotfiles (._*.json, .#*.json, etc.)", () => {
    mkdirSync(USER_TOOL_MAPPING_DIR, { recursive: true });

    writeFileSync(resolve(USER_TOOL_MAPPING_DIR, "._github.json"), "binary apple metadata");
    writeFileSync(resolve(USER_TOOL_MAPPING_DIR, ".#github.json"), "emacs lock symlink target");

    resetToolMappingCache();
    const mappings = loadToolMappings();

    // Hidden files should not be parsed or registered under any key
    assert.equal(mappings.has("._github"), false);
    assert.equal(mappings.has(".#github"), false);
    // The real github mapping should still load from defaults
    assert.ok(mappings.has("github"), "Shipped github.json should still load");
  });

  it("skips malformed JSON files and loads valid ones", () => {
    // Ensure the user override dir exists
    mkdirSync(USER_TOOL_MAPPING_DIR, { recursive: true });

    // Write a malformed JSON file
    writeFileSync(
      resolve(USER_TOOL_MAPPING_DIR, "_test_malformed.json"),
      "{ this is not valid json !!!",
    );

    resetToolMappingCache();
    const mappings = loadToolMappings();

    // The malformed file should be skipped — no entry for "_test_malformed"
    assert.equal(mappings.has("_test_malformed"), false);

    // Valid shipped configs should still load
    assert.ok(mappings.has("_builtins"), "Shipped _builtins.json should still load");
    assert.ok(mappings.has("github"), "Shipped github.json should still load");
  });

  it("user override fully replaces default for the same filename", () => {
    mkdirSync(USER_TOOL_MAPPING_DIR, { recursive: true });

    // Write a minimal override that replaces _builtins
    const overridePath = resolve(USER_TOOL_MAPPING_DIR, "_test_malformed.json");
    writeFileSync(
      overridePath,
      JSON.stringify({
        tools: { TestTool: "Test label" },
      }),
    );

    resetToolMappingCache();
    const mappings = loadToolMappings();

    const mapping = mappings.get("_test_malformed");
    assert.ok(mapping, "User config should be loaded");
    assert.equal(mapping.labels.get("TestTool"), "Test label");
  });
});

// ---------------------------------------------------------------------------
// loadToolMappings — plugin mappings keyed by plugin server name
// ---------------------------------------------------------------------------

describe("loadToolMappings plugin integration", () => {
  function stubPluginLoadResult(
    name: string,
    toolMappings: Map<string, ToolMapping>,
  ): PluginLoadResult {
    return {
      name,
      instructions: [],
      tools: [],
      mcpServers: [],
      toolMappings,
      mcpServer: createSdkMcpServer({ name, version: "1.0.0", tools: [] }),
      actionHandlers: [],
      viewHandlers: [],
      errors: [],
    };
  }

  afterEach(() => {
    setLoadedPlugins({ results: [] });
    resetToolMappingCache();
  });

  it("plugin tool mappings are accessible under the plugin server name", () => {
    const toolMappings = new Map<string, string>([
      ["submit_answers", "Submitting {questionId}"],
      ["save_question", "Saving question"],
    ]);
    setLoadedPlugins({ results: [stubPluginLoadResult("trivia", toolMappings)] });

    resetToolMappingCache();
    const mappings = loadToolMappings();

    const triviaMapping = mappings.get("trivia");
    assert.ok(triviaMapping, "plugin mapping entry should exist under plugin name");
    assert.equal(triviaMapping.labels.get("submit_answers"), "Submitting {questionId}");
    assert.equal(triviaMapping.labels.get("save_question"), "Saving question");
  });

  it("plugin mappings do not leak into the clack entry", () => {
    const toolMappings = new Map<string, string>([["submit_answers", "Submitting answers"]]);
    setLoadedPlugins({ results: [stubPluginLoadResult("trivia", toolMappings)] });

    resetToolMappingCache();
    const mappings = loadToolMappings();

    const clackMapping = mappings.get("clack");
    // clack mapping may or may not exist (depends on shipped config) — but it must not contain
    // the plugin tool's label under the clack key.
    if (clackMapping) {
      assert.equal(
        clackMapping.labels.get("submit_answers"),
        undefined,
        "plugin tool label must not leak into clack mapping",
      );
    }
  });

  it("file-based plugin config fills precedence over programmatic mappings", () => {
    // File-based config for the plugin lives under the plugin name
    mkdirSync(USER_TOOL_MAPPING_DIR, { recursive: true });
    const pluginFileConfig = resolve(USER_TOOL_MAPPING_DIR, "trivia.json");
    writeFileSync(
      pluginFileConfig,
      JSON.stringify({
        tools: { submit_answers: "File-based label" },
      }),
    );

    try {
      const toolMappings = new Map<string, string>([
        ["submit_answers", "Programmatic label"],
        ["save_question", "Programmatic save"],
      ]);
      setLoadedPlugins({ results: [stubPluginLoadResult("trivia", toolMappings)] });

      resetToolMappingCache();
      const mappings = loadToolMappings();

      const triviaMapping = mappings.get("trivia");
      assert.ok(triviaMapping);
      // File-based config wins for the tool it defines
      assert.equal(triviaMapping.labels.get("submit_answers"), "File-based label");
      // Programmatic entry fills in for the tool the file doesn't cover
      assert.equal(triviaMapping.labels.get("save_question"), "Programmatic save");
    } finally {
      if (existsSync(pluginFileConfig)) rmSync(pluginFileConfig);
    }
  });

  it("on-demand server tools are keyed under `<plugin>_<serverKey>`", () => {
    const toolMappings = new Map<string, string>([
      ["save_question", "Saving question"],
      ["upsert_game", "Upserting game — {name}"],
      ["delete_game", "Deleting game — {name}"],
    ]);
    const result = stubPluginLoadResult("trivia", toolMappings);
    result.tools = [
      { name: "save_question", minRole: "admin", serverKey: undefined, pushTo: () => {} },
      { name: "upsert_game", minRole: "admin", serverKey: "management", pushTo: () => {} },
      { name: "delete_game", minRole: "admin", serverKey: "management", pushTo: () => {} },
    ];
    setLoadedPlugins({ results: [result] });

    resetToolMappingCache();
    const mappings = loadToolMappings();

    const defaultMapping = mappings.get("trivia");
    assert.ok(defaultMapping, "default server mapping should live under plugin name");
    assert.equal(defaultMapping.labels.get("save_question"), "Saving question");
    assert.equal(defaultMapping.labels.get("upsert_game"), undefined);

    const managementMapping = mappings.get("trivia_management");
    assert.ok(managementMapping, "on-demand server mapping should live under `<plugin>_<key>`");
    assert.equal(managementMapping.labels.get("upsert_game"), "Upserting game — {name}");
    assert.equal(managementMapping.labels.get("delete_game"), "Deleting game — {name}");
  });
});

// ---------------------------------------------------------------------------
// args enricher hook
// ---------------------------------------------------------------------------
describe("argEnrichers", () => {
  afterEach(() => {
    clearArgEnrichers();
  });

  it("returns args unchanged when no enricher is registered", () => {
    const args: ToolArgs = { id: "abc" };
    const result = applyArgEnrichers("mcp__foo__bar", args);
    assert.deepEqual(result, { id: "abc" });
  });

  it("augments args via a registered enricher", () => {
    registerArgEnricher("mcp__foo__bar", (args) => ({ ...args, name: "looked up" }));
    const result = applyArgEnrichers("mcp__foo__bar", { id: "abc" });
    assert.deepEqual(result, { id: "abc", name: "looked up" });
  });

  it("composes multiple enrichers in registration order", () => {
    registerArgEnricher("mcp__foo__bar", (args) => ({ ...args, first: 1 }));
    registerArgEnricher("mcp__foo__bar", (args) => ({ ...args, second: 2 }));
    const result = applyArgEnrichers("mcp__foo__bar", { id: "abc" });
    assert.deepEqual(result, { id: "abc", first: 1, second: 2 });
  });

  it("is idempotent on same-reference registration", () => {
    const fn = (args: ToolArgs): ToolArgs => ({ ...args, count: 1 });
    registerArgEnricher("mcp__foo__bar", fn);
    registerArgEnricher("mcp__foo__bar", fn);
    const result = applyArgEnrichers("mcp__foo__bar", {});
    assert.deepEqual(result, { count: 1 });
  });

  it("falls back gracefully when an enricher throws", () => {
    registerArgEnricher("mcp__foo__bar", () => {
      throw new Error("boom");
    });
    const result = applyArgEnrichers("mcp__foo__bar", { id: "abc" });
    assert.deepEqual(result, { id: "abc" });
  });

  it("continues with later enrichers after one throws", () => {
    registerArgEnricher("mcp__foo__bar", () => {
      throw new Error("boom");
    });
    registerArgEnricher("mcp__foo__bar", (args) => ({ ...args, second: 2 }));
    const result = applyArgEnrichers("mcp__foo__bar", { id: "abc" });
    assert.deepEqual(result, { id: "abc", second: 2 });
  });

  it("clearArgEnrichers resets state", () => {
    registerArgEnricher("mcp__foo__bar", (args) => ({ ...args, name: "x" }));
    clearArgEnrichers();
    const result = applyArgEnrichers("mcp__foo__bar", { id: "abc" });
    assert.deepEqual(result, { id: "abc" });
  });
});
