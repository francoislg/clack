import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getDataDir } from "./config.js";
import { logger } from "./logger.js";

/**
 * Member-authored "user skills" stored outside the SDK `skill-plugins/` tree so they
 * can hot-reload without re-baking the SDK plugin set. One directory per skill at
 * `data/user-skills/<slug>/` with `SKILL.md` (frontmatter + body) and `.meta.json`
 * (ownership + timestamps + optional `disabledAt`).
 *
 * Triggers (frontmatter `description`) are always-in-context — they render into the
 * per-turn `AVAILABLE SKILL PACKS` block as a `USER SKILLS:` subsection. Bodies are
 * loaded on demand via the existing `load_skill` tool (extended to accept
 * `pack: "user-skills"`), with an mtime-keyed cache that picks up edits without
 * needing a session restart.
 */

export interface UserSkill {
  slug: string;
  description: string;
  body: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp; presence ⇒ disabled (soft-deleted). */
  disabledAt?: string;
  /** When true, any member+ may edit this skill's content (not just owner/admins). Absent ⇒ false. */
  editableByAnyone?: boolean;
}

export interface UserSkillMeta {
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
  editableByAnyone?: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SLUG_MAX = 64;
const DESCRIPTION_MAX = 1024;

export function validateSlug(slug: string): ValidationResult {
  if (typeof slug !== "string" || slug.length === 0) {
    return { ok: false, reason: "Skill name is required" };
  }
  if (slug.length > SLUG_MAX) {
    return { ok: false, reason: `Skill name must be ${SLUG_MAX} characters or fewer` };
  }
  if (slug.includes("--")) {
    return { ok: false, reason: "Skill name must not contain consecutive hyphens" };
  }
  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      reason:
        "Skill name must be lowercase a-z, digits, or hyphens; must start and end with a letter or digit",
    };
  }
  return { ok: true };
}

