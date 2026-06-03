import { z } from "zod";
import { REPO_FILE_ENUM } from "../../repoInstructionFiles.js";

export const ROLE_ENUM = z.enum(["user", "dev", "admin", "owner"]);
export type ConfigRole = z.infer<typeof ROLE_ENUM>;

export { REPO_FILE_ENUM };
export type RepoFile = z.infer<typeof REPO_FILE_ENUM>;

export const TOPIC_PATTERN = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i, {
  message:
    "Invalid topic name. Topics must start with a letter or digit and contain only letters, digits, underscores, and hyphens.",
});

export const FILE_PATTERN = z.string().regex(/^[\w][\w.-]*\.md$/, {
  message:
    "Invalid filename. Must be a bare filename ending in `.md` (no slashes). For topic-scoped files, pass the `topic` field separately.",
});

/**
 * Shared field set for the config tools. Files are addressed either by role
 * (`role` + optional `topic` + `file`) or by repository (`repo` + `file`).
 * The two modes are mutually exclusive — enforced by `refineConfigTarget`.
 * `file` keeps `FILE_PATTERN` here (per-repo files are all `.md`); repo mode
 * further narrows it to `REPO_FILE_ENUM` in the refinement.
 */
export const CONFIG_TARGET_FIELDS = {
  role: ROLE_ENUM.optional().describe(
    "The role directory (one of: user, dev, admin, owner). Mutually exclusive with `repo`.",
  ),
  topic: TOPIC_PATTERN.optional().describe(
    "Optional topic name for topic-scoped instruction files (e.g., 'metabase'). Role mode only — omit for baseline and repo files.",
  ),
  repo: z
    .string()
    .optional()
    .describe(
      "The repository name, to edit a per-repo instruction file. Mutually exclusive with `role`/`topic`.",
    ),
  file: FILE_PATTERN.describe(
    "In role mode: a bare filename ending in `.md` (e.g., 'identity.md'), no slashes. In repo mode: one of changes_instructions.md, worktree_setup_instructions.md, worktree_install_instructions.md.",
  ),
} as const;

export interface ConfigTargetArgs {
  role?: ConfigRole;
  topic?: string;
  repo?: string;
  file: string;
}

/**
 * Cross-field validation the per-field schemas can't express: exactly one of
 * `role`/`repo`, no `topic` in repo mode, and repo-mode `file` restricted to
 * the editable set.
 */
export function refineConfigTarget(args: ConfigTargetArgs, ctx: z.RefinementCtx): void {
  const hasRole = args.role !== undefined;
  const hasRepo = args.repo !== undefined;

  if (hasRole === hasRepo) {
    ctx.addIssue({ code: "custom", message: "Provide exactly one of `role` or `repo`." });
    return;
  }

  if (hasRepo) {
    if (args.topic !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["topic"],
        message: "`topic` is not valid for repo-scoped files; omit it.",
      });
    }
    if (!REPO_FILE_ENUM.safeParse(args.file).success) {
      ctx.addIssue({
        code: "custom",
        path: ["file"],
        message: `In repo mode, \`file\` must be one of: ${REPO_FILE_ENUM.options.join(", ")}.`,
      });
    }
  }
}

export const CONFIG_TARGET_SCHEMA = z.object(CONFIG_TARGET_FIELDS).superRefine(refineConfigTarget);

/**
 * Run the cross-field refinement against already-per-field-validated handler
 * args. Returns an error message (issues joined) or `null` when valid.
 */
export function validateConfigTarget(args: ConfigTargetArgs): string | null {
  const result = CONFIG_TARGET_SCHEMA.safeParse(args);
  if (result.success) return null;
  return result.error.issues.map((i) => i.message).join(" ");
}

export function buildInstructionPath(
  role: ConfigRole,
  topic: string | undefined,
  file: string,
): string {
  return topic ? `${role}/topics/${topic}/${file}` : `${role}/${file}`;
}

/**
 * Resolve a validated config-target to its two-segment-or-four-segment path.
 * Repo mode → `{repo}/{file}`; role mode → `buildInstructionPath`.
 */
export function buildConfigPath(args: ConfigTargetArgs): string {
  if (args.repo !== undefined) {
    return `${args.repo}/${args.file}`;
  }
  return buildInstructionPath(args.role as ConfigRole, args.topic, args.file);
}
