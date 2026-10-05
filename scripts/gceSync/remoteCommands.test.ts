import { describe, it, expect } from "vitest";
import {
  ancestorDirs,
  containerReadCheckCommand,
  pullArchiveCommand,
  pushApplyCommand,
} from "./remoteCommands.js";

describe("ancestorDirs", () => {
  it("returns every ancestor below data, deepest first and deduped", () => {
    expect(
      ancestorDirs([
        "data/plugins/my-gifs/index.js",
        "data/plugins/my-gifs/lib/a.js",
        "data/config.json",
      ]),
    ).toEqual(["data/plugins/my-gifs/lib", "data/plugins/my-gifs", "data/plugins"]);
  });
});

describe("pushApplyCommand", () => {
  it("checks hashes and appearance before extracting, and hands files to the container user", () => {
    const command = pushApplyCommand(
      "/mnt/m",
      "20260922-120000",
      [{ path: "data/config.json", expectedVmHash: "a".repeat(64) }],
      ["data/new dir/x.md"],
    );

    expect(command).toContain("cd '/mnt/m'");
    expect(command).toContain("sha256sum -c");
    expect(command).toContain("'/mnt/m/.gce-sync-backups/push-20260922-120000'");
    expect(command).toContain("sudo tar -xf -");
    expect(command).toContain("sudo chown 1001:1001 'data/config.json' 'data/new dir/x.md'");

    const extractAt = command.indexOf("sudo tar -xf -");
    expect(command.indexOf("sha256sum -c")).toBeLessThan(extractAt);
    expect(command.indexOf("appeared")).toBeLessThan(extractAt);
  });

  it("omits the hash check and backup when nothing is replaced", () => {
    const command = pushApplyCommand("/mnt/m", "s", [], ["data/x.md"]);

    expect(command).not.toContain("sha256sum");
    expect(command).not.toContain(".gce-sync-backups");
  });
});

describe("pullArchiveCommand", () => {
  it("tars the paths read from stdin to stdout", () => {
    expect(pullArchiveCommand("/mnt/m")).toBe("cd '/mnt/m' && sudo tar -cf - -T -");
  });
});

describe("containerReadCheckCommand", () => {
  it("marks a missing container and probes each path inside clack", () => {
    const command = containerReadCheckCommand(["data/config.json"]);

    expect(command).toContain("__NOCONTAINER__");
    expect(command).toContain("docker exec clack sh -c");
    expect(command).toContain("/app/data/config.json");
  });
});