export function validateDescription(desc: string): ValidationResult {
  if (typeof desc !== "string") {
    return { ok: false, reason: "Description is required" };
  }
  const trimmed = desc.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Description must not be empty" };
  }
  if (trimmed.length > DESCRIPTION_MAX) {
    return { ok: false, reason: `Description must be ${DESCRIPTION_MAX} characters or fewer` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/** Parse the leading `---`-fenced YAML block. Only `name` and `description` are read. */
function parseFrontmatter(body: string): { name?: string; description?: string } {
  const match = body.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const result: { name?: string; description?: string } = {};

  let currentKey: "name" | "description" | null = null;
  let currentValue = "";

  const flush = () => {
    if (!currentKey) return;
    result[currentKey] = stripYamlScalar(currentValue).trim();
    currentKey = null;
    currentValue = "";
  };

  for (const rawLine of lines) {
    const kv = rawLine.match(/^([a-zA-Z_][a-zA-Z_0-9]*):\s*(.*)$/);
    if (kv) {
      flush();
      const [, key, val] = kv;
      if (key === "name" || key === "description") {
        currentKey = key;
        currentValue = val;
      }
    } else if (currentKey) {
      currentValue += " " + rawLine.trim();
    }
  }
  flush();
  return result;
}

function stripYamlScalar(v: string): string {
  const trimmed = v.trim();
  if (trimmed === ">" || trimmed === "|" || trimmed === ">-" || trimmed === "|-") return "";
  if (
    (trimmed.startsWith(`"`) && trimmed.endsWith(`"`)) ||
    (trimmed.startsWith(`'`) && trimmed.endsWith(`'`))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractBody(skillMd: string): string {
  const match = skillMd.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  if (!match) return skillMd;
  return skillMd.slice(match[0].length);
}

function renderSkillMd(slug: string, description: string, body: string): string {
  const escapedDescription = description.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const trimmedBody = body.replace(/^\s+/, "").replace(/\s+$/, "") + "\n";
  return `---\nname: ${slug}\ndescription: "${escapedDescription}"\n---\n\n${trimmedBody}`;
}

/** Type guard for a parsed `.meta.json` payload. */
function isValidMetaShape(value: unknown): value is UserSkillMeta {
  if (typeof value !== "object" || value === null) return false;
  const v = value as {
    ownerUserId?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    disabledAt?: unknown;
    editableByAnyone?: unknown;
  };
  if (typeof v.ownerUserId !== "string") return false;
  if (typeof v.createdAt !== "string") return false;
  if (typeof v.updatedAt !== "string") return false;
  if (v.disabledAt !== undefined && typeof v.disabledAt !== "string") return false;
  if (v.editableByAnyone !== undefined && typeof v.editableByAnyone !== "boolean") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Dependency injection (mirrors src/skillPlugins.ts)
// ---------------------------------------------------------------------------

export interface UserSkillsDeps {
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: "utf-8" | "utf8") => string;
  writeFileSync: (path: string, data: string, encoding: "utf-8" | "utf8") => void;
  statSync: (path: string) => { isDirectory: () => boolean; mtimeMs: number };
  mkdirSync: (path: string, options?: { recursive: boolean }) => string | undefined;
  renameSync: (from: string, to: string) => void;
  getDataDir: () => string;
  now: () => Date;
}

export const defaultUserSkillsDeps: UserSkillsDeps = {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  mkdirSync,
  renameSync,
  getDataDir,
  now: () => new Date(),
};

let deps: UserSkillsDeps = defaultUserSkillsDeps;

export function setUserSkillsDeps(d: UserSkillsDeps): void {
  deps = d;
}

export function resetUserSkillsDeps(): void {
  deps = defaultUserSkillsDeps;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getUserSkillsDir(): string {
  return resolve(deps.getDataDir(), "user-skills");
}

function getSkillDir(slug: string): string {
  return join(getUserSkillsDir(), slug);
}

function getSkillMdPath(slug: string): string {
  return join(getSkillDir(slug), "SKILL.md");
}

function getMetaPath(slug: string): string {
  return join(getSkillDir(slug), ".meta.json");
}

// ---------------------------------------------------------------------------
// Discovery / reads
// ---------------------------------------------------------------------------

function readMeta(slug: string): UserSkillMeta | null {
  const path = getMetaPath(slug);
  if (!deps.existsSync(path)) return null;
  try {
    const raw = deps.readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isValidMetaShape(parsed)) return null;
    const result: UserSkillMeta = {
      ownerUserId: parsed.ownerUserId,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
    if (parsed.disabledAt !== undefined) result.disabledAt = parsed.disabledAt;
    if (parsed.editableByAnyone !== undefined) result.editableByAnyone = parsed.editableByAnyone;
    return result;
  } catch (error) {
    logger.debug(`Failed to read user-skill .meta.json for '${slug}': ${error}`);
    return null;
  }
}

function readSkillFromDisk(slug: string): UserSkill | null {
  const skillMdPath = getSkillMdPath(slug);
  if (!deps.existsSync(skillMdPath)) {
    logger.debug(`User-skill '${slug}' missing SKILL.md — skipped`);
    return null;
  }
  const meta = readMeta(slug);
  if (!meta) {
    logger.debug(`User-skill '${slug}' missing or invalid .meta.json — skipped`);
    return null;
  }

  let skillMd: string;
  try {
    skillMd = deps.readFileSync(skillMdPath, "utf-8");
  } catch (error) {
    logger.debug(`Failed to read SKILL.md for user-skill '${slug}': ${error}`);
    return null;
  }

  const fm = parseFrontmatter(skillMd);
  if (fm.name !== slug) {
    logger.debug(
      `User-skill '${slug}' frontmatter name mismatch (got '${fm.name ?? "<missing>"}') — skipped`,
    );
    return null;
  }
  if (!fm.description || fm.description.length === 0) {
    logger.debug(`User-skill '${slug}' missing frontmatter description — skipped`);
    return null;
  }

  return {
    slug,
    description: fm.description,
    body: extractBody(skillMd),
    ownerUserId: meta.ownerUserId,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    disabledAt: meta.disabledAt,
    editableByAnyone: meta.editableByAnyone,
  };
}

export function discoverUserSkills(): UserSkill[] {
  const dir = getUserSkillsDir();
  if (!deps.existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = deps.readdirSync(dir);
  } catch (error) {
    logger.warn(`Failed to enumerate user-skills directory: ${error}`);
    return [];
  }

  const skills: UserSkill[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry);
    let isDir = false;
    try {
      isDir = deps.statSync(entryPath).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    // Validate slug shape — directories with invalid slugs are ignored (defensive
    // against operator typos; we don't want them to crash discovery).
    if (!validateSlug(entry).ok) {
      logger.debug(`User-skill directory '${entry}' has an invalid slug — skipped`);
      continue;
    }

    const skill = readSkillFromDisk(entry);
    if (skill) skills.push(skill);
  }

  return skills;
}

export function readUserSkill(slug: string): UserSkill | null {
  if (!validateSlug(slug).ok) return null;
  return readSkillFromDisk(slug);
}

export function userSkillExists(slug: string): boolean {
  if (!validateSlug(slug).ok) return false;
  return deps.existsSync(getSkillDir(slug));
}

/**
 * mtime of the SKILL.md file in ms. Returns `null` when the file doesn't exist or
 * stat fails. Used by the body cache to detect external edits.
 */
export function getSkillMtimeMs(slug: string): number | null {
  if (!validateSlug(slug).ok) return null;
  const path = getSkillMdPath(slug);
  if (!deps.existsSync(path)) return null;
  try {
    return deps.statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Writes (atomic via tmp + rename)
// ---------------------------------------------------------------------------

function writeAtomic(path: string, contents: string): void {
  const tmp = `${path}.tmp`;
  deps.writeFileSync(tmp, contents, "utf-8");
  deps.renameSync(tmp, path);
}

export interface CreateUserSkillInput {
  slug: string;
  description: string;
  body: string;
  ownerUserId: string;
  editableByAnyone?: boolean;
}

export function writeUserSkill(input: CreateUserSkillInput): UserSkill {
  const slugCheck = validateSlug(input.slug);
  if (!slugCheck.ok) throw new Error(`Invalid skill name: ${slugCheck.reason}`);
  const descCheck = validateDescription(input.description);
  if (!descCheck.ok) throw new Error(`Invalid description: ${descCheck.reason}`);

  const dir = getSkillDir(input.slug);
  deps.mkdirSync(dir, { recursive: true });

  const now = deps.now().toISOString();
  const existingMeta = readMeta(input.slug);
  const editableByAnyone = input.editableByAnyone ?? existingMeta?.editableByAnyone;

  const meta: UserSkillMeta = existingMeta
    ? {
        ownerUserId: existingMeta.ownerUserId,
        createdAt: existingMeta.createdAt,
        updatedAt: now,
        ...(existingMeta.disabledAt !== undefined ? { disabledAt: existingMeta.disabledAt } : {}),
        ...(editableByAnyone ? { editableByAnyone: true } : {}),
      }
    : {
        ownerUserId: input.ownerUserId,
        createdAt: now,
        updatedAt: now,
        ...(editableByAnyone ? { editableByAnyone: true } : {}),
      };

  const description = input.description.trim();
  const body = input.body;
  const skillMd = renderSkillMd(input.slug, description, body);

  writeAtomic(getSkillMdPath(input.slug), skillMd);
  writeAtomic(getMetaPath(input.slug), JSON.stringify(meta, null, 2));

  return {
    slug: input.slug,
    description,
    body,
    ownerUserId: meta.ownerUserId,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    disabledAt: meta.disabledAt,
    editableByAnyone: meta.editableByAnyone,
  };
}

export interface UpdateUserSkillInput {
  slug: string;
  description?: string;
  body?: string;
  editableByAnyone?: boolean;
}

export function updateUserSkill(input: UpdateUserSkillInput): UserSkill {
  const existing = readUserSkill(input.slug);
  if (!existing) throw new Error(`Skill '${input.slug}' not found`);
  if (existing.disabledAt) {
    throw new Error(`Skill '${input.slug}' is disabled — restore it before updating`);
  }
  if (
    input.description === undefined &&
    input.body === undefined &&
    input.editableByAnyone === undefined
  ) {
    throw new Error("Update requires at least one of `description`, `body`, or `editableByAnyone`");
  }
  if (input.description !== undefined) {
    const descCheck = validateDescription(input.description);
    if (!descCheck.ok) throw new Error(`Invalid description: ${descCheck.reason}`);
  }

  const now = deps.now().toISOString();
  const newDescription = (input.description ?? existing.description).trim();
  const newBody = input.body ?? existing.body;
  const newEditableByAnyone = input.editableByAnyone ?? existing.editableByAnyone;
  const skillMd = renderSkillMd(existing.slug, newDescription, newBody);

  const meta: UserSkillMeta = {
    ownerUserId: existing.ownerUserId,
    createdAt: existing.createdAt,
    updatedAt: now,
    ...(newEditableByAnyone ? { editableByAnyone: true } : {}),
  };

  writeAtomic(getSkillMdPath(existing.slug), skillMd);
  writeAtomic(getMetaPath(existing.slug), JSON.stringify(meta, null, 2));

  return {
    slug: existing.slug,
    description: newDescription,
    body: newBody,
    ownerUserId: existing.ownerUserId,
    createdAt: existing.createdAt,
    updatedAt: now,
    editableByAnyone: newEditableByAnyone,
  };
}

export function disableUserSkill(slug: string): UserSkill {
  const existing = readUserSkill(slug);
  if (!existing) throw new Error(`Skill '${slug}' not found`);
  if (existing.disabledAt) throw new Error(`Skill '${slug}' is already disabled`);

  const now = deps.now().toISOString();
  const meta: UserSkillMeta = {
    ownerUserId: existing.ownerUserId,
    createdAt: existing.createdAt,
    updatedAt: now,
    disabledAt: now,
    ...(existing.editableByAnyone ? { editableByAnyone: true } : {}),
  };
  writeAtomic(getMetaPath(slug), JSON.stringify(meta, null, 2));

  return { ...existing, updatedAt: now, disabledAt: now };
}

export function restoreUserSkill(slug: string): UserSkill {
  const existing = readUserSkill(slug);
  if (!existing) throw new Error(`Skill '${slug}' not found`);
  if (!existing.disabledAt) throw new Error(`Skill '${slug}' is not disabled`);

  const now = deps.now().toISOString();
  const meta: UserSkillMeta = {
    ownerUserId: existing.ownerUserId,
    createdAt: existing.createdAt,
    updatedAt: now,
    ...(existing.editableByAnyone ? { editableByAnyone: true } : {}),
  };
  writeAtomic(getMetaPath(slug), JSON.stringify(meta, null, 2));

  return { ...existing, updatedAt: now, disabledAt: undefined };
}
