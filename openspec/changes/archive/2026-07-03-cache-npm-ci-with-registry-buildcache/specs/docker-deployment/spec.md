## ADDED Requirements

### Requirement: Application Build Uses a Registry Build Cache

The GCE image-update deploy SHALL build the application image with a BuildKit registry cache backed by Artifact Registry, so that a build whose `package-lock.json` is unchanged restores the `npm ci` layers from cache instead of reinstalling dependencies. The cache SHALL NOT alter the contents or size of the deployed image.

#### Scenario: Cache imported and exported on every app build

- **WHEN** `scripts/gce-update-image.sh` builds the application image
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
