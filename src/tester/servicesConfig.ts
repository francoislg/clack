import { readFileSync } from "node:fs";
import { z } from "zod";
import { resolveInstructionFile } from "../instructions.js";
import { zodErrorToResult } from "../plugins/zodResult.js";

/**
 * Per-repo tester service declarations (`data/configuration/<repo>/tester_services.json`).
 * Unlike the graceful `verification_checks.json` reader, an unreadable or invalid file is
 * a typed FAILURE, not null — a tester run silently missing its database wastes the whole
 * run, so the gate must abort loudly. Absent file stays the normal no-services path.
 */

const serviceSpecSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/, "must contain only lowercase letters, digits, and hyphens"),
  image: z.string().min(1),
  memoryMb: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  env: z.record(z.string(), z.string()).optional(),
  args: z.array(z.string()).optional(),
  tmpfs: z.array(z.string().startsWith("/", "must be an absolute container path")).optional(),
});

const servicesFileSchema = z
  .object({
    services: z.array(serviceSpecSchema),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const [index, service] of file.services.entries()) {
      if (seen.has(service.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["services", index, "name"],
          message: `duplicate service name '${service.name}'`,
        });
      }
      seen.add(service.name);
    }
  });

export type TesterServiceSpec = z.infer<typeof serviceSpecSchema>;

export type LoadTesterServicesResult =
  | { ok: true; services: TesterServiceSpec[] | null }
  | { ok: false; error: string };

export interface LoadTesterServicesDeps {
  resolveInstructionFile: typeof resolveInstructionFile;
  readTextFile: (path: string) => string;
}

export const defaultLoadTesterServicesDeps: LoadTesterServicesDeps = {
  resolveInstructionFile,
  readTextFile: (path: string) => readFileSync(path, "utf-8"),
};

export function loadTesterServices(
  repoName: string,
  deps: LoadTesterServicesDeps = defaultLoadTesterServicesDeps,
): LoadTesterServicesResult {
  const path = deps.resolveInstructionFile(`${repoName}/tester_services.json`);
  if (!path) {
    return { ok: true, services: null };
  }

  let raw: string;
  try {
    raw = deps.readTextFile(path);
  } catch (err) {
    return { ok: false, error: `Failed to read ${path}: ${String(err)}` };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `Invalid JSON in ${path}: ${String(err)}` };
  }

  const result = servicesFileSchema.safeParse(parsedJson);
  if (!result.success) {
    return zodErrorToResult(result.error, "tester_services");
  }
  return { ok: true, services: result.data.services };
}
