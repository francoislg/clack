## ADDED Requirements

### Requirement: Tools Base Image

The system SHALL provide a pinned tools base image (`clack:tools`) that carries the rarely-changing system layer, and the application image SHALL build `FROM` it rather than installing those layers directly. Throughout this capability, `clack:tools` and `clack:tools-base` denote the Artifact-Registry-qualified image references (`<region>-docker.pkg.dev/<project>/<repo>/clack:tools` and `…/clack:tools-base`); every Docker `FROM` clause uses the full reference, since a bare name would resolve to Docker Hub.

#### Scenario: Generic tools image contents

- **WHEN** the generic tools image (`clack:tools-base`) is built from `Dockerfile.tools`
- **THEN** it is based on `node:22-alpine`
- **AND** it installs `git`, `curl`, `bash`, `ffmpeg`, and `lsof`
- **AND** it enables `corepack`
- **AND** it installs the `github-mcp-server` binary at `/usr/local/bin/github-mcp-server`, its version controlled by the `GITHUB_MCP_SERVER_VERSION` build arg

#### Scenario: Application image builds from the tools image

- **WHEN** the application `Dockerfile` production stage is built
- **THEN** it bases `FROM ${TOOLS_IMAGE}`, a global build arg defaulting to the bare `clack:tools` and supplied by the deploy as the AR-qualified reference via `--build-arg`
- **AND** the checked-in `Dockerfile` contains no hardcoded Artifact Registry path
- **AND** it does not re-run `apk add` for the tools-image system dependencies
- **AND** it does not download the `github-mcp-server` binary
- **AND** the builder stage remains `node:22-alpine`, matching the tools base image's Node major version

#### Scenario: Runtime container behavior unchanged

- **WHEN** the resulting application image runs
- **THEN** the application runs as the non-root `clack` user
- **AND** the same volume mount points, published status port, and data-disk behavior apply as before this change

### Requirement: Conditional Tools Image Rebuild

The GCE image-update deploy SHALL rebuild and push the tools image only when its inputs change, and SHALL otherwise reuse the already-pushed tools image, so a code-only deploy runs a single application build.

#### Scenario: Tools inputs unchanged — reuse

- **WHEN** `scripts/gce-update-image.sh` runs
- **AND** an image tagged with the current tools content hash (`clack:tools-<hash>`) already exists in Artifact Registry
- **THEN** the script does not rebuild the tools image
- **AND** it runs a single application build producing `clack:latest`, passing `--build-arg TOOLS_IMAGE=…/clack:tools-<hash>`

#### Scenario: Tools inputs changed — rebuild

- **WHEN** `scripts/gce-update-image.sh` runs
- **AND** no image tagged with the current tools content hash exists in Artifact Registry
- **THEN** the script builds the tools image and pushes it as `clack:tools-<hash>` (content-addressed; no mutable `clack:tools` tag)
- **AND** it then runs the application build with `--build-arg TOOLS_IMAGE=…/clack:tools-<hash>`

#### Scenario: Content hash covers tools inputs

- **WHEN** the tools content hash is computed
- **THEN** it is a SHA-256 digest derived from the full contents of `Dockerfile.tools`
- **AND** when the per-instance overlay directory (`data/docker/`) is present, the contents of every file under it are included in the hash (a superset of the overlay build inputs — an edit to an unbuilt file such as the README merely triggers a harmless extra tools rebuild)
- **AND** an edit to the system-dependency list or the `github-mcp-server` version changes the hash

#### Scenario: Bootstrap on a fresh registry

- **WHEN** `scripts/gce-update-image.sh` runs against an Artifact Registry with no tools image
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

### Requirement: Per-Instance Tools Overlay

When a per-instance overlay Dockerfile is present, it SHALL layer on the tools base image (not on the deployed application image) and be rebuilt only together with the tools image, preserving the in-image hook path referenced by worker settings.

#### Scenario: Overlay present

- **WHEN** `data/docker/Dockerfile.custom` exists and the tools image is (re)built
- **THEN** the generic tools image is pushed to the mutable `clack:tools-base` and the overlay is built `FROM clack:tools-base`
- **AND** it installs `jq` and the `claude-dont` hook at `/opt/worker-hooks/claude-dont/`, staying root (the app stage owns the final `USER clack` switch)
- **AND** the overlay result is pushed as the content-addressed `clack:tools-<hash>`
- **AND** no separate overlay build runs on top of the application image

#### Scenario: Overlay absent

- **WHEN** `data/docker/Dockerfile.custom` does not exist
- **THEN** `Dockerfile.tools` is built straight to `clack:tools-<hash>` with no second build
- **AND** the application image builds `FROM` that same `clack:tools-<hash>` exactly as with an overlay present

#### Scenario: Overlay rebuilt only with tools inputs

- **WHEN** only application source changes between deploys and the overlay tree is unchanged
- **THEN** the overlay is not rebuilt (the tools content hash is unchanged, so the tools tag already exists)
- **AND** the deploy runs a single application build `FROM` the existing `clack:tools-<hash>`

## MODIFIED Requirements

### Requirement: Dockerfile
The system SHALL provide a Dockerfile that builds a production-ready container image.

#### Scenario: Multi-stage build
- **WHEN** Docker image is built
- **THEN** TypeScript compilation occurs in a builder stage
- **AND** only production artifacts are copied to the final image

#### Scenario: Required system dependencies
- **WHEN** Docker image is built
- **THEN** the image includes git and the `github-mcp-server` binary
- **AND** those dependencies are provided by the `clack:tools` base image the production stage builds `FROM`, not installed in the application Dockerfile

#### Scenario: Non-root user
- **WHEN** container runs
- **THEN** the application runs as a non-root user named "clack"

#### Scenario: Volume mount points
- **WHEN** container runs
- **THEN** `/app/data/config.json` is mountable for configuration
- **AND** `/app/data/auth/` is mountable for credentials
- **AND** `/app/data/repositories/` is mountable for persistence

### Requirement: GitHub MCP Server Binary

The system SHALL include the `github-mcp-server` binary in the Docker image, provided via the `clack:tools` base image.

#### Scenario: Binary installed in the tools base image
- **WHEN** the `clack:tools-base` image is built from `Dockerfile.tools`
- **THEN** the `github-mcp-server` static binary is downloaded from the official GitHub releases
- **AND** installed to `/usr/local/bin/github-mcp-server`
- **AND** the version is controlled by a build arg `GITHUB_MCP_SERVER_VERSION`
- **AND** the application image inherits the binary by building `FROM clack:tools`

#### Scenario: Binary works on Alpine
- **WHEN** the binary is downloaded
- **THEN** it is the `Linux_x86_64` variant (statically compiled, no glibc dependency)
- **AND** it runs correctly on the `node:22-alpine` tools base image
