import { access } from "node:fs/promises";

export interface FileExistsDeps {
  access: typeof access;
}

export const defaultFileExistsDeps: FileExistsDeps = {
  access,
};

export async function fileExists(
  path: string,
  deps: FileExistsDeps = defaultFileExistsDeps,
): Promise<boolean> {
  try {
    await deps.access(path);
    return true;
  } catch {
    return false;
  }
}
