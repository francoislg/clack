import { Socket } from "node:net";
import { z } from "zod";
import type { TesterConfig } from "../config.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import type { TesterServiceSpec } from "./servicesConfig.js";

/**
 * Run-scoped lifecycle for per-repo tester service containers, driven through the
 * restricted docker-socket-proxy (Docker Engine HTTP API over fetch — no docker CLI,
 * no SDK dependency). Only containers under the derived `clack-svc-<repo>-<name>`
 * namespace are ever created, stopped, or removed.
 */

export const SERVICE_CONTAINER_PREFIX = "clack-svc-";

const READINESS_TIMEOUT_MS = 60_000;
const READINESS_POLL_INTERVAL_MS = 1_000;
const DOCKER_NETWORK = "clack";

export function serviceContainerName(repoName: string, serviceName: string): string {
  return `${SERVICE_CONTAINER_PREFIX}${repoName}-${serviceName}`;
}

export type TesterServiceErrorKind =
  | "proxy_missing"
  | "proxy_unreachable"
  | "image_not_allowlisted"
  | "budget_exceeded"
  | "provision_failed"
  | "readiness_timeout";

export class TesterServiceError extends Error {
  constructor(
    readonly kind: TesterServiceErrorKind,
    message: string,
    readonly service?: string,
  ) {
    super(message);
    this.name = "TesterServiceError";
  }
}

/** Resolved view of a running service, threaded to the tester prompt. */
export interface StartedService {
  name: string;
  host: string;
  port: number;
  image: string;
  tmpfs: boolean;
}

/** The narrow slice of fetch the lifecycle uses — keeps test fakes cast-free. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServiceLifecycleDeps {
  fetch: FetchLike;
  probeTcp: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
}

export const defaultServiceLifecycleDeps: ServiceLifecycleDeps = {
  fetch: (input, init) => globalThis.fetch(input, init),
  probeTcp,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const finish = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

// Only the fields the lifecycle reads — the docker API returns far more.
const containerListSchema = z.array(z.object({ Names: z.array(z.string()).optional() }));

interface DockerApi {
  request(method: string, path: string, body?: unknown): Promise<Response>;
}

function buildDockerApi(proxyUrl: string, deps: ServiceLifecycleDeps): DockerApi {
  const base = proxyUrl.replace(/\/$/, "");
  return {
    async request(method, path, body) {
      try {
        return await deps.fetch(`${base}${path}`, {
          method,
          ...(body !== undefined && {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        });
      } catch (err) {
        throw new TesterServiceError(
          "proxy_unreachable",
          `Docker proxy unreachable at ${proxyUrl}: ${errorMessage(err)}`,
        );
      }
    },
  };
}

async function failureDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return `HTTP ${response.status}${text ? ` — ${text.slice(0, 300)}` : ""}`;
}

async function listRunContainers(api: DockerApi, repoName: string): Promise<string[]> {
  const prefix = `${SERVICE_CONTAINER_PREFIX}${repoName}-`;
  const filters = encodeURIComponent(JSON.stringify({ name: [prefix] }));
  const response = await api.request("GET", `/containers/json?all=1&filters=${filters}`);
  if (!response.ok) {
    throw new TesterServiceError(
      "provision_failed",
      `Failed to list service containers: ${await failureDetail(response)}`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    throw new TesterServiceError(
      "provision_failed",
      `Non-JSON container-list response from the docker proxy: ${errorMessage(err)}`,
    );
  }
  const parsed = containerListSchema.safeParse(payload);
  if (!parsed.success) {
    throw new TesterServiceError(
      "provision_failed",
      `Unexpected container-list payload from the docker proxy: ${parsed.error.message}`,
    );
  }
  // The name filter is a substring match on the docker side — re-check the prefix so
  // nothing outside the run's namespace is ever acted on.
  return parsed.data
    .flatMap((entry) => entry.Names ?? [])
    .map((name) => name.replace(/^\//, ""))
    .filter((name) => name.startsWith(prefix));
}

async function removeContainer(api: DockerApi, name: string): Promise<void> {
  if (!name.startsWith(SERVICE_CONTAINER_PREFIX)) {
    throw new TesterServiceError(
      "provision_failed",
      `Refusing to remove container '${name}' outside the ${SERVICE_CONTAINER_PREFIX} namespace`,
    );
  }
  const response = await api.request("DELETE", `/containers/${name}?force=1`);
  if (!response.ok && response.status !== 404) {
    throw new TesterServiceError(
      "provision_failed",
      `Failed to remove container ${name}: ${await failureDetail(response)}`,
    );
  }
}

async function ensureImage(api: DockerApi, service: TesterServiceSpec): Promise<void> {
  const inspect = await api.request("GET", `/images/${encodeURIComponent(service.image)}/json`);
  if (inspect.ok) return;
  if (inspect.status !== 404) {
    throw new TesterServiceError(
      "provision_failed",
      `Failed to inspect image ${service.image}: ${await failureDetail(inspect)}`,
      service.name,
    );
  }
  const colonIndex = service.image.lastIndexOf(":");
  const fromImage = colonIndex > 0 ? service.image.slice(0, colonIndex) : service.image;
  const tag = colonIndex > 0 ? service.image.slice(colonIndex + 1) : "latest";
  const pull = await api.request(
    "POST",
    `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`,
  );
  if (!pull.ok) {
    throw new TesterServiceError(
      "provision_failed",
      `Failed to pull image ${service.image}: ${await failureDetail(pull)}`,
      service.name,
    );
  }
  // The pull endpoint streams progress; the operation completes when the body ends. A
  // mid-stream failure is logged, not thrown — a truncated pull surfaces immediately
  // after as a create failure ("No such image"), which is the actionable signal.
  await pull.text().catch((err) => {
    logger.warn(`Image pull stream for ${service.image} ended abnormally: ${errorMessage(err)}`);
    return "";
  });
}

async function createAndStart(
  api: DockerApi,
  repoName: string,
  service: TesterServiceSpec,
): Promise<void> {
  const name = serviceContainerName(repoName, service.name);
  const create = await api.request("POST", `/containers/create?name=${encodeURIComponent(name)}`, {
    Image: service.image,
    ...(service.env && { Env: Object.entries(service.env).map(([key, val]) => `${key}=${val}`) }),
    ...(service.args && { Cmd: service.args }),
    HostConfig: {
      Memory: service.memoryMb * 1024 * 1024,
      MemorySwap: service.memoryMb * 1024 * 1024,
      NetworkMode: DOCKER_NETWORK,
      ...(service.tmpfs && {
        Tmpfs: Object.fromEntries(service.tmpfs.map((path) => [path, ""])),
      }),
    },
  });
  if (!create.ok) {
    throw new TesterServiceError(
      "provision_failed",
      `Failed to create container for service ${service.name}: ${await failureDetail(create)}`,
      service.name,
    );
  }
  const start = await api.request("POST", `/containers/${name}/start`);
  if (!start.ok) {
    throw new TesterServiceError(
      "provision_failed",
      `Failed to start service ${service.name}: ${await failureDetail(start)}`,
      service.name,
    );
  }
}

async function waitUntilReady(
  repoName: string,
  service: TesterServiceSpec,
  deps: ServiceLifecycleDeps,
): Promise<void> {
  const host = serviceContainerName(repoName, service.name);
  const deadlineAttempts = Math.ceil(READINESS_TIMEOUT_MS / READINESS_POLL_INTERVAL_MS);
  for (let attempt = 0; attempt < deadlineAttempts; attempt++) {
    if (await deps.probeTcp(host, service.port, READINESS_POLL_INTERVAL_MS)) return;
    await deps.sleep(READINESS_POLL_INTERVAL_MS);
  }
  throw new TesterServiceError(
    "readiness_timeout",
    `Service ${service.name} (${host}:${service.port}) did not accept TCP connections within ${READINESS_TIMEOUT_MS / 1000}s`,
    service.name,
  );
}

export interface EnsureServicesOptions {
  repoName: string;
  services: TesterServiceSpec[];
  tester: TesterConfig;
  deps?: ServiceLifecycleDeps;
}

/**
 * Guard, then provision the repo's declared services: remove stale containers from the
 * run's namespace, pull missing images, create with hard memory caps on the shared
 * docker network, start, and TCP-probe until ready. All-or-nothing — a failure at
 * whatever step tears down everything provisioned so far and rethrows, so a partial
 * set never reaches the run.
 */
