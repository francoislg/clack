import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { CONFIG_SCHEMA } from "./configSchema.js";

const SUPPORTED_FILES = ["config.json"] as const;
type SupportedFile = (typeof SUPPORTED_FILES)[number];

export function createAdminDescribeConfigFileTool() {
  return tool(
    "admin_describe_config_file",
    "Describe the schema of a Clack configuration file (field names, types, defaults, descriptions). " +
      `Currently supports: ${SUPPORTED_FILES.join(", ")}. ` +
      "Use this BEFORE editing a config file via admin_write_file or propose_config_update to learn what keys are valid.",
    {
      path: z
        .enum(SUPPORTED_FILES)
        .optional()
        .describe(
          `Which config file to describe. Defaults to 'config.json'. Supported: ${SUPPORTED_FILES.join(", ")}.`,
        ),
    },
    async ({ path }) => {
      const file: SupportedFile = path ?? "config.json";
      if (file === "config.json") {
        return textResult({ path: file, schema: CONFIG_SCHEMA });
      }
      // unreachable today; switch will need a new branch when SUPPORTED_FILES grows.
      return textResult({ path: file, error: "No schema available for this file." });
    },
  );
}
