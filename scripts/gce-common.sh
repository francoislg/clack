#!/bin/bash
# Shared configuration for the gce-* scripts. Source this file from each script.
#
#   source "$(dirname "${BASH_SOURCE[0]}")/gce-common.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# GCP / instance config
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
INSTANCE_NAME="clack"
ZONE="northamerica-northeast1-a"
MACHINE_TYPE="e2-standard-2"

# Container memory limits. The clack container's cap is computed ON THE VM as
# total memory minus these reserves, so a machine-type bump raises it
# automatically. A runaway worker job (e.g. a monorepo pnpm install) then gets
# OOM-killed inside the container instead of thrashing the host to death —
# that wedged the whole VM (SSH included) on 2026-07-02. The sidecar reserve
# applies only when config.tester.enabled (Chromium peaked ~704 MiB in live runs).
HOST_RESERVE_MB=384
SIDECAR_MEM_MB=896

# Tester-services control plane: a restricted docker-socket-proxy that lets Clack
# provision per-repo service containers (mysql, redis, ...) for tester runs. Deployed
# (and its reserve applied) only when config.tester.enabled; the per-repo services
# themselves are additionally budgeted by config.tester.servicesBudgetMb.
PROXY_IMAGE="tecnativa/docker-socket-proxy:latest"
PROXY_CONTAINER_NAME="clack-docker-proxy"
PROXY_MEM_MB=64

# "true"/"false": whether the local config enables the tester feature (drives
# the sidecar container + the sidecar memory reserve). Callers use this both
# before `docker run` (memory math) and in the sidecar deploy phase.
read_tester_enabled() {
    node --input-type=module -e "
import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('$DATA_DIR/config.json', 'utf-8'));
console.log(c.tester?.enabled === true ? 'true' : 'false');
" 2>/dev/null || echo false
}

# Memory (MB) reserved for per-repo tester service containers, from the local
# config's tester.servicesBudgetMb (0 when absent/invalid — no services can run).
read_tester_services_budget() {
    node --input-type=module -e "
import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('$DATA_DIR/config.json', 'utf-8'));
const v = c.tester?.servicesBudgetMb;
console.log(Number.isInteger(v) && v >= 0 ? v : 0);
" 2>/dev/null || echo 0
}

# Artifact Registry: region is derived from ZONE by stripping the trailing
# zone-letter suffix (northamerica-northeast1-a -> northamerica-northeast1) so
# the registry and the VM always live in the same region.
AR_REGION="${ZONE%-*}"
AR_REPO="clack"
IMAGE_NAME="${AR_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clack:latest"
# Pinned tools base image (system deps + github-mcp-server + optional per-instance
# overlay). The app image builds FROM a content-addressed `…/clack:tools-<hash>`
# derived in gce-update-image.sh, so it is rebuilt only when its inputs change.
# TOOLS_IMAGE_NAME is the `…/clack:tools` PREFIX the hash suffix is appended to (no
# mutable `:tools` tag is pushed). TOOLS_BASE_IMAGE_NAME is the mutable base the
# per-instance overlay builds FROM when data/docker/Dockerfile.custom exists.
TOOLS_IMAGE_NAME="${AR_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clack:tools"
TOOLS_BASE_IMAGE_NAME="${AR_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clack:tools-base"
# BuildKit registry build cache for the app image (npm ci layers). A build-time
# cache artifact ONLY — never deployed, never pulled by the VM. The app build
# imports/exports it so an unchanged package-lock.json restores npm ci from cache.
BUILDCACHE_IMAGE_NAME="${AR_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clack:buildcache"

DATA_DISK_NAME="clack-data"
DATA_DISK_SIZE="20GB"
DATA_DISK_TYPE="pd-balanced"
DATA_DISK_DEVICE_NAME="clack-data"
DATA_MOUNT_POINT="/mnt/disks/clack-data"
REMOTE_DATA_DIR="$DATA_MOUNT_POINT/data"

