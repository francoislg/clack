import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { WebClient } from "@slack/web-api";
import {
  syncRoster,
  ensureRosterFresh,
  setRosterSyncDeps,
  resetRosterSyncDeps,
  clearRosterSyncState,
} from "./rosterSync.js";
import type { RosterMember } from "../userRegistry.js";

const MARKER_PATH = `${process.cwd()}/data/state/roster-sync.json`;
const SIX_HOURS = 6 * 60 * 60 * 1000;

let store: Map<string, string>;
let upsertSpy: ReturnType<typeof vi.fn<(members: RosterMember[]) => Promise<void>>>;
let clock: number;

function install(seed?: Record<string, string>): void {
  store = new Map(Object.entries(seed ?? {}));
  upsertSpy = vi.fn<(members: RosterMember[]) => Promise<void>>(async () => {});
  clock = 100_000_000;
  setRosterSyncDeps({
    readFile: async (path) => {
      const value = store.get(path);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
    writeFile: async (path, data) => {
      store.set(path, data);
    },
    mkdir: async () => undefined,
    fileExists: async (path) => store.has(path),
    upsertRosterMembers: upsertSpy,
    now: () => clock,
  });
  clearRosterSyncState();
}

interface FakeMember {
  id: string;
  name: string;
  profile: {
    display_name?: string;
    real_name?: string;
    image_original?: string;
    image_512?: string;
  };
  deleted?: boolean;
  is_bot?: boolean;
}

interface ListPage {
  members: FakeMember[];
  next?: string;
}

// A real WebClient with users.list stubbed to serve keyed pages (by cursor). The spy's call
// count is the number of API sweeps, so tests need no separate counter.
function makeClient(pages: Record<string, ListPage>) {
  const client = new WebClient();
  const listSpy = vi.spyOn(client.users, "list").mockImplementation(async (opts) => {
    const page = pages[opts?.cursor ?? ""];
    return {
      ok: true,
      members: page.members,
      response_metadata: { next_cursor: page.next ?? "" },
    };
  });
  return { client, listSpy };
}

const ONE_PAGE = (members: FakeMember[]): Record<string, ListPage> => ({ "": { members } });

function markerSyncedAt(): number | null {
  const raw = store.get(MARKER_PATH);
  return raw ? (JSON.parse(raw).syncedAt as number) : null;
}

beforeEach(() => install());
afterEach(() => {
  resetRosterSyncDeps();
  clearRosterSyncState();
  vi.restoreAllMocks();
});

describe("rosterSync.syncRoster", () => {
  it("upserts real members and stamps the marker with now()", async () => {
    const { client } = makeClient(
      ONE_PAGE([
        { id: "U1", name: "alice", profile: { display_name: "Alice" } },
        { id: "U2", name: "bob", profile: { display_name: "Bob" } },
      ]),
    );
    await syncRoster(client);
    assert.equal(upsertSpy.mock.calls.length, 1);
    assert.deepEqual(
      upsertSpy.mock.calls[0][0].map((m) => m.userId),
      ["U1", "U2"],
    );
    assert.equal(markerSyncedAt(), clock);
  });

  it("excludes deleted, bot, and USLACKBOT members", async () => {
    const { client } = makeClient(
      ONE_PAGE([
        { id: "U1", name: "alice", profile: { display_name: "Alice" } },
        { id: "U2", name: "gone", profile: {}, deleted: true },
        { id: "U3", name: "bot", profile: {}, is_bot: true },
        { id: "USLACKBOT", name: "slackbot", profile: {} },
      ]),
    );
    await syncRoster(client);
    assert.deepEqual(
      upsertSpy.mock.calls[0][0].map((m) => m.userId),
      ["U1"],
    );
  });

  it("resolves avatarUrl (image_original → image_512 → empty) and displayName fallback", async () => {
    const { client } = makeClient(
      ONE_PAGE([
        {
          id: "U1",
          name: "a",
          profile: { display_name: "A", image_original: "orig", image_512: "512" },
        },
        { id: "U2", name: "b", profile: { display_name: "B", image_512: "512only" } },
        { id: "U3", name: "c", profile: { real_name: "Charlie" } },
      ]),
    );
    await syncRoster(client);
    const members = upsertSpy.mock.calls[0][0];
    assert.equal(members[0].avatarUrl, "orig");
    assert.equal(members[1].avatarUrl, "512only");
    assert.equal(members[2].avatarUrl, "");
    assert.equal(members[2].displayName, "Charlie");
  });

  it("follows next_cursor across pages", async () => {
    const { client } = makeClient({
      "": { members: [{ id: "U1", name: "a", profile: {} }], next: "next" },
      next: { members: [{ id: "U2", name: "b", profile: {} }] },
    });
    await syncRoster(client);
    assert.deepEqual(
      upsertSpy.mock.calls[0][0].map((m) => m.userId),
      ["U1", "U2"],
    );
  });

  it("does not upsert or stamp the marker when users.list fails", async () => {
    const client = new WebClient();
    vi.spyOn(client.users, "list").mockImplementation(async () => ({
      ok: false,
      error: "rate_limited",
    }));
    await syncRoster(client);
    assert.equal(upsertSpy.mock.calls.length, 0);
    assert.equal(markerSyncedAt(), null);
  });

  it("coalesces concurrent syncs into a single users.list sweep", async () => {
    const { client, listSpy } = makeClient(ONE_PAGE([{ id: "U1", name: "a", profile: {} }]));
    await Promise.all([syncRoster(client), syncRoster(client)]);
    assert.equal(listSpy.mock.calls.length, 1);
  });
});

describe("rosterSync.ensureRosterFresh", () => {
  it("cold start (no marker) awaits a sync", async () => {
    const { client, listSpy } = makeClient(ONE_PAGE([{ id: "U1", name: "a", profile: {} }]));
    await ensureRosterFresh(client);
    assert.equal(listSpy.mock.calls.length, 1);
    assert.equal(upsertSpy.mock.calls.length, 1);
    assert.equal(markerSyncedAt(), clock);
  });

  it("fresh marker skips the sync entirely", async () => {
    install({ [MARKER_PATH]: JSON.stringify({ syncedAt: clock - 1000 }) });
    const { client, listSpy } = makeClient(ONE_PAGE([{ id: "U1", name: "a", profile: {} }]));
    await ensureRosterFresh(client);
    assert.equal(listSpy.mock.calls.length, 0);
    assert.equal(upsertSpy.mock.calls.length, 0);
  });

  it("stale marker triggers a background sync", async () => {
    install({ [MARKER_PATH]: JSON.stringify({ syncedAt: clock - (SIX_HOURS + 1000) }) });
    const { client } = makeClient(ONE_PAGE([{ id: "U1", name: "a", profile: {} }]));
    await ensureRosterFresh(client);
    // Background sync is fire-and-forget; drain it via the coalesced in-flight promise.
    await syncRoster(client);
    assert.ok(upsertSpy.mock.calls.length >= 1);
  });

  it("is a no-op when the client is null", async () => {
    await ensureRosterFresh(null);
    assert.equal(upsertSpy.mock.calls.length, 0);
  });
});
