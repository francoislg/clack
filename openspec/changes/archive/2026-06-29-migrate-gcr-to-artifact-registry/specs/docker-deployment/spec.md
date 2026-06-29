## MODIFIED Requirements

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

## ADDED Requirements

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
