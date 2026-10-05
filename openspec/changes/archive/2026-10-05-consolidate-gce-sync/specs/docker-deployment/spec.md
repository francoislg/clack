## MODIFIED Requirements

### Requirement: GCE Deployment Script
The system SHALL provide one deployment script for Google Compute Engine, `scripts/gce-deploy.sh`, that builds and distributes the container image via Google Artifact Registry and swaps the running container. The deploy SHALL NOT write files under the VM's data directory; data moves only through `scripts/gce-push.sh` and `scripts/gce-pull.sh`.

#### Scenario: Deploy to GCE
- **WHEN** `npm run deploy:gce` (or `scripts/gce-deploy.sh`) is executed against an existing instance
- **THEN** the script enables `artifactregistry.googleapis.com`
- **AND** builds and pushes the Docker image to an Artifact Registry Docker repository (image path `<region>-docker.pkg.dev/<project>/<repo>/clack:latest`)
- **AND** pulls the image on the VM and swaps the container, with the persistent data disk mounted at `/app/data`
- **AND** writes no file under the VM's data directory

#### Scenario: Deploy waits for idle before the swap
- **WHEN** the deploy has pulled the new image and the old container is still running
- **THEN** it waits, with the bot still accepting work, until the status endpoint reports `busy: false`
- **AND** it stops waiting after `IDLE_MAX_WAIT` seconds (default 900), or at once when the status endpoint can't be read, and proceeds to the in-process drain
- **AND** `--no-idle-wait` skips the wait

#### Scenario: GCE prerequisites check
- **WHEN** the deploy script runs
- **THEN** it verifies the GCP project is set
- **AND** verifies the instance exists, pointing to `--provision` when it does not

#### Scenario: First-time provisioning
- **WHEN** `scripts/gce-deploy.sh --provision` runs
- **THEN** it creates any missing VPC network, SSH firewall rule, data disk, and VM, grants the VM service account Artifact Registry read access on VM creation, and installs the data-disk mount startup script
- **AND** it seeds the data disk from local `data/` (caches excluded) only when the remote data directory is absent or empty
- **AND** it skips the seed and says so when the remote data directory already holds files

#### Scenario: Image reference is a single source of truth
- **WHEN** any gce-* script needs the image reference
- **THEN** it reads `IMAGE_NAME` from `scripts/gce-common.sh`
- **AND** `IMAGE_NAME` resolves to the Artifact Registry path (not a `gcr.io` path)

#### Scenario: VM authenticates to Artifact Registry
- **WHEN** the VM pulls the image during a deploy
- **THEN** the Docker credential helper is configured for the Artifact Registry host (`<region>-docker.pkg.dev`)
- **AND** the VM service account has at least `roles/artifactregistry.reader` covering the repository (granted at project or repository scope — project-level by default per design)