export async function ensureServices(opts: EnsureServicesOptions): Promise<StartedService[]> {
  const { repoName, services, tester } = opts;
  const deps = opts.deps ?? defaultServiceLifecycleDeps;

  if (services.length === 0) return [];

  if (!tester.dockerProxyUrl) {
    throw new TesterServiceError(
      "proxy_missing",
      "Repo declares tester services but 'tester.dockerProxyUrl' is not configured",
    );
  }
  const allowlist = tester.serviceImageAllowlist ?? [];
  for (const service of services) {
    if (!allowlist.includes(service.image)) {
      throw new TesterServiceError(
        "image_not_allowlisted",
        `Image '${service.image}' (service '${service.name}') is not in tester.serviceImageAllowlist`,
        service.name,
      );
    }
  }
  const budget = tester.servicesBudgetMb ?? 0;
  const declaredTotal = services.reduce((sum, service) => sum + service.memoryMb, 0);
  if (declaredTotal > budget) {
    throw new TesterServiceError(
      "budget_exceeded",
      `Declared services need ${declaredTotal} MB but tester.servicesBudgetMb is ${budget}`,
    );
  }

  const api = buildDockerApi(tester.dockerProxyUrl, deps);

  for (const stale of await listRunContainers(api, repoName)) {
    await removeContainer(api, stale);
  }

  const started: StartedService[] = [];
  try {
    for (const service of services) {
      await ensureImage(api, service);
      await createAndStart(api, repoName, service);
      started.push({
        name: service.name,
        host: serviceContainerName(repoName, service.name),
        port: service.port,
        image: service.image,
        tmpfs: (service.tmpfs?.length ?? 0) > 0,
      });
    }
    await Promise.all(services.map((service) => waitUntilReady(repoName, service, deps)));
  } catch (err) {
    await stopServices(repoName, tester, deps);
    throw err;
  }
  return started;
}

/**
 * Best-effort teardown of every container in the run's namespace. Errors are logged and
 * never thrown — slot release must not be blocked, and remnants are recovered by the
 * next run's stale-container cleanup.
 */
export async function stopServices(
  repoName: string,
  tester: TesterConfig,
  deps: ServiceLifecycleDeps = defaultServiceLifecycleDeps,
): Promise<void> {
  if (!tester.dockerProxyUrl) return;
  const api = buildDockerApi(tester.dockerProxyUrl, deps);
  let names: string[];
  try {
    names = await listRunContainers(api, repoName);
  } catch (err) {
    logger.warn(`Tester service teardown: could not list containers: ${errorMessage(err)}`);
    return;
  }
  for (const name of names) {
    try {
      await removeContainer(api, name);
    } catch (err) {
      logger.warn(`Tester service teardown: failed to remove ${name}: ${errorMessage(err)}`);
    }
  }
}
