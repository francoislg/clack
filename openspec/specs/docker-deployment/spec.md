# docker-deployment Specification

## Purpose
TBD - created by archiving change add-docker-setup. Update Purpose after archive.
## Requirements
### Requirement: Docker Setup Script
The system SHALL provide an interactive setup script that configures credentials required for Docker deployment.

#### Scenario: Script creates auth directory structure
- **WHEN** `scripts/docker-setup.sh` is executed
- **THEN** the script creates `data/auth/` directory if it doesn't exist

#### Scenario: Missing config file
- **WHEN** `data/config.json` does not exist
- **THEN** the script offers to copy from `data/config.example.json`
- **AND** opens the file in `$EDITOR` for customization

#### Scenario: GitHub App credentials configuration
- **WHEN** no `data/auth/github.json` exists
- **THEN** the script prompts for GitHub App ID, Installation ID, and private key path
- **AND** copies the private key to `data/auth/github-app.pem`
- **AND** sets correct permissions (600 for private key)
- **AND** saves credentials to `data/auth/github.json`

#### Scenario: GitHub App instructions displayed
- **WHEN** GitHub App credentials are not yet configured
- **THEN** the script displays instructions for creating a GitHub App
- **AND** lists the required permissions: `contents: read & write`, `pull_requests: read & write`, `metadata: read`
- **AND** explains how to install the app on the target organization
- **AND** explains where to find the App ID and Installation ID

#### Scenario: Slack credentials configuration
- **WHEN** no `data/auth/slack.json` exists
- **THEN** the script prompts for bot token, app token, and signing secret
- **AND** validates token formats (xoxb-* for bot, xapp-* for app)
- **AND** saves credentials to `data/auth/slack.json`

#### Scenario: API key configuration
- **WHEN** no `ANTHROPIC_API_KEY` is configured in `data/auth/.env`
- **THEN** the script prompts for the API key
- **AND** saves it to `data/auth/.env`

#### Scenario: Credential validation
- **WHEN** setup completes
- **THEN** the script validates GitHub App credentials exist and private key is present
- **AND** validates Slack tokens match expected formats
- **AND** validates Claude authentication is configured
- **AND** validates `data/config.json` exists and is readable

#### Scenario: Docker command output
- **WHEN** all validations pass
- **THEN** the script outputs the complete `docker build` and `docker run` commands

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

### Requirement: Auth Directory Structure
The system SHALL use a dedicated auth directory for all credentials.

#### Scenario: Auth directory gitignored
- **WHEN** credentials are stored in `data/auth/`
- **THEN** the contents are excluded from git via `.gitignore`
- **AND** example files are preserved for reference

#### Scenario: GitHub App credentials location
- **WHEN** Docker container runs
- **THEN** GitHub App config is loaded from `data/auth/github.json`
- **AND** the private key is loaded from the path specified in the config

#### Scenario: Slack credentials location
- **WHEN** Docker container runs
- **THEN** Slack tokens are loaded from `data/auth/slack.json`

