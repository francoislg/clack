import { describe, it, vi, expect, beforeEach } from "vitest";
import type { App } from "@slack/bolt";
import {
  provisionSpinoffSiblings,
  type ProvisionSpinoffDeps,
  type ProvisionSpinoffSiblingsArgs,
} from "./spinoffSiblings.js";
import type { Config, RepositoryConfig } from "../../config.js";
import type { SessionContext } from "../../sessions.js";
import type { ChangeResult } from "../../changes/types.js";
import type { SpinoffIntentData } from "../../changes/spinoff.js";
import type { SlackStreamer } from "../../streaming/slackStreamer.js";

const repo = {
  name: "my-repo",
  url: "https://github.com/o/my-repo.git",
  branch: "main",
} as RepositoryConfig;

const testConfig = {} as Partial<Config> as Config;

function sessionStub(sessionId: string): SessionContext {
  return { sessionId } as Partial<SessionContext> as SessionContext;
}

const streamerStub = {
  start: vi.fn(async () => true),
  stop: vi.fn(async () => {}),
  handleEvent: vi.fn(),
  hasFailed: false,
} as Partial<SlackStreamer> as SlackStreamer;

function makeSpinoff(overrides?: Partial<SpinoffIntentData>): SpinoffIntentData {
  return {
    paths: ["src/util.ts"],
    description: "Extract util",
    proposedBranch: "clack/refactor/extract",
    patchPath: "/data/spinoff-patches/p.0.patch",
    ...overrides,
  };
}

type PostMessageFn = App["client"]["chat"]["postMessage"];

function makeClient(): {
  client: App["client"];
  postMessage: ReturnType<typeof vi.fn<PostMessageFn>>;
} {
  const postMessage = vi.fn<PostMessageFn>(async () => ({ ok: true, ts: "9999.0001" }));
  const chat = { postMessage } as Partial<App["client"]["chat"]> as App["client"]["chat"];
  const client = { chat } as Partial<App["client"]> as App["client"];
  return { client, postMessage };
}

function makeDeps(overrides?: Partial<ProvisionSpinoffDeps>): {
  deps: ProvisionSpinoffDeps;
  startChangeWorkflow: ReturnType<typeof vi.fn<ProvisionSpinoffDeps["startChangeWorkflow"]>>;
  createSession: ReturnType<typeof vi.fn<ProvisionSpinoffDeps["createSession"]>>;
} {
  const startChangeWorkflow = vi.fn<ProvisionSpinoffDeps["startChangeWorkflow"]>(
    async (): Promise<ChangeResult> => ({ success: true, prUrl: "https://pr" }),
  );
  const createSession = vi.fn<ProvisionSpinoffDeps["createSession"]>(async () =>
    sessionStub("sess-sibling"),
  );
  const deps: ProvisionSpinoffDeps = {
    getConfig: () => testConfig,
    findRepoByName: () => repo,
    branchExists: vi.fn<ProvisionSpinoffDeps["branchExists"]>(() => false),
    createSession,
    startChangeWorkflow,
    createStreamer: vi.fn<ProvisionSpinoffDeps["createStreamer"]>(() => streamerStub),
    finalizeStreamedWorkflow: vi.fn<ProvisionSpinoffDeps["finalizeStreamedWorkflow"]>(
      async () => {},
    ),
    getPermalink: vi.fn<ProvisionSpinoffDeps["getPermalink"]>(async () => "https://slack/link"),
    ...overrides,
  };
  return { deps, startChangeWorkflow, createSession };
}

function makeArgs(
  spinoffs: SpinoffIntentData[],
  deps: ProvisionSpinoffDeps,
  client: App["client"],
): ProvisionSpinoffSiblingsArgs {
  return {
    spinoffs,
    repo: "my-repo",
    channel: "C100",
    userId: "U1",
    triggerType: "mentions",
    parentThreadTs: "100.0001",
    client,
    deps,
  };
}

describe("provisionSpinoffSiblings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("provisions one sibling per spinoff with its own top-level thread and the slice patch", async () => {
    const { client, postMessage } = makeClient();
    const { deps, startChangeWorkflow, createSession } = makeDeps();

    await provisionSpinoffSiblings(makeArgs([makeSpinoff()], deps, client));

    // A top-level intro message (no thread_ts) was posted.
    const intro = postMessage.mock.calls.find((c) => c[0].thread_ts === undefined);
    expect(intro).toBeDefined();
    expect(intro![0].channel).toBe("C100");

    // Session bound to the new top-level ts.
    expect(createSession).toHaveBeenCalledTimes(1);
    const sessionArg = createSession.mock.calls[0]![0];
    expect(sessionArg.threadTs).toBe("9999.0001");
    expect(sessionArg.messageTs).toBe("9999.0001");

    // Sibling workflow started with the patch and the cap bypassed.
    expect(startChangeWorkflow).toHaveBeenCalledTimes(1);
    const call = startChangeWorkflow.mock.calls[0]!;
    expect(call[1].applySpinoffPatch).toBe("/data/spinoff-patches/p.0.patch");
    expect(call[6]?.bypassUserCap).toBe(true);
  });

  it("provisions multiple siblings sequentially", async () => {
    const { client } = makeClient();
    const { deps, startChangeWorkflow } = makeDeps();

    await provisionSpinoffSiblings(
      makeArgs([makeSpinoff(), makeSpinoff({ proposedBranch: "clack/chore/two" })], deps, client),
    );

    expect(startChangeWorkflow).toHaveBeenCalledTimes(2);
  });

  it("disambiguates a colliding branch name before provisioning", async () => {
    const { client } = makeClient();
    const branchExists = vi.fn<ProvisionSpinoffDeps["branchExists"]>(
      (_repo, b) => b === "clack/refactor/extract",
    );
    const { deps, startChangeWorkflow } = makeDeps({ branchExists });

    await provisionSpinoffSiblings(makeArgs([makeSpinoff()], deps, client));

    expect(startChangeWorkflow.mock.calls[0]![1].branchName).toBe("clack/refactor/extract-2");
  });

  it("continues with remaining siblings when one fails", async () => {
    const { client } = makeClient();
    const { deps, startChangeWorkflow } = makeDeps();
    startChangeWorkflow.mockImplementationOnce(async () => {
      throw new Error("acquire blew up");
    });

    await provisionSpinoffSiblings(
      makeArgs([makeSpinoff(), makeSpinoff({ proposedBranch: "clack/chore/two" })], deps, client),
    );

    expect(startChangeWorkflow).toHaveBeenCalledTimes(2);
  });

  it("cross-links the parent and sibling threads", async () => {
    const { client, postMessage } = makeClient();
    const { deps } = makeDeps();

    await provisionSpinoffSiblings(makeArgs([makeSpinoff()], deps, client));

    const threadTargets = postMessage.mock.calls
      .map((c) => c[0].thread_ts)
      .filter((ts): ts is string => ts !== undefined);
    expect(threadTargets).toContain("100.0001"); // back-link in parent thread
    expect(threadTargets).toContain("9999.0001"); // forward-link in sibling thread
  });
});
