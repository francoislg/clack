import { describe, it, expect } from "vitest";
import { parseSha256sum, remoteInventoryCommand } from "./inventory.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("parseSha256sum", () => {
  it("maps each path to its hash, including paths with spaces", () => {
    const { inventory, unsupported } = parseSha256sum(
      `${HASH_A}  data/config.json\n${HASH_B}  data/configuration/my file.md\n`,
    );
    expect(inventory).toEqual(
      new Map([
        ["data/config.json", HASH_A],
        ["data/configuration/my file.md", HASH_B],
      ]),
    );
    expect(unsupported).toEqual([]);
  });

  it("reports escaped names instead of guessing their path", () => {
    const { inventory, unsupported } = parseSha256sum(`\\${HASH_A}  data/odd\\nname\n`);
    expect(inventory.size).toBe(0);
    expect(unsupported).toEqual([`\\${HASH_A}  data/odd\\nname`]);
  });
});

describe("remoteInventoryCommand", () => {
  it("quotes the mount and roots and prunes metadata files and given paths", () => {
    const command = remoteInventoryCommand(
      "/mnt/disks/clack-data",
      ["data/config.json", "data/it's"],
      ["data/cache"],
    );
    expect(command).toContain("cd '/mnt/disks/clack-data' || exit 0");
    expect(command).toContain(`for p in 'data/config.json' 'data/it'\\''s'; do`);
    expect(command).toContain(
      `\\( -name '._*' -o -name '.DS_Store' -o -path 'data/cache' \\) -prune -o -type f -exec sha256sum {} +`,
    );
  });
});