#### Scenario: Environment file location
- **WHEN** Docker container runs
- **THEN** Claude authentication is loaded from `data/auth/.env`
- **AND** supports either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`

### Requirement: Slack Credential Separation
The system SHALL load Slack credentials from a separate auth file.

#### Scenario: Slack auth file format
- **WHEN** `data/auth/slack.json` is read
- **THEN** it contains `botToken`, `appToken`, and `signingSecret` fields

#### Scenario: Config file without Slack secrets
- **WHEN** `data/config.json` is read
- **THEN** it does not contain Slack token fields
- **AND** it contains only non-sensitive configuration (reactions, repos, settings)

#### Scenario: Missing Slack auth file
- **WHEN** `data/auth/slack.json` does not exist
- **THEN** the application exits with clear error message
- **AND** the error message explains how to create the file or run setup script

#### Scenario: Migration from old config format
- **WHEN** setup script detects Slack tokens in `data/config.json`
- **THEN** it offers to migrate them to `data/auth/slack.json`
- **AND** removes tokens from `data/config.json` after successful migration

### Requirement: Docker Ignore
The system SHALL provide a `.dockerignore` file for build optimization.

#### Scenario: Exclude development files
- **WHEN** Docker image is built
- **THEN** `node_modules/`, `dist/`, `.git/`, and IDE files are excluded from context

#### Scenario: Exclude sensitive data
- **WHEN** Docker image is built
- **THEN** `data/config.json`, `data/auth/`, and `data/repositories/` are excluded from context

### Requirement: GCE Deployment Script
The system SHALL provide a deployment script for Google Compute Engine that builds and distributes the container image via Google Artifact Registry.

#### Scenario: Deploy to GCE
- **WHEN** `npm run deploy:gce` is executed
- **THEN** the script enables `artifactregistry.googleapis.com`
- **AND** builds and pushes the Docker image to an Artifact Registry Docker repository (image path `<region>-docker.pkg.dev/<project>/<repo>/clack:latest`)
- **AND** creates or updates an e2-micro VM instance
- **AND** copies config/auth files to the instance
- **AND** runs the container with persistent volume for repositories

#### Scenario: GCE prerequisites check
- **WHEN** the deploy script runs
- **THEN** it verifies GCP project is set
- **AND** verifies auth files exist from docker-setup

#### Scenario: Existing instance update
- **WHEN** the instance already exists
- **THEN** the script prompts before updating
- **AND** pulls the latest image from Artifact Registry and restarts the container

#### Scenario: Image reference is a single source of truth
- **WHEN** any gce-* script needs the image reference
- **THEN** it reads `IMAGE_NAME` from `scripts/gce-common.sh`
- **AND** `IMAGE_NAME` resolves to the Artifact Registry path (not a `gcr.io` path)

#### Scenario: VM authenticates to Artifact Registry
- **WHEN** the VM pulls the image during a deploy or image update
- **THEN** the Docker credential helper is configured for the Artifact Registry host (`<region>-docker.pkg.dev`)
- **AND** the VM service account has at least `roles/artifactregistry.reader` covering the repository (granted at project or repository scope — project-level by default per design)

#### Scenario: VM service account lacks read access
- **WHEN** the VM pulls the image but its service account lacks `roles/artifactregistry.reader`
- **THEN** the pull fails with a 403 error (Artifact Registry is strictly IAM-gated, unlike GCR's backing bucket)
- **AND** the operator must grant the role before the pull can succeed

### Requirement: Artifact Registry Repository Provisioning
The deployment process SHALL provision a Google Artifact Registry Docker repository before the first image push, since Artifact Registry does not auto-create repositories.

#### Scenario: Repository created once in the deploy region
- **WHEN** the AR repository does not yet exist
- **THEN** a one-time `gcloud artifacts repositories create` step creates a Docker-format repository in the same region as the VM zone
- **AND** subsequent deploys reuse the existing repository without recreating it

#### Scenario: Region matches the VM zone
- **WHEN** the Artifact Registry repository is created
- **THEN** its location is the region derived from the VM `ZONE` by removing the trailing zone-letter suffix (e.g. `northamerica-northeast1-a` → `northamerica-northeast1`)
- **AND** the image path region in `IMAGE_NAME` matches that location

### Requirement: Change Workflow Setup Instructions

The system SHALL provide setup instructions for enabling the change request workflow.

#### Scenario: Docker setup prompts for change workflow
- **WHEN** running `scripts/docker-setup.sh`
- **THEN** the script asks if the user wants to enable change requests
- **AND** explains that this allows devs to create PRs through Slack
- **AND** warns about the additional permissions required

#### Scenario: GitHub App write permissions for changes
- **GIVEN** the user enables change workflow
- **WHEN** the setup script runs
- **THEN** it explains that the GitHub App needs Contents: Read & write permission
- **AND** explains that the GitHub App needs Pull requests: Read & write permission

### Requirement: Worktree Volume Mount

The system SHALL support volume mounting for worktrees in Docker.

#### Scenario: Worktree volume in docker run command
- **GIVEN** change workflow is enabled
- **WHEN** the setup script outputs docker commands
- **THEN** it includes a volume mount for `data/worktrees/`
- **AND** the mount is read-write (not `:ro`)

#### Scenario: Worktree directory permissions
- **WHEN** the Docker container runs with change workflow enabled
- **THEN** the `clack` user has write permissions to `data/worktrees/`
- **AND** can create and delete directories

### Requirement: GitHub API Access via Octokit

The system SHALL use the Octokit library with GitHub App authentication for all GitHub API operations.

#### Scenario: Octokit client initialization
- **WHEN** the application starts
- **THEN** it validates GitHub App credentials (App ID, Installation ID, private key)
- **AND** generates a test installation token to verify access

#### Scenario: PR operations via Octokit
- **WHEN** change workflow is enabled
- **THEN** PR creation, merge, close, and review operations use Octokit API calls
- **AND** no external CLI tools are required for GitHub operations

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

### Requirement: Status Port Published to Loopback

The GCE image-update deploy SHALL run the container with the runtime status port published to the VM's loopback interface only, so the deploy script can poll `GET /status` from the VM host. The port SHALL NOT be published on a public interface.

#### Scenario: Container publishes status port to localhost

- **WHEN** `scripts/gce-update-image.sh` runs the new container
- **THEN** the `docker run` command publishes the status port as `127.0.0.1:<port>:<port>`
- **AND** the port is reachable as `localhost:<port>` from the VM host
- **AND** it is not bound to a public address

### Requirement: Pre-Swap Drain Gate

Before stopping the old container, the deploy SHALL wait for the running bot to become idle by polling `GET /status` until `busy` is `false`, subject to a bounded maximum wait. The drain gate SHALL run after the no-downtime preparation phases and before the container swap, so the downtime window lands on an idle bot.

#### Scenario: Idle bot proceeds immediately

- **WHEN** the drain gate polls `GET /status`
- **AND** the response has `busy == false`
- **THEN** the deploy proceeds to the container swap without waiting

#### Scenario: Busy bot is waited on

- **WHEN** the drain gate polls `GET /status`
- **AND** the response has `busy == true`
- **AND** the maximum wait has not been exceeded
- **THEN** the deploy keeps waiting and re-polls
- **AND** it prints a progress line indicating the number of active runs and busy workers

#### Scenario: Bounded wait then proceed

- **WHEN** the bot is still `busy` after the maximum wait elapses
- **THEN** the deploy prints the still-active counts (active query runs and executing changes)
- **AND** proceeds with the container swap anyway

#### Scenario: Status unreachable does not block deploy

- **WHEN** the drain gate cannot reach `GET /status` (e.g. an older image without the endpoint)
- **THEN** the deploy logs that the drain check was skipped
- **AND** proceeds with the container swap

### Requirement: Deploy Skill Surfaces the Drain Phase

The `/deploy` skill SHALL surface the drain phase to the operator: its Monitor output filter SHALL match the drain progress markers, and its phase-acknowledgement guidance SHALL include the drain phase so the operator understands why the deploy may pause before the swap.

#### Scenario: Skill acknowledges the drain phase

- **WHEN** the deploy emits drain-phase output
- **THEN** the skill's Monitor filter captures the drain markers
- **AND** the skill has a phase-acknowledgement entry for the drain phase

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

