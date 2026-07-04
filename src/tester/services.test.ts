import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import {
  ensureServices,
  stopServices,
  serviceContainerName,
  TesterServiceError,
  type ServiceLifecycleDeps,
  type StartedService,
} from "./services.js";
import type { TesterServiceSpec } from "./servicesConfig.js";
import type { TesterConfig } from "../config.js";

vi.mock("../logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const MYSQL: TesterServiceSpec = {
  name: "mysql",
  image: "mysql:8",
  memoryMb: 384,
  port: 3306,
  env: { MYSQL_ROOT_PASSWORD: "root" },
  args: ["--performance-schema=OFF"],
  tmpfs: ["/var/lib/mysql"],
};
const REDIS: TesterServiceSpec = { name: "redis", image: "redis:7", memoryMb: 64, port: 6379 };

const TESTER: TesterConfig = {
  enabled: true,
  sidecarUrl: "http://clack-playwright:8931/mcp",
  recordingsDir: "/recordings",
  dockerProxyUrl: "http://proxy:2375",
  servicesBudgetMb: 512,
  serviceImageAllowlist: ["mysql:8", "redis:7"],
};

interface DockerCreateBody {
  Image: string;
  Env?: string[];
  Cmd?: string[];
  HostConfig: {
    Memory: number;
    MemorySwap: number;
    NetworkMode: string;
    Tmpfs?: Record<string, string>;
  };
}

interface FakeDockerOptions {
  /** Container names (without leading slash) that pre-exist. */
  existing?: string[];
  /** Image refs that are already present locally. */
  images?: string[];
  /** Fail the create call for this container name. */
  failCreateFor?: string;
  /** Fail (500) every DELETE for this container name. */
  failRemoveFor?: string;
  /** Fail (500) the pull for this image ref. */
  failPullFor?: string;
  /** Fail (500) the image inspect for this image ref. */
  failInspectFor?: string;
}

/** Minimal in-memory docker engine behind a fetch signature, recording every call. */
function fakeDocker(options: FakeDockerOptions = {}) {
  const containers = new Set(options.existing ?? []);
  const images = new Set(options.images ?? []);
  const calls: string[] = [];
  const removed: string[] = [];
  const created: Array<{ name: string; body: DockerCreateBody }> = [];

  const json = (status: number, body: object) => new Response(JSON.stringify(body), { status });

  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const path = url.pathname;
    calls.push(`${method} ${path}${url.search}`);

    if (method === "GET" && path === "/containers/json") {
      const names = [...containers].map((name) => ({ Names: [`/${name}`] }));
      return json(200, names);
    }
    const removeMatch = method === "DELETE" ? path.match(/^\/containers\/([^/]+)$/) : null;
    if (removeMatch) {
      const name = decodeURIComponent(removeMatch[1]);
      if (options.failRemoveFor === name) return json(500, { message: "boom" });
      removed.push(name);
      const knew = containers.delete(name);
      return knew ? new Response(null, { status: 204 }) : json(404, {});
    }
    const imageMatch = method === "GET" ? path.match(/^\/images\/(.+)\/json$/) : null;
    if (imageMatch) {
      const ref = decodeURIComponent(imageMatch[1]);
      if (options.failInspectFor === ref) return json(500, { message: "daemon error" });
      return images.has(ref) ? json(200, {}) : json(404, {});
    }
    if (method === "POST" && path === "/images/create") {
      const ref = `${url.searchParams.get("fromImage")}:${url.searchParams.get("tag")}`;
      if (options.failPullFor === ref) return json(500, { message: "pull access denied" });
      images.add(ref);
      return new Response("pull stream", { status: 200 });
    }
    if (method === "POST" && path === "/containers/create") {
      const name = url.searchParams.get("name") ?? "";
      if (options.failCreateFor === name) return json(409, { message: "conflict" });
      containers.add(name);
      const body: DockerCreateBody = JSON.parse(String(init?.body));
      created.push({ name, body });
      return json(201, { Id: name });
    }
    if (method === "POST" && /^\/containers\/[^/]+\/start$/.test(path)) {
      return new Response(null, { status: 204 });
    }
    return json(500, { message: `unhandled ${method} ${path}` });
  });

  return { fetch, calls, removed, created, containers };
}

function depsWith(
  docker: ReturnType<typeof fakeDocker>,
  overrides: Partial<ServiceLifecycleDeps> = {},
): ServiceLifecycleDeps {
  return {
    fetch: docker.fetch,
    probeTcp: vi.fn(async () => true),
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
}

async function expectServiceError(
  promise: Promise<StartedService[]>,
  kind: TesterServiceError["kind"],
): Promise<TesterServiceError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof TesterServiceError, `expected TesterServiceError, got ${err}`);
    assert.equal(err.kind, kind);
    return err;
  }
  throw new Error(`expected a '${kind}' TesterServiceError, but nothing was thrown`);
}

