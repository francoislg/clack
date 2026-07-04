import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  loadTesterServices,
  type LoadTesterServicesDeps,
  type TesterServiceSpec,
} from "./servicesConfig.js";

const VALID_FILE = {
  services: [
    {
      name: "mysql",
      image: "mysql:8",
      memoryMb: 384,
      port: 3306,
      env: { MYSQL_ROOT_PASSWORD: "root" },
      args: ["--performance-schema=OFF"],
      tmpfs: ["/var/lib/mysql"],
    },
    { name: "redis", image: "redis:7", memoryMb: 64, port: 6379 },
  ],
};

function depsFor(content: string | null, path = "cfg/repo/tester_services.json") {
  const deps: LoadTesterServicesDeps = {
    resolveInstructionFile: () => (content === null ? null : path),
    readTextFile: () => {
      if (content === null) throw new Error("should not read");
      return content;
    },
  };
  return deps;
}

describe("loadTesterServices", () => {
  it("returns null services when no file exists in either tier", () => {
    const result = loadTesterServices("repo", depsFor(null));
    assert.deepEqual(result, { ok: true, services: null });
  });

  it("parses a valid file", () => {
    const result = loadTesterServices("repo", depsFor(JSON.stringify(VALID_FILE)));
    assert.equal(result.ok, true);
    const services = (result as { ok: true; services: TesterServiceSpec[] }).services;
    assert.equal(services.length, 2);
    assert.equal(services[0].name, "mysql");
    assert.deepEqual(services[0].tmpfs, ["/var/lib/mysql"]);
    assert.equal(services[1].env, undefined);
  });

  it("resolves through the injected instruction-file chain with the repo-scoped filename", () => {
    let requested: string | null = null;
    const deps: LoadTesterServicesDeps = {
      resolveInstructionFile: (filename) => {
        requested = filename;
        return null;
      },
      readTextFile: () => "",
    };
    loadTesterServices("applauz-monorepo", deps);
    assert.equal(requested, "applauz-monorepo/tester_services.json");
  });

  it("fails (not null) on malformed JSON", () => {
    const result = loadTesterServices("repo", depsFor("{ nope"));
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /Invalid JSON/);
  });

  it("fails on an unreadable file", () => {
    const deps: LoadTesterServicesDeps = {
      resolveInstructionFile: () => "cfg/repo/tester_services.json",
      readTextFile: () => {
        throw new Error("EACCES");
      },
    };
    const result = loadTesterServices("repo", deps);
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /Failed to read/);
  });

  it("rejects duplicate service names", () => {
    const file = {
      services: [
        { name: "mysql", image: "mysql:8", memoryMb: 384, port: 3306 },
        { name: "mysql", image: "mysql:9", memoryMb: 128, port: 3307 },
      ],
    };
    const result = loadTesterServices("repo", depsFor(JSON.stringify(file)));
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /duplicate service name 'mysql'/);
  });

  it("rejects an invalid name, port, and missing memoryMb", () => {
    for (const service of [
      { name: "MySQL", image: "mysql:8", memoryMb: 384, port: 3306 },
      { name: "mysql", image: "mysql:8", memoryMb: 384, port: 0 },
      { name: "mysql", image: "mysql:8", port: 3306 },
    ]) {
      const result = loadTesterServices("repo", depsFor(JSON.stringify({ services: [service] })));
      assert.equal(result.ok, false, JSON.stringify(service));
    }
  });

  it("rejects relative tmpfs paths", () => {
    const file = {
      services: [
        { name: "mysql", image: "mysql:8", memoryMb: 384, port: 3306, tmpfs: ["var/lib/mysql"] },
      ],
    };
    const result = loadTesterServices("repo", depsFor(JSON.stringify(file)));
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /absolute container path/);
  });

  it("accepts an empty services array as ok with zero services", () => {
    const result = loadTesterServices("repo", depsFor(JSON.stringify({ services: [] })));
    assert.deepEqual(result, { ok: true, services: [] });
  });
});
