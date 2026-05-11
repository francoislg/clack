/**
 * Resolve the actual executable name for a JS-toolchain shim on the current
 * platform.
 *
 * On Windows, `npm`/`npx` (and similar Node-tooling launchers) are `.cmd`
 * shims. `execFile`/`spawn` without `shell: true` call `CreateProcess`, which
 * does NOT auto-resolve `.cmd` extensions the way the shell does — so the
 * spawn fails with ENOENT unless we name the shim explicitly.
 *
 * Use this helper instead of inlining the platform check so all call sites
 * stay consistent and the no-shell guarantee (no metacharacter risk) is
 * preserved.
 */
export function npmBin(name: "npm" | "npx"): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}