NETWORK_NAME="clack-network"
SSH_FIREWALL_RULE="clack-allow-ssh"

# Local paths (resolved relative to this file's location)
GCE_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$GCE_COMMON_DIR")"
DATA_DIR="$PROJECT_DIR/data"
AUTH_DIR="$DATA_DIR/auth"

# Caches and locally-regeneratable artifacts. Skipped by both upload and download.
DATA_TAR_EXCLUDES=(
    --exclude='data/.npm'
    --exclude='data/.claude'
    --exclude='data/cache'
    --exclude='data/mcp_packages'
    --exclude='data/error-reports'
    --exclude='data/.pnpm-store'
    --exclude='.DS_Store'
)

require_project() {
    if [ -z "$PROJECT_ID" ]; then
        echo -e "${RED}✗ No GCP project set. Run: gcloud config set project YOUR_PROJECT${NC}"
        exit 1
    fi
}

require_instance() {
    if ! gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" &>/dev/null; then
        echo -e "${RED}✗ Instance '$INSTANCE_NAME' not found in zone '$ZONE'.${NC}"
        echo "  Run scripts/gce-deploy.sh first to create it."
        exit 1
    fi
}

# Idempotently ensure the Artifact Registry Docker repo exists in AR_REGION.
# Unlike GCR, Artifact Registry does not auto-create repos on first push, so
# this must run before `gcloud builds submit`.
require_ar_repo() {
    if gcloud artifacts repositories describe "$AR_REPO" --location="$AR_REGION" &>/dev/null; then
        return 0
    fi
    echo -e "${YELLOW}Creating Artifact Registry repo '$AR_REPO' in '$AR_REGION'...${NC}"
    gcloud artifacts repositories create "$AR_REPO" \
        --repository-format=docker \
        --location="$AR_REGION" \
        --description="Clack container images" \
        --quiet
    echo -e "${GREEN}✓ Artifact Registry repo ready${NC}"
}

# Verify the container user (clack, uid 1001) can actually READ the given paths.
# A push/sync can "succeed" yet leave files the app can't read — a source file in
# a restrictive mode, or ownership the container uid doesn't match — which then
# surfaces as an EACCES at prompt-build time (e.g. a cron fire failing hours
# later). This checks read+traverse access as the container user itself, so it
# catches the problem at deploy time regardless of cause.
#
# Args are CONTAINER-absolute paths (the data disk mounts at /app/data), e.g.
#   verify_container_reads /app/data/config.json /app/data/default_configuration
# Returns non-zero and lists the offenders if anything is unreadable. If the
# container isn't running there is nothing to validate against, so it passes with
# a note. The image is alpine/busybox, so this uses POSIX test, not `find -readable`.
verify_container_reads() {
    local paths="$*"
    [ -z "$paths" ] && return 0

    local out
    out=$(gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
        docker ps --format '{{.Names}}' | grep -q '^clack\$' || { echo '__NOCONTAINER__'; exit 0; }
        docker exec clack sh -c '
            for p in $paths; do
                [ -e \"\$p\" ] || continue
                find \"\$p\" 2>/dev/null | while IFS= read -r e; do
                    if [ -d \"\$e\" ]; then
                        { [ -r \"\$e\" ] && [ -x \"\$e\" ]; } || echo \"\$e\"
                    else
                        [ -r \"\$e\" ] || echo \"\$e\"
                    fi
                done
            done
        '
    " 2>/dev/null)

    if printf '%s' "$out" | grep -q '__NOCONTAINER__'; then
        echo -e "${YELLOW}  (clack container not running — skipped read-access check)${NC}"
        return 0
    fi
    if [ -n "$out" ]; then
        echo -e "${RED}  ✗ container user (uid 1001) cannot read these pushed paths:${NC}"
        printf '%s\n' "$out" | while IFS= read -r line; do echo "      $line"; done
        return 1
    fi
    echo -e "${GREEN}  ✓ container read-access verified${NC}"
    return 0
}
