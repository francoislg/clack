import { z } from "zod";

export const ROLE_ENUM = z.enum(["user", "dev", "admin", "owner"]);
export type ConfigRole = z.infer<typeof ROLE_ENUM>;

export const TOPIC_PATTERN = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i, {
  message:
    "Invalid topic name. Topics must start with a letter or digit and contain only letters, digits, underscores, and hyphens.",
});

export const FILE_PATTERN = z.string().regex(/^[\w][\w.-]*\.md$/, {
  message:
    "Invalid filename. Must be a bare filename ending in `.md` (no slashes). For topic-scoped files, pass the `topic` field separately.",
});

export function buildInstructionPath(
  role: ConfigRole,
  topic: string | undefined,
  file: string,
): string {
  return topic ? `${role}/topics/${topic}/${file}` : `${role}/${file}`;
}