describe("serviceContainerName", () => {
  it("derives the namespaced container name", () => {
    assert.equal(serviceContainerName("repo", "mysql"), "clack-svc-repo-mysql");
  });
});

describe("ensureServices", () => {
  it("cold-starts declared services: pull, create with caps, start, probe", async () => {
    const docker = fakeDocker();
    const deps = depsWith(docker);
    const started = await ensureServices({
      repoName: "repo",
      services: [MYSQL, REDIS],
      tester: TESTER,
      deps,
    });

    assert.deepEqual(
      started.map((s) => ({ name: s.name, host: s.host, port: s.port, tmpfs: s.tmpfs })),
      [
        { name: "mysql", host: "clack-svc-repo-mysql", port: 3306, tmpfs: true },
        { name: "redis", host: "clack-svc-repo-redis", port: 6379, tmpfs: false },
      ],
    );
    assert.ok(docker.calls.some((c) => c.startsWith("POST /images/create?fromImage=mysql")));
    const mysqlCreate = docker.created.find((c) => c.name === "clack-svc-repo-mysql");
    expect(mysqlCreate?.body).toMatchObject({
      Image: "mysql:8",
      Env: ["MYSQL_ROOT_PASSWORD=root"],
      Cmd: ["--performance-schema=OFF"],
      HostConfig: {
        Memory: 384 * 1024 * 1024,
        MemorySwap: 384 * 1024 * 1024,
        NetworkMode: "clack",
        Tmpfs: { "/var/lib/mysql": "" },
      },
    });
    expect(deps.probeTcp).toHaveBeenCalledWith("clack-svc-repo-mysql", 3306, expect.any(Number));
  });

  it("skips the pull when the image is already local", async () => {
    const docker = fakeDocker({ images: ["mysql:8", "redis:7"] });
    await ensureServices({
      repoName: "repo",
      services: [MYSQL],
      tester: TESTER,
      deps: depsWith(docker),
    });
    assert.ok(!docker.calls.some((c) => c.startsWith("POST /images/create")));
  });

  it("removes stale namespace containers before creating fresh ones", async () => {
    const docker = fakeDocker({ existing: ["clack-svc-repo-mysql"], images: ["mysql:8"] });
    await ensureServices({
      repoName: "repo",
      services: [MYSQL],
      tester: TESTER,
      deps: depsWith(docker),
    });
    assert.equal(docker.removed[0], "clack-svc-repo-mysql");
    assert.ok(docker.created.some((c) => c.name === "clack-svc-repo-mysql"));
  });

  it("never touches containers outside the run's namespace", async () => {
    const docker = fakeDocker({
      existing: ["clack", "clack-playwright", "clack-svc-other-repo-mysql"],
      images: ["mysql:8"],
    });
    await ensureServices({
      repoName: "repo",
      services: [MYSQL],
      tester: TESTER,
      deps: depsWith(docker),
    });
    assert.deepEqual(docker.removed, []);
  });

  it("returns [] without touching the proxy when no services are declared", async () => {
    const docker = fakeDocker();
    const started = await ensureServices({
      repoName: "repo",
      services: [],
      tester: { enabled: true },
      deps: depsWith(docker),
    });
    assert.deepEqual(started, []);
    assert.deepEqual(docker.calls, []);
  });

  it("fails with proxy_missing when dockerProxyUrl is not configured", async () => {
    await expectServiceError(
      ensureServices({
        repoName: "repo",
        services: [MYSQL],
        tester: { ...TESTER, dockerProxyUrl: undefined },
        deps: depsWith(fakeDocker()),
      }),
      "proxy_missing",
    );
  });

  it("fails with proxy_unreachable when fetch rejects", async () => {
    const deps = depsWith(fakeDocker(), {
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const err = await expectServiceError(
      ensureServices({ repoName: "repo", services: [MYSQL], tester: TESTER, deps }),
      "proxy_unreachable",
    );
    assert.match(err.message, /http:\/\/proxy:2375/);
  });

  it("fails with image_not_allowlisted before any docker call", async () => {
    const docker = fakeDocker();
    const err = await expectServiceError(
      ensureServices({
        repoName: "repo",
        services: [{ ...MYSQL, image: "evil:latest" }],
        tester: TESTER,
        deps: depsWith(docker),
      }),
      "image_not_allowlisted",
    );
    assert.match(err.message, /evil:latest/);
    assert.deepEqual(docker.calls, []);
  });

  it("fails with budget_exceeded when declared memory exceeds the budget", async () => {
    const docker = fakeDocker();
    const err = await expectServiceError(
      ensureServices({
        repoName: "repo",
        services: [MYSQL, REDIS],
        tester: { ...TESTER, servicesBudgetMb: 100 },
        deps: depsWith(docker),
      }),
      "budget_exceeded",
    );
    assert.match(err.message, /448 MB/);
    assert.deepEqual(docker.calls, []);
  });

  it("tears down everything provisioned when a later service fails to create", async () => {
    const docker = fakeDocker({ failCreateFor: "clack-svc-repo-redis" });
    await expectServiceError(
      ensureServices({
        repoName: "repo",
        services: [MYSQL, REDIS],
        tester: TESTER,
        deps: depsWith(docker),
      }),
      "provision_failed",
    );
    assert.ok(docker.removed.includes("clack-svc-repo-mysql"));
    assert.equal(docker.containers.size, 0);
  });

  it("fails with provision_failed when the image pull fails", async () => {
    const docker = fakeDocker({ failPullFor: "mysql:8" });
    const err = await expectServiceError(
      ensureServices({
        repoName: "repo",
        services: [MYSQL],
        tester: TESTER,
        deps: depsWith(docker),
      }),
      "provision_failed",
    );
    assert.match(err.message, /Failed to pull image mysql:8/);
    assert.equal(docker.containers.size, 0);
  });

  it("fails with provision_failed when the image inspect errors with a non-404", async () => {
    const docker = fakeDocker({ failInspectFor: "mysql:8" });
    const err = await expectServiceError(
      ensureServices({
        repoName: "repo",
        services: [MYSQL],
        tester: TESTER,
        deps: depsWith(docker),
      }),
      "provision_failed",
    );
    assert.match(err.message, /Failed to inspect image mysql:8/);
  });

  it("fails with provision_failed on a malformed container-list payload", async () => {
    const deps = depsWith(fakeDocker(), {
      fetch: async () => new Response(JSON.stringify({ not: "an array" }), { status: 200 }),
    });
    const err = await expectServiceError(
      ensureServices({ repoName: "repo", services: [MYSQL], tester: TESTER, deps }),
      "provision_failed",
    );
    assert.match(err.message, /Unexpected container-list payload/);
  });

  it("normalizes a trailing slash in the proxy URL", async () => {
    const docker = fakeDocker();
    await ensureServices({
      repoName: "repo",
      services: [MYSQL],
      tester: { ...TESTER, dockerProxyUrl: "http://proxy:2375/" },
      deps: depsWith(docker),
    });
    assert.ok(docker.calls.every((call) => !call.includes("//containers")));
    assert.ok(docker.created.some((c) => c.name === "clack-svc-repo-mysql"));
  });

  it("fails with readiness_timeout and tears down when a service never accepts TCP", async () => {
    const docker = fakeDocker();
    const sleep = vi.fn(async () => {});
    const deps = depsWith(docker, { probeTcp: vi.fn(async () => false), sleep });
    await expectServiceError(
      ensureServices({ repoName: "repo", services: [MYSQL], tester: TESTER, deps }),
      "readiness_timeout",
    );
    assert.equal(sleep.mock.calls.length, 60);
    assert.ok(docker.removed.includes("clack-svc-repo-mysql"));
  });
});

describe("stopServices", () => {
  it("removes every container in the run's namespace and nothing else", async () => {
    const docker = fakeDocker({
      existing: ["clack-svc-repo-mysql", "clack-svc-repo-redis", "clack", "clack-playwright"],
    });
    await stopServices("repo", TESTER, depsWith(docker));
    assert.deepEqual(docker.removed.sort(), ["clack-svc-repo-mysql", "clack-svc-repo-redis"]);
  });

  it("continues past a failing removal and never throws", async () => {
    const docker = fakeDocker({
      existing: ["clack-svc-repo-mysql", "clack-svc-repo-redis"],
      failRemoveFor: "clack-svc-repo-mysql",
    });
    await stopServices("repo", TESTER, depsWith(docker));
    assert.ok(docker.removed.includes("clack-svc-repo-redis"));
  });

  it("is a no-op without a proxy url", async () => {
    const docker = fakeDocker({ existing: ["clack-svc-repo-mysql"] });
    await stopServices("repo", { enabled: true }, depsWith(docker));
    assert.deepEqual(docker.calls, []);
  });

  it("swallows a list failure (proxy down at teardown)", async () => {
    const deps = depsWith(fakeDocker(), {
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await stopServices("repo", TESTER, deps);
  });
});
