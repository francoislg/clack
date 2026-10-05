import { describe, expect, it } from "vitest";

import { processError, vmTargetFromEnv } from "./vm.js";

describe("vmTargetFromEnv", () => {
  it("returns the target when every variable is set", () => {
    expect(
      vmTargetFromEnv({ GCE_INSTANCE: "clack", GCE_ZONE: "z", GCE_DATA_MOUNT: "/mnt/m" }),
    ).toEqual({ instance: "clack", zone: "z", mount: "/mnt/m" });
  });

  it("names every missing variable", () => {
    expect(() => vmTargetFromEnv({ GCE_ZONE: "z" })).toThrow(
      "Missing required environment variable(s): GCE_INSTANCE, GCE_DATA_MOUNT",
    );
  });
});

describe("processError", () => {
  it("drops ssh noise and blank lines from the stderr tail", () => {
    const stderr = [
      "Warning: Permanently added 'compute.1' (ED25519) to the list of known hosts.",
      "Updating project ssh metadata... known_hosts",
      "",
      "tar: data/x.md: Cannot open: Permission denied",
    ].join("\n");

    expect(processError("ssh", 2, stderr).message).toBe(
      "ssh exited with code 2\ntar: data/x.md: Cannot open: Permission denied",
    );
  });

  it("keeps only the last 20 meaningful lines", () => {
    const stderr = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");

    const lines = processError("local tar", 1, stderr).message.split("\n");

    expect(lines[0]).toBe("local tar exited with code 1");
    expect(lines.slice(1)).toEqual(Array.from({ length: 20 }, (_, i) => `line ${i + 5}`));
  });
});
