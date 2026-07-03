## Context

After the tools-base split, the per-deploy app build is ~199s on Cloud Build, dominated by two `npm ci` runs (~140s total): the builder stage installs full deps (devDeps needed for `tsc`), the runtime stage installs prod-only deps (`--omit=dev`). Cloud Build workers are ephemeral — no local layer store, no persistent disk — so every deploy reinstalls all `node_modules` cold from the npm registry.

The Dockerfile is already cache-friendly: each stage does `COPY package*.json` → `RUN npm ci` → `COPY` source, so the `npm ci` layer is keyed only on the package files. What's missing is a place to persist that layer between ephemeral builds. BuildKit's registry cache backend fills exactly that gap, storing build cache as an image in Artifact Registry that the next build pulls over Google's internal network.

## Goals / Non-Goals

**Goals:**
- On an unchanged `package-lock.json`, restore both `npm ci` layers (builder + runtime) from an AR-backed cache instead of reinstalling — app build ~199s → expected ~30–50s.
- Keep the deployed `clack:latest` byte-identical to today: same prod-only `node_modules`, same `dist`, no devDeps bloat.
- No Dockerfile change — rely on the existing dependency-layer isolation.

**Non-Goals:**
- Changing the tools-image conditional-rebuild logic, the final image contents/size, or the runtime.
- Eliminating the double `npm ci` (builder full + runtime prod). Caching makes both cheap; restructuring the stages is a separate concern.
- A `--mount=type=cache` npm download cache — see Decision 3 (no benefit on ephemeral Cloud Build).
- Speeding up the *lockfile-changed* deploy beyond a normal cold `npm ci`.

## Decisions

### Decision 1: BuildKit registry cache with `mode=max`

Switch the app build to `docker buildx build` with `--cache-from type=registry,ref=…/clack:buildcache` and `--cache-to type=registry,ref=…/clack:buildcache,mode=max`. `mode=max` exports cache for **all** stages, so both the builder's full `npm ci` and the runtime's `npm ci --omit=dev` layers are cached — a `package-lock.json`-unchanged build restores both from AR (one blob each) rather than reinstalling.

_Alternatives considered:_
- **Inline cache** (`--cache-to type=inline`) — only embeds cache for the *final* stage's layers, so the builder-stage `npm ci` (half the cost) stays uncached. Rejected.
- **Content-hashed deps image** (bake `node_modules`, keyed on the lockfile, like the tools image) — would require two images (full-for-builder, prod-for-runtime) or a prune step to avoid shipping devDeps, and risks exactly the final-image bloat we want to avoid. Rejected in favor of keeping the dev/prod split at the multi-stage boundary.
- **GCS `node_modules` tarball** — more custom infra than a registry cache buys. Rejected.

### Decision 2: `docker-container` driver + `--push`, pinned to `linux/amd64`

`--cache-to type=registry` is not supported by buildx's default `docker` driver — it needs the `docker-container` driver. The Cloud Build app-build step therefore runs `docker buildx create --driver docker-container --use` before building, in the **same** bash step (a separate Cloud Build `steps:` entry runs in a fresh container and would lose the builder). Because the container driver does not load the result into the host Docker, it uses `--push` to send `clack:latest` straight to Artifact Registry (and the generated Cloud Build config drops the `images:` field, which would otherwise try to push a non-existent local image). The build is pinned `--platform linux/amd64` to match the VM. The `--cache-to` carries `ignore-error=true` so a cache-export failure (auth, transient registry error) degrades to a warning and still produces a pushed `clack:latest` — cache writing is best-effort, never deploy-blocking (see Risks).

### Decision 3: No Dockerfile change; no `--mount=type=cache`

The registry cache works against the existing `RUN npm ci` layers, so the Dockerfile is untouched. A `--mount=type=cache,target=/root/.npm` npm-download cache is deliberately excluded: BuildKit does not export cache-mount contents to the registry cache, so on ephemeral Cloud Build workers the mount is empty every build and yields no cross-build benefit (it would only help a self-hosted/persistent builder or via the `buildkit-cache-dance` hack). Keeping it out avoids Dockerfile churn for zero gain.

### Decision 4: A single mutable `clack:buildcache` tag

The cache is one mutable tag, overwritten each build (`mode=max` writes the full cache). Staleness self-heals: BuildKit validates each layer's inputs (parent digest + `package*.json` content + command), so a stale entry simply misses and rebuilds. It is a cache artifact only — never deployed, never pulled by the VM.

## Risks / Trade-offs

- **buildx not present in `gcr.io/cloud-builders/docker`** → the step assumes a modern docker CLI with the buildx plugin; validate on the first run and fall back to a `docker/buildx-bin` mount or a pinned buildx image if absent.
- **Registry auth from the container driver** → cache push/pull and `--push` target Artifact Registry; the existing plain-`docker build` app step already authenticates to AR, and buildx forwards the host Docker credentials to the builder, but confirm on the first run (a 401/403 on `--cache-to` degrades to a cold build, not a broken deploy).
- **Historical buildx `--cache-from` flakiness on Cloud Build ([moby #40262])** → mostly resolved; validate on a real run and keep the revert path ready.
- **First build populates the cache (no speedup)** → expected; measure the *second* back-to-back deploy (lockfile unchanged) to confirm the drop to ~30–50s.
- **Cache artifact growth in AR** → `mode=max` overwrites the single `clack:buildcache` tag, so it is bounded to one cache image; an optional AR cleanup policy can prune old blobs.
- **`--cache-to` failure must not fail the deploy** → the `--cache-to` carries `ignore-error=true`, which makes BuildKit treat a cache-export failure as a warning rather than a build error, so the build still pushes `clack:latest` even under the script's `set -e`. Cache writing is best-effort by construction, not by convention.

## Migration Plan

Ship the script change; the first deploy populates the cache at full cost, subsequent unchanged-lockfile deploys are fast. Rollback is a git revert of the `gce-update-image.sh` app-build step (back to `gcr.io/cloud-builders/docker` `docker build`), with no residual state beyond the harmless `clack:buildcache` artifact.
