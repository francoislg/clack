## Context

The GCE deploy path (`scripts/gce-deploy.sh` for first-time provisioning, `scripts/gce-update-image.sh` for code-only redeploys) builds the image with Cloud Build and distributes it through Google Container Registry (`gcr.io/${PROJECT_ID}/clack:latest`). GCR is deprecated and being retired; pushes/pulls will eventually fail. Artifact Registry (AR) is the supported replacement.

The image reference is centralized as `IMAGE_NAME` in `scripts/gce-common.sh:18`, so the build/push/pull call sites need no path edits — only the variable definition, the API enablement, the credential-helper host, and a new one-time repo-provisioning step change.

Current GCR touch points:
- `gce-common.sh:18` — `IMAGE_NAME="gcr.io/${PROJECT_ID}/clack:latest"`
- `gce-update-image.sh:28`, `gce-deploy.sh:50` — `gcloud services enable containerregistry.googleapis.com`
- `gce-update-image.sh:55`, `gce-deploy.sh:283` — `docker-credential-gcr configure-docker --registries=gcr.io`
- `gcloud builds submit --tag "$IMAGE_NAME"` and `docker pull $IMAGE_NAME` — registry-agnostic, follow the tag.

## Goals / Non-Goals

**Goals:**
- Both deploy scripts push and pull through Artifact Registry.
- The AR repo is provisioned idempotently and the VM can pull from it.
- Keep `IMAGE_NAME` the single source of truth; minimize diff surface.
- No behavior change to the `/deploy` skill (same phases/markers).

**Non-Goals:**
- Migrating or copying existing `gcr.io` images into AR (left to age out).
- Changing application code, `Dockerfile`, or `docker-setup.sh`.
- Multi-region or multi-repo AR layouts — one Docker repo in the VM's region.

## Decisions

**1. Region + repo as new vars in `gce-common.sh`.**
Add `AR_REGION` and `AR_REPO`, then `IMAGE_NAME="${AR_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clack:latest"`. `AR_REGION` derives from the existing `ZONE` (`northamerica-northeast1-a` → `northamerica-northeast1`) so region and zone never drift. `AR_REPO` defaults to `clack`.
*Alternative considered:* hardcoding the full path in each script — rejected, duplicates the reference and defeats the existing single-source pattern.

**2. Keep `docker-credential-gcr`.**
`docker-credential-gcr` supports AR hosts; only the `--registries` value changes to `${AR_REGION}-docker.pkg.dev`. No need to switch to `gcloud auth configure-docker` on the VM (COS already has `docker-credential-gcr`).
*Alternative considered:* `gcloud auth configure-docker <region>-docker.pkg.dev` — works but adds a different tool to the COS path; reusing the existing helper is the smaller change.

**3. Idempotent repo provisioning inside the deploy scripts.**
Before the `gcloud builds submit`, run a `describe`-or-`create` guard so the AR repo is created once and reused. The describe-or-create *pattern* already exists inline in `gce-deploy.sh` for the network (≈ lines 64–73), firewall (≈ 76–89), and data disk (≈ 98–108). Extract it into a new `gce-common.sh` helper (e.g. `require_ar_repo`) — following the helper precedent already set by `require_project`/`require_instance` in `gce-common.sh` — so both first-time and update scripts call one self-healing function. (The inline guards in `gce-deploy.sh` are left as-is; only the AR provisioning is factored into a shared helper.)
*Alternative considered:* a purely manual one-time `gcloud artifacts repositories create` documented in README — rejected, easy to forget and makes `gce-update-image.sh` fail on a fresh project.

**4. VM read access via service-account IAM.**
Grant `roles/artifactregistry.reader` to the VM's service account on the project (or repo). GCR's backing GCS bucket was often broadly readable; AR is strictly IAM-gated, so this is the step most likely to break pulls if missed. Add it to the first-time `gce-deploy.sh` flow (and document it) since that script already manages VM/SA setup.

## Risks / Trade-offs

- **VM SA lacks reader role → `docker pull` 403** → grant `roles/artifactregistry.reader` during `gce-deploy.sh`; document the manual grant for already-provisioned VMs so the first AR `gce-update-image.sh` doesn't fail.
- **Region mismatch between AR repo and VM** → derive `AR_REGION` from `ZONE` so they're always consistent; cross-region pulls would add egress + latency.
- **First AR deploy before repo exists** → the `require_ar_repo` guard creates it; if provisioning is intentionally manual, the guard still no-ops when it already exists.
- **Cloud Build SA push perms** → Cloud Build's default SA has `artifactregistry.writer`, so the push side needs no extra grant; note it as a verification step rather than an action.

## Migration Plan

1. Land script changes (`gce-common.sh`, `gce-update-image.sh`, `gce-deploy.sh`).
2. On the target project: run an AR-aware deploy. `require_ar_repo` creates the repo; ensure the VM SA has `roles/artifactregistry.reader` (the script grants it; for a pre-existing VM, grant manually first).
3. Verify the container is running on the AR-sourced image (`docker inspect` image ref / `/status` healthy).
4. Once stable, optionally delete the old `gcr.io` image.

**Rollback:** revert the three scripts to restore the `gcr.io` `IMAGE_NAME`/API/credential-helper; the old GCR image remains pullable until GCR is fully retired.

## Open Questions

- Repo scope for the IAM grant: project-level `roles/artifactregistry.reader` (simpler) vs repo-scoped (least privilege)? Default to project-level unless least-privilege is required.
