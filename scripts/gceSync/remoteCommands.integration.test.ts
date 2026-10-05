import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EXTRACT_FAILED_EXIT, pullArchiveCommand, pushApplyCommand } from "./remoteCommands.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const SUDO_SHIM = `#!/bin/sh
case "$1" in chown) echo "$*" >> "$(dirname "$0")/chown.log"; exit 0 ;; esac
exec "$@"
`;

describe("remoteCommands (integration)", () => {
  let root: string;

  const write = (relToRoot: string, content: string) => {
    const abs = join(root, relToRoot);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };

  const read = (relToRoot: string) => readFileSync(join(root, relToRoot), "utf8");

  const run = (command: string, input: Buffer | string) => {
    const result = spawnSync("sh", ["-c", command], {
      input,
      env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` },
    });
    return { status: result.status, stderr: String(result.stderr) };
  };

  const tarOf = (files: string[]) =>
    execFileSync("tar", ["-cf", "-", ...files], {
      cwd: join(root, "src"),
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gce-sync-remote-"));
    mkdirSync(join(root, "mount/data"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin/sudo"), SUDO_SHIM, { mode: 0o755 });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("replaces a file whose VM hash still matches, backing up the old copy", () => {
    write("mount/data/config.json", "old");
    write("src/data/config.json", "new");

    const command = pushApplyCommand(
      join(root, "mount"),
      "s1",
      [{ path: "data/config.json", expectedVmHash: sha("old") }],
      [],
    );
    const { status } = run(command, tarOf(["data/config.json"]));

    expect(status).toBe(0);
    expect(read("mount/data/config.json")).toBe("new");
    expect(read("mount/.gce-sync-backups/push-s1/data/config.json")).toBe("old");
  });

  it("aborts without writing when the VM copy changed since the plan", () => {
    write("mount/data/config.json", "edited-on-vm");
    write("src/data/config.json", "new");

    const command = pushApplyCommand(
      join(root, "mount"),
      "s1",
      [{ path: "data/config.json", expectedVmHash: sha("old") }],
      [],
    );
    const { status } = run(command, tarOf(["data/config.json"]));

    expect(status).toBe(3);
    expect(read("mount/data/config.json")).toBe("edited-on-vm");
    expect(existsSync(join(root, "mount/.gce-sync-backups"))).toBe(false);
  });

  it("creates a new file in a new directory", () => {
    write("src/data/plugins/p/index.js", "js");

    const command = pushApplyCommand(join(root, "mount"), "s1", [], ["data/plugins/p/index.js"]);
    const { status } = run(command, tarOf(["data/plugins/p/index.js"]));

    expect(status).toBe(0);
    expect(read("mount/data/plugins/p/index.js")).toBe("js");
  });

  it("aborts when a file to create already appeared on the VM", () => {
    write("mount/data/x.md", "vm");
    write("src/data/x.md", "local");

    const command = pushApplyCommand(join(root, "mount"), "s1", [], ["data/x.md"]);
    const { status } = run(command, tarOf(["data/x.md"]));

    expect(status).toBe(3);
    expect(read("mount/data/x.md")).toBe("vm");
  });

  it("exits with the extract-failed code and still hands over the written files on a truncated archive", () => {
    write("src/data/a.md", "A".repeat(4096));
    write("src/data/b.md", "B".repeat(4096));

    const command = pushApplyCommand(join(root, "mount"), "s1", [], ["data/a.md", "data/b.md"]);
    const archive = tarOf(["data/a.md", "data/b.md"]);
    const { status, stderr } = run(command, archive.subarray(0, 6000));

    expect({ status, stderr }).toMatchObject({
      status: EXTRACT_FAILED_EXIT,
      stderr: expect.stringContaining("Extraction failed partway"),
    });
    expect(read("mount/data/a.md")).toBe("A".repeat(4096));
    expect(read("bin/chown.log")).toContain("chown 1001:1001 data/a.md data/b.md");
  });

  it("pull archive round-trips the listed files", () => {
    write("mount/data/a.md", "A");
    write("mount/data/sub/b.md", "B");

    const result = spawnSync("sh", ["-c", pullArchiveCommand(join(root, "mount"))], {
      input: "data/a.md\ndata/sub/b.md\n",
      env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` },
    });
    expect(result.status).toBe(0);

    mkdirSync(join(root, "out"));
    execFileSync("tar", ["-xf", "-"], { cwd: join(root, "out"), input: result.stdout });

    expect(read("out/data/a.md")).toBe("A");
    expect(read("out/data/sub/b.md")).toBe("B");
  });
});
