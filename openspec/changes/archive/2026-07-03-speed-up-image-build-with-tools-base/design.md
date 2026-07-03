## Context

The GCE image-update deploy (`scripts/gce-update-image.sh`) builds the container image on ephemeral Cloud Build workers via `gcloud builds submit`. Those workers start with an empty local image store and the invocation adds no `--cache-from`, so **every** layer re-runs on **every** deploy: `npm ci` (twice — full builder stage + prod stage), `apk add git curl bash ffmpeg lsof`, `wget github-mcp-server`, and copies. Measured base builds: ~155–223s. When the applauz-me instance's overlay (`data/docker/Dockerfile.custom` → `apk add jq` + `claude-dont` hook) is present, a **second** `gcloud builds submit` runs `FROM clack:base` and pushes `clack:latest`, adding a flat ~48s on top.

We investigated registry cache (`--cache-from`) and rejected it as the primary lever: the ~1.4 GB image makes the required pre-build `docker pull` a ~20–30s tax that eats most of the gain, classic `--cache-from` does not restore intermediate builder-stage layers (so the expensive `npm ci` stays uncached), and Kaniko — the granular alternative — was archived June 2025. The structural fix instead removes the slow, rarely-changing layers from the per-deploy hot path entirely.

## Goals / Non-Goals

**Goals:**
- A code-only deploy rebuilds only application code: `npm ci` + `tsc` + copy. No `apk add ffmpeg`, no `github-mcp-server` download, no second overlay build.
- The stable system layer (git/curl/bash/ffmpeg/lsof, corepack, github-mcp-server) lives in a pinned `clack:tools` base image, rebuilt only when its inputs change.
- The per-instance `jq` + `claude-dont` overlay is preserved but rebuilt only with the tools image, not on every deploy; the in-image hook path `/opt/worker-hooks/claude-dont/` referenced by `data/worker-settings.json` is unchanged.
- No change to runtime container behavior: mounts, ports, drain gate, non-root user, data disk.

**Non-Goals:**
- Registry `--cache-from` / buildx registry cache for the `npm ci` layer — a possible later layer, explicitly out of scope here.
- Bigger Cloud Build machine types, Depot or other remote persistent-cache builders, or moving the build off Cloud Build to local `docker build`.
- Any change to the `/deploy` skill beyond build-phase log-line updates.

## Decisions

### Decision 1: Two-tier tools image — generic `clack:tools-base` + optional per-instance `clack:tools`

- **Generic tier** (`Dockerfile.tools`, checked into the repo) builds `clack:tools-base`: `FROM node:22-alpine` + `apk add git curl bash ffmpeg lsof` + `corepack enable` + the `github-mcp-server` binary (the `GITHUB_MCP_SERVER_VERSION` / `TARGETARCH` args move here).
- **Per-instance tier**: when `data/docker/Dockerfile.custom` exists it is rebuilt as `FROM …/clack:tools-base` adding `jq` + the `claude-dont` hook, and pushed as `clack:tools`. When absent, `clack:tools` is `clack:tools-base` (re-tagged, no second build). Because the overlay now layers on the bare tools image (root, no `clack` user yet — that user is created later in the app stage) instead of on the finished app image, it stays root throughout and **drops the trailing `USER clack` switch** the old overlay carried; the app stage still ends on `USER clack`, so the final image is unchanged.
- The application `Dockerfile` production stage bases `FROM ${TOOLS_IMAGE}`, where `TOOLS_IMAGE` is a global build arg defaulting to the bare `clack:tools` (usable for a local build against a locally-tagged tools image). The deploy passes the Artifact-Registry-qualified reference via `--build-arg TOOLS_IMAGE=…/clack:tools`, so the **checked-in Dockerfile stays registry-agnostic** — no instance-specific AR path is committed to the generic repo. The builder stage stays `FROM node:22-alpine` (it only needs Node to run `npm ci` + `tsc`; pinned to the same major as the tools base so native ABI matches).

Rationale: this is exactly the existing overlay concept moved **down one level** — the per-instance overlay now layers on the tools image (rebuilt rarely) instead of on the deployed app image (rebuilt every deploy). One generic image stays in git; instance-specific hook material stays gitignored in `data/docker/`. The `TOOLS_IMAGE` build arg keeps the registry reference out of the committed Dockerfile, mirroring how `gce-common.sh` already derives `IMAGE_NAME` from config rather than hardcoding it.

_Alternative considered:_ a single `clack:tools` with `jq`+`claude-dont` baked into the checked-in Dockerfile — rejected, that would put an instance-specific hook into the generic image every deployment inherits.

### Decision 2: Conditional tools rebuild keyed on a content hash, registry-tracked

