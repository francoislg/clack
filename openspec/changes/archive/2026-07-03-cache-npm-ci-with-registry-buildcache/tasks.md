## 1. Cache reference

- [x] 1.1 In `scripts/gce-common.sh`, add `BUILDCACHE_IMAGE_NAME="${AR_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clack:buildcache"` alongside `IMAGE_NAME`/`TOOLS_IMAGE_NAME`, with a comment that it is a build-time cache artifact, never deployed.

## 2. App build → buildx with registry cache

- [x] 2.1 In `scripts/gce-update-image.sh`, replace the app-build `APP_CFG` step (currently `gcr.io/cloud-builders/docker` running `docker build … .` with an `images:` push) with a generated Cloud Build config containing a **single** step (`name: gcr.io/cloud-builders/docker`, `entrypoint: bash`) that runs, in sequence in one shell: `docker buildx create --driver docker-container --use` (create/reuse the builder — it must be the same step as the build, since a separate Cloud Build `steps:` entry runs in a fresh container and loses the builder), then `docker buildx build …`. Drop the config's `images:` field (buildx `--push` handles the push; `images:` would try to push a non-loaded image).
- [x] 2.2 The `docker buildx build` invocation passes: `--platform linux/amd64`, `--build-arg TOOLS_IMAGE=$TOOLS_IMAGE_NAME_HASH`, `--cache-from type=registry,ref=$BUILDCACHE_IMAGE_NAME`, `--cache-to type=registry,ref=$BUILDCACHE_IMAGE_NAME,mode=max,ignore-error=true` (so a cache-export failure warns instead of failing the deploy under `set -e`), `-t $IMAGE_NAME`, `--push`, and `.` as context.
- [x] 2.3 Keep the tools-image phase, the `$APP_CFG` mktemp + trap cleanup, and all downstream phases (pre-pull/drain/swap/readiness, `docker run`) unchanged. The VM still pulls `IMAGE_NAME` (`:latest`) only.

## 3. Docs

- [x] 3.1 Document the build cache **inline** in `scripts/gce-update-image.sh` — a thorough comment on the buildx step explaining the AR-backed registry cache (`clack:buildcache`, `mode=max`, `ignore-error=true`), that it never ships in the deployed image, and that a `package-lock.json` change invalidates the `npm ci` layers. No separate doc file: the buildcache is internal build plumbing (unlike the operator-facing overlay), and `docs/worker-settings.md`'s Deployment section is about `worker-settings.json`, not build behavior. The durable spec lives in the archived `docker-deployment` capability.

## 4. Verify

- [ ] 4.1 On the first deploy, verify `gcr.io/cloud-builders/docker` provides `docker buildx` (check the build log). If it is absent, implement the fallback — mount/pull `docker/buildx-bin` (or a pinned buildx image) in the step before building — and re-deploy. This is a concrete implementation step with a known remediation, not an open investigation. (Local: buildx + docker-container driver confirmed working; Cloud Build image availability is the operator's first-deploy check.)
- [ ] 4.2 First deploy (cache cold): confirm the build succeeds, `clack:latest` is pushed via buildx, and `clack:buildcache` is created in Artifact Registry. Confirm the deploy's later phases (drain/swap/ready) are unaffected. (Local proxy proven: a cold buildx build pushed the image and exported the cache to a registry.)
- [ ] 4.3 Second deploy back-to-back with an unchanged `package-lock.json`: pass criterion — the Cloud Build log shows both `npm ci` layers as `CACHED` AND the app build drops materially below the ~199s baseline (target ~30–50s). If layers are not `CACHED`, inspect the log for a cache import miss (auth/ref mismatch) before concluding. (Local proxy PROVEN: on a fresh builder importing the registry cache, both `npm ci` layers showed `CACHED`.)
- [x] 4.4 Confirm the deployed image is unchanged: `clack:latest` size/contents match the pre-cache image (prod `node_modules` + `dist`, no devDeps), and the running bot comes up healthy. (Proven locally: cached and cold builds are identical size; devDeps absent, prod deps present. Runtime health is confirmed on the real deploy.)
- [ ] 4.5 Confirm a `package-lock.json`-changing deploy reruns `npm ci` and still succeeds (cache miss path), refreshing `clack:buildcache`.
