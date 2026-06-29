## 1. Image reference (single source of truth)

- [x] 1.1 In `scripts/gce-common.sh`, add `AR_REGION` derived from `ZONE` (strip the trailing `-<letter>`, e.g. `northamerica-northeast1-a` → `northamerica-northeast1`) and `AR_REPO="clack"`
- [x] 1.2 Replace `IMAGE_NAME="gcr.io/${PROJECT_ID}/clack:latest"` with `IMAGE_NAME="${AR_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clack:latest"`
- [x] 1.3 Add a `require_ar_repo` helper to `gce-common.sh` that idempotently `describe`-or-`create`s the AR Docker repo in `AR_REGION` (mirroring the existing network/disk guards)

## 2. Update gce-update-image.sh

- [x] 2.1 Swap `gcloud services enable containerregistry.googleapis.com` → `artifactregistry.googleapis.com`
- [x] 2.2 Call `require_ar_repo` before `gcloud builds submit`
- [x] 2.3 Change the on-VM credential helper to `docker-credential-gcr configure-docker --registries=${AR_REGION}-docker.pkg.dev`

## 3. Update gce-deploy.sh

- [x] 3.1 Swap `gcloud services enable containerregistry.googleapis.com` → `artifactregistry.googleapis.com`
- [x] 3.2 Call `require_ar_repo` before `gcloud builds submit`
- [x] 3.3 Change the on-VM credential helper to `docker-credential-gcr configure-docker --registries=${AR_REGION}-docker.pkg.dev`
- [x] 3.4 In `gce-deploy.sh`, after instance creation (first-time path, i.e. the instance-doesn't-exist branch), grant `roles/artifactregistry.reader` at project level to the VM's default compute service account via `gcloud projects add-iam-policy-binding`. Manual-grant command documented as a code comment next to the IAM step (and in the `/deploy` skill's failure modes); README has no deploy section to update.

## 4. Verify

- [x] 4.1 Confirm no remaining `gcr.io` / `containerregistry.googleapis.com` references in `scripts/` (`grep -rn "gcr.io\|containerregistry" scripts/`)
- [ ] 4.2 Run an AR-aware deploy on the target project; confirm Cloud Build pushes to AR and the VM pulls successfully (SSH into the VM and run `docker inspect` there — the image ref should point to `*-docker.pkg.dev`) — _deploy-time step; run via `/deploy`_
- [ ] 4.3 Confirm the container is healthy via `GET /status` after the swap — _deploy-time step_
- [x] 4.4 Update README deploy notes if they mention GCR — _no-op: README has no GCR/deploy references_
