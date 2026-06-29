## Why

Google Container Registry (GCR) is deprecated — `gcr.io` is frozen and Google has shut down new GCR usage in favor of Artifact Registry (AR). The deploy scripts push and pull `gcr.io/${PROJECT_ID}/clack:latest`, which will stop working as GCR is fully retired. Migrating now keeps deploys functioning and aligns with Google's supported registry.

## What Changes

- Replace the image reference `gcr.io/${PROJECT_ID}/clack:latest` with an Artifact Registry path `${AR_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clack:latest` (single source of truth in `scripts/gce-common.sh`).
- Enable `artifactregistry.googleapis.com` instead of `containerregistry.googleapis.com` in `gce-update-image.sh` and `gce-deploy.sh`.
- Point the on-VM Docker credential helper at the AR host: `docker-credential-gcr configure-docker --registries=${AR_REGION}-docker.pkg.dev`.
- Provision the AR Docker repository as a one-time setup step (AR does not auto-create repos the way GCR did) and ensure the VM service account has `roles/artifactregistry.reader`.
- `gcloud builds submit --tag` and `docker pull` need no logic changes — they follow the tag.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `docker-deployment`: the GCE Deployment Script requirement changes from pushing/pulling via GCR to Artifact Registry, including the one-time AR repository provisioning and VM read access.

## Impact

- Scripts: `scripts/gce-common.sh`, `scripts/gce-update-image.sh`, `scripts/gce-deploy.sh`.
- GCP resources: a new Artifact Registry Docker repository; IAM grant of `roles/artifactregistry.reader` to the VM's service account; `artifactregistry.googleapis.com` API enablement.
- No application code, `Dockerfile`, or `docker-setup.sh` changes. The `/deploy` skill is unaffected (same script entry points and phases).
- Operational: existing `gcr.io` images can be left to age out; the first AR deploy must run after the repo and IAM grant exist.