`gce-update-image.sh` computes `TOOLS_HASH` = a SHA-256 digest over the tools inputs: the full `Dockerfile.tools` contents (captures the `apk`/`corepack`/github-mcp version) plus, when present, the contents of **every file under `data/docker/`**. Hashing the whole overlay directory (rather than an enumerated `Dockerfile.custom` + `claude-dont/` + `provision.sh` list) is deliberate: it can never drift out of sync with what the overlay's `COPY` lines actually pull in. The cost is that editing an unbuilt file there (e.g. `README.md`) triggers one harmless extra tools rebuild — acceptable, since tools rebuilds are rare and `data/docker/` is tiny. The hash is computed **in-script** (a `shasum`/`node -e` one-liner, matching the existing `node -e` config read in the tester block), deliberately not the runtime `src/workers/setupVersion.ts` helper — that is a compiled TS utility for the worker pool, invoked inside the Node runtime, whereas this hash runs in the bash deploy path before/around `gcloud builds submit`. It then:

1. Checks whether `clack:tools-<TOOLS_HASH>` already exists in Artifact Registry (`gcloud artifacts docker images describe …:tools-<hash>`, exit 0 = present).
2. **Exists** → skip the tools build entirely.
3. **Missing or inconclusive** → build the tools image once. With an overlay: build the generic tools to the mutable `clack:tools-base` (the overlay's `FROM`), then build the overlay (context `data/docker/`) to `clack:tools-<TOOLS_HASH>`. Without an overlay: build `Dockerfile.tools` straight to `clack:tools-<TOOLS_HASH>`.

Then always: a single app build `FROM ${TOOLS_IMAGE}` → `clack:latest`, with `--build-arg TOOLS_IMAGE=…/clack:tools-<TOOLS_HASH>`.

Rationale: the deployed tools image is **content-addressed** — the app build points its `TOOLS_IMAGE` arg directly at the immutable `clack:tools-<hash>`, so there is **no mutable `:tools` tag to reconcile and no re-tag step** (removing a failure mode entirely); the build is also reproducible, always pinned to the exact hash it computed. Artifact Registry is the source of truth, so the decision is correct across machines and fresh checkouts (no local marker file). `clack:tools-base` stays mutable only because the user-authored overlay `Dockerfile.custom` references it by a stable name; it is consumed transiently within the same deploy, immediately after being pushed. The existence check fails **safe** — an unreachable/errored lookup (indistinguishable from "not found" by exit code alone) falls into the rebuild branch rather than reusing a possibly-absent image; the worst case is a redundant tools build, never a broken deploy.

_Alternatives considered:_ (a) a local `data/.tools-build-hash` marker — rejected; wrong on a different operator's machine or a fresh clone. (b) a mutable `clack:tools` tag pinned by the `Dockerfile`, reconciled via re-tag on reuse — rejected once the `TOOLS_IMAGE` build arg existed (introduced to keep the committed Dockerfile registry-agnostic), since the arg lets the app point straight at the immutable hash ref, making the mutable tag and its re-tag failure mode pure redundancy.

### Decision 3: App `Dockerfile` hard-depends on `clack:tools`; bootstrap and rollback are explicit

The app image no longer builds standalone — `FROM ${TOOLS_IMAGE}` requires the tools image to exist first. The script's conditional-rebuild step guarantees it: on a fresh registry the hash tag is missing, so the tools image is built before the app build. Because the app build must pass `--build-arg TOOLS_IMAGE`, it uses a generated Cloud Build config (like the existing overlay step) rather than the `gcloud builds submit --tag` shorthand, which cannot pass build args. Rollback is a git revert of this change (which restores the self-contained Dockerfile); there is no in-place fallback path, keeping the build logic single-branch.

## Risks / Trade-offs

- **Tools inputs not fully captured by the hash → stale tools image** → hash the entire `Dockerfile.tools` file and every file under `data/docker/` (not a hand-picked subset), so an `apk`-list, github-mcp version, or overlay edit always changes the hash.
- **App build pins a mutable `:tools` tag (not a digest) → non-reproducible base** → accepted for a deploy script; the immutable `clack:tools-<hash>` tag preserves traceability, and re-tagging keeps `:tools` consistent with the current hash.
- **Node major drift between builder stage and tools base** → both pinned to `node:22-alpine`; a bump must change both together (call-out in tasks).
- **First deploy after this change pays a one-time tools build** (~one base-build's worth) → expected and one-time; every subsequent code-only deploy is faster.
- **Cloud Build worker must pull `clack:tools` for the app build** → same AR repo, same service-account read access already used for `:latest`; the tools image is smaller than today's full base so the pull is not a net regression versus the eliminated overlay round-trip.
