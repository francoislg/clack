## 1. Tools base image

- [x] 1.1 Create `Dockerfile.tools` (checked in): `FROM node:22-alpine`, `apk add --no-cache git curl bash ffmpeg lsof`, `corepack enable`, and the `github-mcp-server` install (move `GITHUB_MCP_SERVER_VERSION` + `TARGETARCH` args and the download `RUN` here verbatim).
- [x] 1.2 Verify `Dockerfile.tools` builds standalone and the binary runs: `docker build -f Dockerfile.tools -t clack:tools-base .` then `docker run --rm clack:tools-base github-mcp-server --help` (or `--version`).

## 2. Application Dockerfile

- [x] 2.1 Add a global `ARG TOOLS_IMAGE=clack:tools` (before the first `FROM`) and rebase the production stage `FROM ${TOOLS_IMAGE}`; remove the `apk add git curl bash ffmpeg lsof`, `corepack enable`, and `github-mcp-server` download lines (now inherited). Keep the checked-in Dockerfile free of any hardcoded AR path — the deploy supplies the full ref via `--build-arg`.
- [x] 2.2 Keep the builder stage `FROM node:22-alpine` (Node major must match the tools base); leave `npm ci` / `npm run build` / prod `npm ci --omit=dev` / dist copy / config copies / non-root user / env / healthcheck unchanged.
- [x] 2.3 Local sanity build against a local tools image (retag `clack:tools-base` as the pinned tools tag) to confirm the app image builds and starts.

## 3. Per-instance overlay

- [x] 3.1 Update `data/docker/Dockerfile.custom` and `Dockerfile.custom.example` to `FROM …/clack:tools-base` (was `:base`); keep `apk add jq`, the `claude-dont` COPY, and the `/opt/worker-hooks/claude-dont/` path. Remove the `USER root`/`USER clack` dance — the tools base has no `clack` user (the app stage creates it and ends on `USER clack`), so the overlay stays root.
- [x] 3.2 Update `data/docker/README.md` to describe the new tools-overlay model (overlay layers on the tools base, rebuilt only with tools inputs).

## 4. GCE deploy script — conditional tools build

- [x] 4.1 In `scripts/gce-common.sh`, add `TOOLS_IMAGE_NAME` (`…/clack:tools`) and `TOOLS_BASE_IMAGE_NAME` (`…/clack:tools-base`) alongside `IMAGE_NAME`; the hash-tagged reference (`…/clack:tools-<hash>`) is derived in `gce-update-image.sh` once `TOOLS_HASH` is known (referred to below as `TOOLS_IMAGE_NAME_HASH`).
- [x] 4.2 In `scripts/gce-update-image.sh`, compute `TOOLS_HASH` as a SHA-256 digest over the full contents of `Dockerfile.tools` plus, when `data/docker/` exists, every file under it — e.g. `{ cat Dockerfile.tools; [ -d data/docker ] && find data/docker -type f | sort | xargs cat; } | shasum -a 256 | cut -d' ' -f1` (hashing the whole `data/docker/` tree avoids drift with the overlay's `COPY` lines; an edit to an unbuilt file there triggers a harmless extra rebuild).
- [x] 4.3 Check Artifact Registry for the tools hash tag with `gcloud artifacts docker images describe "$TOOLS_IMAGE_NAME_HASH" >/dev/null 2>&1` (exit 0 = present → skip the tools build; any non-zero, including unreachable/errored → treat as missing and rebuild, failing safe). No mutable tag to reconcile — the app build points its `TOOLS_IMAGE` arg at this immutable hash ref directly.
- [x] 4.4 If the hash tag is missing: when `data/docker/Dockerfile.custom` exists, build `Dockerfile.tools` → push mutable `clack:tools-base` (the overlay's `FROM`), then build the overlay (context `data/docker/`) → push `clack:tools-<TOOLS_HASH>`. When no overlay exists, build `Dockerfile.tools` straight to `clack:tools-<TOOLS_HASH>`. Use generated Cloud Build configs (the `--tag` shorthand can't name `Dockerfile.tools`/`Dockerfile.custom`).
- [x] 4.5 Replace the existing base+overlay double-build block with a single app build → `clack:latest` (always runs), via a generated Cloud Build config passing `--build-arg TOOLS_IMAGE=$TOOLS_IMAGE_NAME_HASH` (the `--tag` shorthand cannot pass build args).
- [x] 4.6 Verify the pre-pull / drain / swap / readiness phases and the `docker run` command are untouched (still pull `IMAGE_NAME` = `:latest`).

## 5. Docs

- [x] 5.1 CLAUDE.md: no change needed — it carries no `:base` → `:latest` overlay-build description (its only deploy mentions are the worker-settings push and tester sidecar, both unaffected). The overlay-build model is documented in `docs/worker-settings.md` (5.2) and `data/docker/README.md` (3.2).
- [x] 5.2 Update `docs/worker-settings.md` to reflect that `jq` + `claude-dont` now ship via the tools overlay (hook path `/opt/worker-hooks/claude-dont/` unchanged).

## 6. Verify

- [x] 6.1 Dry-run the hash logic locally: run the `TOOLS_HASH` computation and capture the value; re-run unchanged and confirm it is identical; add a comment to `Dockerfile.tools` (or touch a `data/docker/` file), re-run and confirm the hash changes; revert and confirm it returns to the original.
- [ ] 6.2 Deploy once to the VM (operator, via `/deploy`): confirm the first deploy builds the tools image, and a subsequent code-only deploy skips the tools build and runs a single app build (check Cloud Build history — one `:latest` build, no tools build). Local proxy already validated: tools image builds, app builds `FROM` it, overlay builds `FROM` tools-base, and a no-cache app-only rebuild is measurably faster than the old full build (see build-time comparison).
- [x] 6.3 Confirm worker-mode Claude still finds the `claude-dont` hook at `/opt/worker-hooks/claude-dont/` (worker-settings injection intact).