#### Scenario: VM service account lacks read access
- **WHEN** the VM pulls the image but its service account lacks `roles/artifactregistry.reader`
- **THEN** the pull fails with a 403 error (Artifact Registry is strictly IAM-gated, unlike GCR's backing bucket)
- **AND** the operator must grant the role before the pull can succeed

### Requirement: Status Port Published to Loopback

The GCE deploy SHALL run the container with the runtime status port published to the VM's loopback interface only, so the deploy script can poll `GET /status` from the VM host. The port SHALL NOT be published on a public interface.

#### Scenario: Container publishes status port to localhost

- **WHEN** `scripts/gce-deploy.sh` runs the new container
- **THEN** the `docker run` command publishes the status port as `127.0.0.1:<port>:<port>`
- **AND** the port is reachable as `localhost:<port>` from the VM host
- **AND** it is not bound to a public address

### Requirement: Conditional Tools Image Rebuild

The GCE deploy SHALL rebuild and push the tools image only when its inputs change, and SHALL otherwise reuse the already-pushed tools image, so a code-only deploy runs a single application build.

#### Scenario: Tools inputs unchanged — reuse

- **WHEN** `scripts/gce-deploy.sh` runs
- **AND** an image tagged with the current tools content hash (`clack:tools-<hash>`) already exists in Artifact Registry
- **THEN** the script does not rebuild the tools image
- **AND** it runs a single application build producing `clack:latest`, passing `--build-arg TOOLS_IMAGE=…/clack:tools-<hash>`

#### Scenario: Tools inputs changed — rebuild

- **WHEN** `scripts/gce-deploy.sh` runs
- **AND** no image tagged with the current tools content hash exists in Artifact Registry
- **THEN** the script builds the tools image and pushes it as `clack:tools-<hash>` (content-addressed; no mutable `clack:tools` tag)
- **AND** it then runs the application build with `--build-arg TOOLS_IMAGE=…/clack:tools-<hash>`

#### Scenario: Content hash covers tools inputs

- **WHEN** the tools content hash is computed
- **THEN** it is a SHA-256 digest derived from the full contents of `Dockerfile.tools`
- **AND** when the per-instance overlay directory (`data/docker/`) is present, the contents of every file under it are included in the hash (a superset of the overlay build inputs — an edit to an unbuilt file such as the README merely triggers a harmless extra tools rebuild)
- **AND** an edit to the system-dependency list or the `github-mcp-server` version changes the hash

#### Scenario: Bootstrap on a fresh registry

- **WHEN** `scripts/gce-deploy.sh` runs against an Artifact Registry with no tools image
- **THEN** the tools image is built and pushed before the application build
- **AND** the application build succeeds with `--build-arg TOOLS_IMAGE=…/clack:tools-<hash>`

#### Scenario: Existence check is inconclusive

- **WHEN** the check for `clack:tools-<hash>` in Artifact Registry cannot confirm the tag exists (registry unreachable, credential error, or any non-success result)
- **THEN** the script treats the tools image as missing and rebuilds it
- **AND** it does not silently reuse a possibly-absent image

#### Scenario: Tools build or push failure aborts the deploy

- **WHEN** the tools image build or its push fails
- **THEN** the script aborts before the application build (it runs under `set -e`)
- **AND** a tools image that was already pushed under its content-hash tag before the failure is safely reused on the next run, since its hash is unchanged

### Requirement: Application Build Uses a Registry Build Cache

The GCE deploy SHALL build the application image with a BuildKit registry cache backed by Artifact Registry, so that a build whose `package-lock.json` is unchanged restores the `npm ci` layers from cache instead of reinstalling dependencies. The cache SHALL NOT alter the contents or size of the deployed image.

#### Scenario: Cache imported and exported on every app build

- **WHEN** `scripts/gce-deploy.sh` builds the application image
- **THEN** it runs `docker buildx build` with `--cache-from type=registry,ref=…/clack:buildcache`
- **AND** `--cache-to type=registry,ref=…/clack:buildcache,mode=max,ignore-error=true`
- **AND** it passes `--build-arg TOOLS_IMAGE=…/clack:tools-<hash>` and pushes `clack:latest` to Artifact Registry

#### Scenario: mode=max caches both dependency stages

- **WHEN** the registry cache is exported
- **THEN** it includes the builder stage's full `npm ci` layer and the runtime stage's `npm ci --omit=dev` layer (not only the final stage)

#### Scenario: Unchanged lockfile restores npm ci from cache

- **WHEN** a deploy runs and `package-lock.json` is unchanged since the cached build
- **AND** the tools image it builds `FROM` is unchanged
- **THEN** both `npm ci` layers are restored from the registry cache (shown as `CACHED` in the build output) rather than reinstalling from the npm registry

#### Scenario: First build on a cold registry populates the cache

- **WHEN** a deploy runs against an Artifact Registry with no `clack:buildcache` tag
- **THEN** the `npm ci` layers run in full (no cache hit)
- **AND** the cache is exported to `clack:buildcache` for subsequent builds

#### Scenario: Changed lockfile reinstalls and refreshes the cache

- **WHEN** a deploy runs and `package-lock.json` has changed
- **THEN** `npm ci` reruns for the affected stage(s)
- **AND** the refreshed cache is exported to `clack:buildcache` for subsequent builds

#### Scenario: Cache export failure does not fail the deploy

- **WHEN** the cache export to the registry fails (transient error, auth/permission denied)
- **THEN** the `ignore-error=true` on `--cache-to` keeps the failure a warning rather than a build error
- **AND** the build still pushes `clack:latest` and the deploy proceeds

#### Scenario: Deployed image is unchanged by caching

- **WHEN** the cached build produces `clack:latest`
- **THEN** the image contains only prod `node_modules` and the compiled `dist` (the builder stage's devDeps are not shipped)
- **AND** its contents and size are identical to a build produced without the cache

#### Scenario: Cache backend requires the container driver

- **WHEN** the app-build step configures buildx
- **THEN** it creates and uses a `docker-container`-driver builder (required for `--cache-to type=registry`) in the same build step
- **AND** it builds for `linux/amd64`

#### Scenario: Cache artifact is never deployed

- **WHEN** the VM pulls the deployed image
- **THEN** it pulls only `clack:latest`
- **AND** it never pulls `clack:buildcache` (a build-time cache artifact)

## ADDED Requirements

### Requirement: Deploy Builds a Committed Revision

`scripts/gce-deploy.sh` SHALL build the image from `git archive HEAD` (never from the working tree) and SHALL record the commit SHA as the image label `clack.build-sha`. Before building, it SHALL read that label from the running container and refuse to deploy when prod runs HEAD already (unless `--redeploy`), when prod runs a commit that is not an ancestor of HEAD (unless `--allow-rollback`), or when prod's image carries no SHA (unless `--allow-unstamped`).

#### Scenario: Uncommitted changes are not shipped

- **WHEN** the working tree has uncommitted changes to `src/`
- **THEN** the deployed image contains only the committed HEAD sources

#### Scenario: Prod runs a commit HEAD does not contain

- **WHEN** the running container's `clack.build-sha` is not an ancestor of HEAD
- **THEN** the deploy aborts before building, naming both commits

#### Scenario: Prod runs HEAD already

- **WHEN** the running container's `clack.build-sha` equals HEAD
- **THEN** the deploy aborts before building unless `--redeploy` is passed

### Requirement: Sidecars Change Only With Cause

When the tester is enabled, the deploy SHALL create the `clack-playwright` sidecar only when it is missing, and SHALL recreate it only when the Playwright config file's content differs from the copy on the VM. It SHALL pull a sidecar image only when that image is absent on the VM, or when `--refresh-sidecars` is passed. The Playwright config SHALL be written to the VM only when its content differs.

#### Scenario: Unchanged sidecar left running

- **WHEN** the deploy runs, the Playwright sidecar is running, and the config file is identical on both sides
- **THEN** the sidecar is not stopped, recreated, or re-pulled

#### Scenario: Changed config recreates the sidecar

- **WHEN** the Playwright config file differs from the VM copy
- **THEN** the new config is written and the sidecar is recreated on its existing image
