## Why

After the tools-base split, a code deploy's app build is ~199s on Cloud Build, and ~140s of that is two uncached `npm ci` runs (full deps in the builder stage for `tsc`, prod-only deps in the runtime stage). Cloud Build workers are ephemeral, so every deploy reinstalls all `node_modules` from the npm registry from scratch. Caching the `npm ci` layers in Artifact Registry, keyed by `package-lock.json`, turns the common case (lockfile unchanged) into a fast internal layer pull instead of a cold install — without changing the deployed image at all.

## What Changes

- The app image build switches from `gcr.io/cloud-builders/docker` `docker build` to **`docker buildx build`** with a registry build cache: `--cache-to type=registry,ref=…/clack:buildcache,mode=max,ignore-error=true` and `--cache-from type=registry,ref=…/clack:buildcache`. `mode=max` caches **all** stages (both the builder's full `npm ci` and the runtime's `npm ci --omit=dev`), not just the final stage; `ignore-error=true` keeps a cache-export failure from failing the deploy.
- When `package-lock.json` is unchanged, both `npm ci` layers are restored from the AR-internal cache (one blob each) instead of reinstalling; when it changes, `npm ci` reruns and the refreshed cache is pushed for next time.
- The buildx run uses the `docker-container` driver (required for `--cache-to type=registry`) and `--push` to Artifact Registry, pinned to `linux/amd64`.
- **No change to the Dockerfile, the tools image, or the deployed image.** The multi-stage boundary is untouched: the builder's devDeps `node_modules` is still discarded, and `clack:latest` still ships only prod `node_modules` + `dist` — byte-identical size to today. This is purely a build-time cache.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `docker-deployment`: the application image build gains an Artifact-Registry-backed BuildKit registry cache (`mode=max`), so unchanged-`package-lock.json` deploys restore the `npm ci` layers from cache instead of reinstalling — the deployed image is unchanged; only build time drops.

## Impact

- **Code/build:** `scripts/gce-common.sh` (a `BUILDCACHE_IMAGE_NAME` reference); `scripts/gce-update-image.sh` (the app-build step: generated Cloud Build config now creates a `docker-container` buildx builder and runs `docker buildx build --push` with the registry cache flags). The `Dockerfile` is **not** modified — it already isolates dependency layers (`COPY package*.json` → `npm ci` → `COPY` source), which is what makes the cache hit.
- **Registry:** a new `clack:buildcache` cache artifact in Artifact Registry (a few hundred MB of intermediate layers). It is a cache, never deployed; the VM pulls only `clack:latest`.
- **Deploy behavior:** first deploy after this change populates the cache (full cost); subsequent deploys with an unchanged lockfile drop the app build from ~199s to an expected ~30–50s. Lockfile-changing deploys pay a normal `npm ci` and refresh the cache.
- **Not affected:** the tools-image conditional rebuild, final image size/contents, the pre-pull/drain/swap/readiness phases, runtime behavior. Cache-mount (`--mount=type=cache`) for `/root/.npm` is deliberately out of scope — BuildKit does not export cache mounts to the registry, so it yields no benefit on ephemeral Cloud Build workers.
