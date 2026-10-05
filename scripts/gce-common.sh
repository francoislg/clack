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

# Local paths (resolved relative to this file's location)
GCE_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$GCE_COMMON_DIR")"
DATA_DIR="$PROJECT_DIR/data"
AUTH_DIR="$DATA_DIR/auth"

# Instance settings: environment variables, else data/gce.env (gitignored; copy
# data/gce.env.example). An environment variable wins over the file.
GCE_ENV_FILE="$DATA_DIR/gce.env"
if [ -f "$GCE_ENV_FILE" ]; then
    while IFS='=' read -r key value || [ -n "$key" ]; do
        case "$key" in
            *[!A-Z0-9_]*) ;;
            GCE_[A-Z0-9_]*)
                value="${value%\"}"
                value="${value#\"}"
                [ -n "${!key:-}" ] || export "$key=$value"
                ;;
        esac
    done < "$GCE_ENV_FILE"
fi

PROJECT_ID="${GCE_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
INSTANCE_NAME="${GCE_INSTANCE:-clack}"
ZONE="${GCE_ZONE:-}"
MACHINE_TYPE="${GCE_MACHINE_TYPE:-e2-standard-2}"
# Source ranges the SSH firewall rule admits (provisioning only): the IAP
# TCP-forwarding range, since every connection goes through IAP.
SSH_SOURCE_RANGES="${GCE_SSH_SOURCE_RANGES:-}"

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
// String() so a number arg isn't ANSI-colorized under FORCE_COLOR (which would
// break the `$(( ))` reserve arithmetic in gce-deploy.sh).
console.log(String(Number.isInteger(v) && v >= 0 ? v : 0));
" 2>/dev/null || echo 0
}

# Artifact Registry: region is derived from ZONE by stripping the trailing
# zone-letter suffix (e.g. us-central1-a -> us-central1) so the registry and the
# VM always live in the same region.
AR_REGION="${ZONE%-*}"
AR_REPO="${GCE_AR_REPO:-clack}"
IMAGE_NAME="${AR_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clack:latest"
# Pinned tools base image (system deps + github-mcp-server + optional per-instance
# overlay). The app image builds FROM a content-addressed `…/clack:tools-<hash>`
# derived in gce-deploy.sh, so it is rebuilt only when its inputs change.
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

# Runs `gcloud compute ssh` on the VM through IAP; the SSH firewall rule admits
# only the IAP range. Pass the remaining flags, e.g. gce_ssh --command="...".
gce_ssh() {
    gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --tunnel-through-iap "$@"
}

require_settings() {
    if [ -z "$PROJECT_ID" ]; then
        echo -e "${RED}✗ No GCP project set. Set GCE_PROJECT in data/gce.env, or run: gcloud config set project YOUR_PROJECT${NC}"
        exit 1
    fi
    if [ -z "$ZONE" ]; then
        echo -e "${RED}✗ No zone set. Set GCE_ZONE in data/gce.env (see data/gce.env.example).${NC}"
        exit 1
    fi
}

require_instance() {
    if ! gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" &>/dev/null; then
        echo -e "${RED}✗ Instance '$INSTANCE_NAME' not found in zone '$ZONE'.${NC}"
        echo "  Run scripts/gce-deploy.sh --provision first to create it."
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

# Wait, with the bot still running and accepting everything, until its /status
# reports busy=false (the same definition the in-process shutdown drain uses).
# Polls inside the clack container (its own loopback + STATUS_PORT) every 5s and
# prints what is still running whenever that changes, and at least every 30s.
#   wait_for_idle <max-secs>
# Returns 0 once idle, 10 when still busy at <max-secs>, 11 when there is nothing
# to wait on or read (no running clack container, unreachable endpoint,
# unexpected payload, invalid <max-secs>), and any other code when ssh fails.
wait_for_idle() {
    gce_ssh --command="
        docker ps --format '{{.Names}}' | grep -qx clack || { echo 'Idle wait: clack container not running'; exit 11; }
        docker exec -i -e IDLE_MAX_WAIT=$1 clack node --input-type=module -" <<'JS'
const capMs = Number(process.env.IDLE_MAX_WAIT) * 1000;
if (!Number.isFinite(capMs)) {
  console.log(`Idle wait: invalid max wait '${process.env.IDLE_MAX_WAIT}'`);
  process.exit(11);
}
const url = `http://127.0.0.1:${process.env.STATUS_PORT || 8787}/status`;
const start = Date.now();
const fmt = (ms) => `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
let lastLine = "";
let lastPrintAt = 0;
for (;;) {
  let status;
  try {
    status = await (await fetch(url, { signal: AbortSignal.timeout(10000) })).json();
  } catch (err) {
    console.log(`Idle wait: status endpoint unreachable (${err.message})`);
    process.exit(11);
  }
  if (
    typeof status?.busy !== "boolean" ||
    !Array.isArray(status.activeRuns?.runs) ||
    !Array.isArray(status.workers?.changes)
  ) {
    console.log("Idle wait: status endpoint returned an unexpected payload");
    process.exit(11);
  }
  const elapsed = Date.now() - start;
  if (!status.busy) {
    console.log(`Idle after ${fmt(elapsed)}`);
    process.exit(0);
  }
  if (elapsed >= capMs) process.exit(10);
  const line = [
    ...status.activeRuns.runs.map((r) => `run ${r.channel}/${r.thread} ${r.status} ${fmt(r.ageMs)}`),
    ...status.workers.changes.map((c) => `change ${c.repo}@${c.branch} ${c.status} ${fmt(c.ageMs)}`),
  ].join("; ");
  if (line !== lastLine || Date.now() - lastPrintAt >= 30000) {
    console.log(`Waiting for idle — ${fmt(elapsed)} elapsed: ${line}`);
    lastLine = line;
    lastPrintAt = Date.now();
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
JS
}
