/** Test-only utilities shared across test files. */

/**
 * Normalize an OS-native path to forward slashes for comparison against
 * forward-slash literals in tests. Production code builds paths with
 * `path.join()` which uses backslashes on Windows; tests written with
 * `/fake/...` literals need this to match regardless of platform.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}
