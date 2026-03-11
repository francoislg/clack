import { access } from "node:fs/promises";

/** Extract a human-readable message from an unknown caught value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Check whether a file or directory exists at the given path. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
