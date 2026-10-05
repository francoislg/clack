#!/bin/bash
# Deploy the committed HEAD to the Clack GCE VM: build the image from a clean
# `git archive` of HEAD (uncommitted work never ships), push it, and swap the
# container. Writes no files under the VM's data directory — data moves only
# through scripts/gce-push.sh and scripts/gce-pull.sh.
#
# Usage: scripts/gce-deploy.sh [--provision] [--redeploy] [--allow-rollback]
#                              [--allow-unstamped] [--refresh-sidecars] [--no-idle-wait]
#   --provision       create missing infrastructure first (VPC, firewall,
#                      disk, VM, mount) and seed the data disk if it is empty
#   --redeploy         rebuild even though prod already runs HEAD
#   --allow-rollback   deploy although prod runs a commit HEAD doesn't contain
#   --allow-unstamped  deploy although prod's image carries no build SHA
#   --refresh-sidecars re-pull the tester sidecar images and recreate them
#   --no-idle-wait     swap right away instead of first waiting for Clack to go idle
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

PROVISION=false
REDEPLOY=false
ALLOW_ROLLBACK=false
ALLOW_UNSTAMPED=false
REFRESH_SIDECARS=false
NO_IDLE_WAIT=false
for arg in "$@"; do
    case "$arg" in
        --provision) PROVISION=true ;;
        --redeploy) REDEPLOY=true ;;
        --allow-rollback) ALLOW_ROLLBACK=true ;;
        --allow-unstamped) ALLOW_UNSTAMPED=true ;;
        --refresh-sidecars) REFRESH_SIDECARS=true ;;
        --no-idle-wait) NO_IDLE_WAIT=true ;;
        -h|--help)
            cat <<'USAGE'
Usage: scripts/gce-deploy.sh [--provision] [--redeploy] [--allow-rollback]
                             [--allow-unstamped] [--refresh-sidecars] [--no-idle-wait]
  --provision        create missing infrastructure first (VPC, firewall,
                     disk, VM, mount) and seed the data disk if it is empty
  --redeploy         rebuild even though prod already runs HEAD
  --allow-rollback   deploy although prod runs a commit HEAD doesn't contain
  --allow-unstamped  deploy although prod's image carries no build SHA
  --refresh-sidecars re-pull the tester sidecar images and recreate them
  --no-idle-wait     swap right away instead of first waiting for Clack to go idle
USAGE
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 1
            ;;
    esac
done

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Clack Deploy${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""
echo "Project: $PROJECT_ID"
echo "Instance: $INSTANCE_NAME"
echo ""

require_settings
if [ "$PROVISION" = true ]; then
    source "$SCRIPT_DIR/lib/gce-provision.sh"
    provision_infra
    seed_data_disk_if_empty
else
    require_instance
fi

BUILD_SHA=$(git -C "$PROJECT_DIR" rev-parse HEAD)
echo -e "${BLUE}Deploying commit ${BUILD_SHA:0:12} — $(git -C "$PROJECT_DIR" log -1 --format=%s)${NC}"
if [ -n "$(git -C "$PROJECT_DIR" status --porcelain --untracked-files=no)" ]; then
    echo -e "${YELLOW}  Uncommitted changes are NOT included — the image is built from HEAD.${NC}"
fi

# Prod SHA gate: compare the running container's build-sha label with HEAD before
# spending a build, refusing the footguns (redeploy, rollback, unstamped).
if ! PROD_LABEL=$(gce_ssh --command="docker inspect clack >/dev/null 2>&1 || { echo __NOCONTAINER__; exit 0; }; docker inspect clack --format '{{index .Config.Labels \"clack.build-sha\"}}'"); then
    echo -e "${RED}✗ Could not reach the VM to read prod's build SHA. Fix connectivity and retry.${NC}"
    exit 1
fi
PROD_SHA=$(printf '%s' "$PROD_LABEL" | tr -d '[:space:]')
if [ "$PROD_SHA" = "__NOCONTAINER__" ]; then
    echo "No running clack container — nothing to compare against."
elif [ -z "$PROD_SHA" ] || [ "$PROD_SHA" = "<novalue>" ]; then
    if [ "$ALLOW_UNSTAMPED" != true ]; then
        echo -e "${RED}✗ Refusing: prod's image carries no build SHA, so there is no way to tell what this deploy would replace. Verify prod, then re-run with --allow-unstamped.${NC}"
        exit 1
    fi
elif [ "$PROD_SHA" = "$BUILD_SHA" ]; then
    if [ "$REDEPLOY" != true ]; then
        echo -e "${RED}✗ Refusing: prod already runs ${BUILD_SHA:0:12}. Re-run with --redeploy to rebuild it anyway.${NC}"
        exit 1
    fi
elif ! git -C "$PROJECT_DIR" merge-base --is-ancestor "$PROD_SHA" "$BUILD_SHA" 2>/dev/null; then
    if [ "$ALLOW_ROLLBACK" != true ]; then
        echo -e "${RED}✗ Refusing: prod runs ${PROD_SHA:0:12}, which HEAD (${BUILD_SHA:0:12}) does not contain — this deploy would roll it back. Re-run with --allow-rollback if that is intended.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Prod runs ${PROD_SHA:0:12}, an ancestor of HEAD${NC}"
fi

# ============================================
# Build and push image
# ============================================
gcloud services enable artifactregistry.googleapis.com --quiet 2>/dev/null || true
require_ar_repo

# Build from a clean checkout of HEAD so uncommitted work never ships.
BUILD_DIR=$(mktemp -d)
git -C "$PROJECT_DIR" archive HEAD | tar -x -C "$BUILD_DIR"

cd "$BUILD_DIR"

# --- Tools base image (system deps + github-mcp-server + optional overlay) ---
# The application image builds FROM a content-addressed tools image, so a normal
# code deploy rebuilds only `npm ci` + `tsc` + copy. The tools tag is a SHA-256
# of Dockerfile.tools plus everything under data/docker/ (the per-instance
# overlay). When that exact tag already exists in Artifact Registry we skip the
# tools build entirely; otherwise we build it once. The immutable `…:tools-<hash>`
# reference is passed to the app build via --build-arg TOOLS_IMAGE, so there is
# no mutable tag to reconcile. See the docker-deployment spec for the contract.
CUSTOM_DOCKERFILE="$DATA_DIR/docker/Dockerfile.custom"

# SHA-256 over the full tools inputs. Hashing the whole data/docker/ tree (rather
# than an enumerated file list) can never drift from what the overlay COPYs in;
# an edit to an unbuilt file there merely triggers a harmless extra tools build.
tools_hash_inputs() {
    cat Dockerfile.tools
    if [ -d "$DATA_DIR/docker" ]; then
        find "$DATA_DIR/docker" -type f | LC_ALL=C sort | while IFS= read -r f; do
            printf '\n== %s ==\n' "${f#"$DATA_DIR/docker/"}"
            cat "$f"
        done
    fi
}
# Clean up any generated Cloud Build configs on every exit path, incl. a failed
# `gcloud builds submit` under set -e (the configs are assigned further below).
trap 'rm -f "${TOOLS_CFG:-}" "${OVERLAY_CFG:-}" "${APP_CFG:-}"; rm -rf "${BUILD_DIR:-}"' EXIT

# `cat Dockerfile.tools` (and thus the hash) fails silently in the subshell
# without pipefail, so guard explicitly: a missing file or a malformed digest
# must abort rather than proceed with a bogus tools tag.
[ -f Dockerfile.tools ] || { echo -e "${RED}✗ Dockerfile.tools not found${NC}"; exit 1; }
TOOLS_HASH=$(tools_hash_inputs | shasum -a 256 | cut -d' ' -f1)
if ! printf '%s' "$TOOLS_HASH" | grep -qE '^[0-9a-f]{64}$'; then
    echo -e "${RED}✗ Failed to compute tools hash${NC}"; exit 1
fi
TOOLS_IMAGE_NAME_HASH="${TOOLS_IMAGE_NAME}-${TOOLS_HASH}"   # …/clack:tools-<hash>

# Reuse when the exact tools tag already exists. The check fails SAFE: any
# non-zero result (not-found, unreachable, credential error) falls through to a
# rebuild rather than reusing a possibly-absent image.
if gcloud artifacts docker images describe "$TOOLS_IMAGE_NAME_HASH" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Tools image up to date (${TOOLS_HASH:0:12}) — skipping tools build${NC}"
else
    echo -e "${YELLOW}Building tools image (${TOOLS_HASH:0:12})...${NC}"
    # gcloud's --tag shorthand requires the context's Dockerfile to be named
    # `Dockerfile`; generated configs let us name Dockerfile.tools / .custom.
    TOOLS_CFG=$(mktemp)
    if [ -f "$CUSTOM_DOCKERFILE" ]; then
        # Generic tools → mutable :tools-base (the overlay FROMs it), then the
        # overlay (context data/docker/) → the content-addressed :tools-<hash>.
        cat > "$TOOLS_CFG" <<EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-f', 'Dockerfile.tools', '-t', '$TOOLS_BASE_IMAGE_NAME', '.']
images: ['$TOOLS_BASE_IMAGE_NAME']
EOF
        gcloud builds submit "$BUILD_DIR" --config="$TOOLS_CFG" --quiet
        echo -e "${GREEN}✓ Tools base pushed to $TOOLS_BASE_IMAGE_NAME${NC}"

        OVERLAY_CFG=$(mktemp)
        cat > "$OVERLAY_CFG" <<EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-f', 'Dockerfile.custom', '-t', '$TOOLS_IMAGE_NAME_HASH', '.']
images: ['$TOOLS_IMAGE_NAME_HASH']
EOF
        gcloud builds submit "$DATA_DIR/docker" --config="$OVERLAY_CFG" --quiet
        rm -f "$OVERLAY_CFG"
        echo -e "${GREEN}✓ Tools overlay pushed to $TOOLS_IMAGE_NAME_HASH${NC}"
    else
        # No overlay: the generic tools image IS the tools image.
        cat > "$TOOLS_CFG" <<EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-f', 'Dockerfile.tools', '-t', '$TOOLS_IMAGE_NAME_HASH', '.']
images: ['$TOOLS_IMAGE_NAME_HASH']
EOF
        gcloud builds submit "$BUILD_DIR" --config="$TOOLS_CFG" --quiet
        echo -e "${GREEN}✓ Tools image pushed to $TOOLS_IMAGE_NAME_HASH${NC}"
    fi
    rm -f "$TOOLS_CFG"
fi

# --- Application image: a single build FROM the tools image ---
# Built with a BuildKit registry cache so an unchanged package-lock.json restores
# the two `npm ci` layers (builder full + runtime prod) from Artifact Registry
# instead of reinstalling — the ~140s that dominates a cold app build. The cache
# lives in a dedicated clack:buildcache tag: a build-time artifact ONLY, never
# deployed and never pulled by the VM. mode=max caches every stage (plain
# --cache-from would miss the builder stage); ignore-error=true makes a
# cache-export failure a warning, not a deploy failure, under `set -e`. The cache
# does NOT change clack:latest — the multi-stage boundary still discards the
# builder's devDeps, so the deployed image is byte-identical to an uncached build.
#
# --cache-to type=registry needs buildx's docker-container driver (the default
# `docker` driver can't export a registry cache), which also means the result is
# not loaded into the host Docker — so we --push directly and drop the config's
# `images:` field. Builder create + build MUST share one bash step: a separate
# Cloud Build `steps:` entry runs in a fresh container and loses the builder.
echo -e "${YELLOW}Building application image (registry-cached)...${NC}"
APP_CFG=$(mktemp)
cat > "$APP_CFG" <<EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      set -e
      docker buildx create --name clackx --driver docker-container --use 2>/dev/null || docker buildx use clackx
      docker buildx build \\
        --platform linux/amd64 \\
        --build-arg TOOLS_IMAGE=$TOOLS_IMAGE_NAME_HASH \\
        --build-arg BUILD_SHA=$BUILD_SHA \\
        --cache-from type=registry,ref=$BUILDCACHE_IMAGE_NAME \\
        --cache-to type=registry,ref=$BUILDCACHE_IMAGE_NAME,mode=max,ignore-error=true \\
        -t $IMAGE_NAME \\
        --push \\
        .
EOF
gcloud builds submit "$BUILD_DIR" --config="$APP_CFG" --quiet
rm -f "$APP_CFG"
echo -e "${GREEN}✓ Image pushed to $IMAGE_NAME${NC}"
echo ""

# Runtime status endpoint (published to the VM's loopback in the run command below),
# the drain gate's bound wait, and the pre-drain idle wait's cap. Override via env
# if needed.
STATUS_PORT="${STATUS_PORT:-8787}"
DRAIN_MAX_WAIT="${DRAIN_MAX_WAIT:-300}"
IDLE_MAX_WAIT="${IDLE_MAX_WAIT:-900}"

# ============================================
# Phase 1: Pre-pull new image (old container keeps running, no downtime)
# ============================================
echo -e "${YELLOW}Pre-pulling new image (bot still running)...${NC}"

gce_ssh --command="
    set -e

    # Make sure .env is readable by the SSH user (idempotent — the --provision
    # seed sets this initially; reapplied in case a manual edit reverted it).
    sudo chmod 644 $DATA_MOUNT_POINT/data/auth/.env

    # Reclaim any file not owned by the container user (1001) — a manual sudo
    # edit on the VM leaves root-owned files the app then EACCESes on.
    # repositories/ and worktrees/ are skipped: they're huge trees and only
    # ever written by the app itself.
    for entry in $DATA_MOUNT_POINT/data/* $DATA_MOUNT_POINT/data/.[!.]*; do
        [ -e \"\$entry\" ] || continue
        case \"\$entry\" in
            */repositories|*/worktrees) continue ;;
        esac
        sudo chown -R 1001:1001 \"\$entry\"
    done

    # Register Artifact Registry credential helper for THIS user (writes to SSH
    # user's \$HOME, which is writable; /root is read-only on COS so sudo would fail).
    docker-credential-gcr configure-docker --registries=${AR_REGION}-docker.pkg.dev

    # Prune dangling/unused images BEFORE pulling so the new image has room.
    # Without this, every deploy adds ~1.4 GB and the 10 GB boot disk fills up
    # after ~5-6 deploys, causing pull to fail with 'no space left on device'.
    docker image prune -f

    docker pull $IMAGE_NAME
"

echo -e "${GREEN}✓ New image pulled${NC}"
echo ""

# ============================================
# Phase 1.5: Wait for idle (old container keeps running, no downtime)
# ============================================
# The in-process drain quiesces the app — it refuses new runs — and stops any run
# still going when DRAIN_MAX_WAIT ends. Waiting here first, while the bot still
# accepts everything, lets in-flight runs finish normally so the drain below is
# near-instant. Past IDLE_MAX_WAIT, or when the wait can't run, the deploy falls
# through to the drain.
if [ "$NO_IDLE_WAIT" = true ]; then
    echo -e "${YELLOW}Skipping idle wait (--no-idle-wait)${NC}"
else
    echo -e "${YELLOW}Waiting for Clack to go idle (bot still running, up to ${IDLE_MAX_WAIT}s)...${NC}"
    IDLE_EXIT=0
    wait_for_idle "$IDLE_MAX_WAIT" || IDLE_EXIT=$?
    case $IDLE_EXIT in
        0) echo -e "${GREEN}✓ Clack is idle${NC}" ;;
        10) echo -e "${YELLOW}Idle wait hit its ${IDLE_MAX_WAIT}s cap — falling through to the drain${NC}" ;;
        *) echo -e "${YELLOW}Idle wait unavailable (exit ${IDLE_EXIT}) — falling through to the drain${NC}" ;;
    esac
fi
echo ""

# ============================================
# Phase 2: Swap container (downtime starts here)
# ============================================
echo -e "${YELLOW}Stopping old container and starting new one...${NC}"

TESTER_ENABLED=$(read_tester_enabled)
SIDECAR_RESERVE_MB=0
if [ "$TESTER_ENABLED" = "true" ]; then
    SERVICES_BUDGET_MB=$(read_tester_services_budget)
    SIDECAR_RESERVE_MB=$((SIDECAR_MEM_MB + PROXY_MEM_MB + SERVICES_BUDGET_MB))
fi

DOWNTIME_START=$(date +%s)
echo -e "${YELLOW}Draining old container in-process (docker stop -t ${DRAIN_MAX_WAIT}s)...${NC}"

gce_ssh --command="
    set -e
    TOTAL_MB=\$(free -m | grep Mem | tr -s ' ' | cut -d' ' -f2)
    CLACK_MEM_MB=\$((TOTAL_MB - $HOST_RESERVE_MB - $SIDECAR_RESERVE_MB))
    echo \"Memory cap: \${CLACK_MEM_MB}m of \${TOTAL_MB}m (host reserve ${HOST_RESERVE_MB}m, sidecar reserve ${SIDECAR_RESERVE_MB}m)\"
    docker stop -t ${DRAIN_MAX_WAIT} clack 2>/dev/null || true
    docker rm clack 2>/dev/null || true
    docker run -d \\
        --name clack \\
        --restart unless-stopped \\
        --memory \${CLACK_MEM_MB}m \\
        --memory-swap \${CLACK_MEM_MB}m \\
        --env-file $DATA_MOUNT_POINT/data/auth/.env \\
        -p 127.0.0.1:${STATUS_PORT}:${STATUS_PORT} \\
        -v $DATA_MOUNT_POINT/data:/app/data \\
        $IMAGE_NAME

    # The pre-pull prune runs while the OLD image is still tagged and in use, so
    # the replaced image survives as ~1.5 GB of dangling garbage until the NEXT
    # deploy. Prune again now that the swap has freed it — this keeps the small
    # boot disk at ~55% steady state instead of ~85%.
    docker image prune -f
"

# ============================================
# Phase 2.5: Tester sidecar (opt-in via config.tester.enabled)
# ============================================
# COS has no docker compose, so this mirrors docker-compose.tester.yml as a
# plain `docker run` and joins both containers to a shared `clack` docker
# network for container-name DNS (config.tester.sidecarUrl =
# http://clack-playwright:8931/mcp, config.tester.appHost = clack). The local
# config is the source of truth for whether the feature is on (TESTER_ENABLED
# is computed before the swap above, where it also sets the memory reserves);
# disabled or absent removes any stale sidecar so it doesn't hold RAM on the VM.
if [ "$TESTER_ENABLED" = "true" ]; then
    echo -e "${YELLOW}Tester enabled — ensuring Playwright sidecar...${NC}"
    PW_CONFIG="$BUILD_DIR/docker/clack-playwright/config.json"
    PW_HASH=$(shasum -a 256 "$PW_CONFIG" | cut -d' ' -f1)
    cat "$PW_CONFIG" \
        | gce_ssh --command="
            set -e
            sudo mkdir -p '$REMOTE_DATA_DIR/tester/recordings' '$DATA_MOUNT_POINT/clack-playwright'
            sudo chmod 777 '$REMOTE_DATA_DIR/tester/recordings'
            docker network create clack 2>/dev/null || true
            CFG='$DATA_MOUNT_POINT/clack-playwright/config.json'
            if [ \"\$(sudo sha256sum \"\$CFG\" 2>/dev/null | cut -d' ' -f1)\" = '$PW_HASH' ]; then
                cat >/dev/null; CHANGED=0
            else
                sudo tee \"\$CFG\" >/dev/null; CHANGED=1; echo 'Playwright config updated'
            fi
            IMG=mcr.microsoft.com/playwright/mcp:latest
            PULLED=0
            if [ '$REFRESH_SIDECARS' = true ] || ! docker image inspect \"\$IMG\" >/dev/null 2>&1; then
                docker pull \"\$IMG\"; PULLED=1
            fi
            if [ \"\$CHANGED\" = 1 ] || [ \"\$PULLED\" = 1 ] || ! docker ps --format '{{.Names}}' | grep -qx clack-playwright; then
                docker rm -f clack-playwright 2>/dev/null || true
                docker run -d \\
                    --name clack-playwright \\
                    --restart unless-stopped \\
                    --memory ${SIDECAR_MEM_MB}m \\
                    --memory-swap ${SIDECAR_MEM_MB}m \\
                    --network clack \\
                    -v '$REMOTE_DATA_DIR/tester/recordings:/recordings' \\
                    -v '$DATA_MOUNT_POINT/clack-playwright/config.json:/etc/clack-playwright/config.json:ro' \\
                    mcr.microsoft.com/playwright/mcp:latest \\
                    --headless --host 0.0.0.0 --port 8931 --allowed-hosts '*' \\
                    --config /etc/clack-playwright/config.json \\
                    --output-max-size 2000000000
                echo 'Playwright sidecar (re)created'
            else
                echo 'Playwright sidecar unchanged — left running'
            fi
            docker network connect clack clack 2>/dev/null || true
        "
    echo -e "${GREEN}✓ Playwright sidecar running (shared docker network: clack)${NC}"

    # Tester-services control plane: a docker-socket-proxy restricted to container +
    # image endpoints (no exec, no volumes, no host introspection). Never port-mapped
    # to the host — reachable only over the clack network at
    # config.tester.dockerProxyUrl (http://clack-docker-proxy:2375). Clack's service
    # lifecycle is the only consumer; Claude gets no docker-facing tool.
    echo -e "${YELLOW}Ensuring docker-socket-proxy (tester services control plane)...${NC}"
    gce_ssh --command="
        set -e
        PULLED=0
        if [ '$REFRESH_SIDECARS' = true ] || ! docker image inspect '$PROXY_IMAGE' >/dev/null 2>&1; then
            docker pull $PROXY_IMAGE; PULLED=1
        fi
        if [ \"\$PULLED\" = 1 ] || ! docker ps --format '{{.Names}}' | grep -qx $PROXY_CONTAINER_NAME; then
            docker rm -f $PROXY_CONTAINER_NAME 2>/dev/null || true
            docker run -d \\
                --name $PROXY_CONTAINER_NAME \\
                --restart unless-stopped \\
                --memory ${PROXY_MEM_MB}m \\
                --memory-swap ${PROXY_MEM_MB}m \\
                --network clack \\
                -e CONTAINERS=1 \\
                -e POST=1 \\
                -e IMAGES=1 \\
                -v /var/run/docker.sock:/var/run/docker.sock:ro \\
                $PROXY_IMAGE
            echo 'Docker proxy (re)created'
        else
            echo 'Docker proxy unchanged — left running'
        fi
    "
    echo -e "${GREEN}✓ Docker proxy running (reserve: playwright ${SIDECAR_MEM_MB}m + proxy ${PROXY_MEM_MB}m + services ${SERVICES_BUDGET_MB}m)${NC}"
else
    gce_ssh --command="
        for c in clack-playwright $PROXY_CONTAINER_NAME; do
            if docker ps -a --format '{{.Names}}' | grep -q \"^\$c\$\"; then
                docker rm -f \"\$c\"
                echo \"Tester disabled — removed stale \$c sidecar.\"
            fi
        done
    " || true
fi
echo ""

# ============================================
# Phase 3: Wait for 'Clack is ready' (downtime ends here)
# ============================================
echo -e "${YELLOW}Waiting for bot to reach 'Clack is ready' (up to 5 min)...${NC}"

WAIT_EXIT=0
gce_ssh --command='bash -s' <<'REMOTE' || WAIT_EXIT=$?
timeout 300 sh -c 'while true; do
    if docker logs clack 2>&1 | grep -q "Clack is ready"; then exit 0; fi
    if ! docker ps --filter name=clack --format "{{.Status}}" | grep -q Up; then exit 3; fi
    sleep 2
done'
REMOTE

DOWNTIME_END=$(date +%s)
DOWNTIME=$((DOWNTIME_END - DOWNTIME_START))
DOWNTIME_MIN=$((DOWNTIME / 60))
DOWNTIME_SEC=$((DOWNTIME % 60))

echo ""
case $WAIT_EXIT in
    0)
        echo -e "${GREEN}✓ Bot is ready — downtime ${DOWNTIME_MIN}m ${DOWNTIME_SEC}s${NC}"
        ;;
    3)
        echo -e "${RED}✗ Container exited or never started healthy. Logs:${NC}"
        echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --tunnel-through-iap --command='docker logs --tail 80 clack'"
        exit 1
        ;;
    124)
        echo -e "${RED}✗ Bot did not become ready within 5 min (downtime ${DOWNTIME_MIN}m ${DOWNTIME_SEC}s). Logs:${NC}"
        echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --tunnel-through-iap --command='docker logs -f clack'"
        exit 1
        ;;
    *)
        echo -e "${RED}✗ Readiness check failed (exit $WAIT_EXIT). Logs:${NC}"
        echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --tunnel-through-iap --command='docker logs --tail 80 clack'"
        exit 1
        ;;
esac
echo ""
echo -e "${YELLOW}Reminder:${NC} this deploy only rolls out the image. Config and other data files move through scripts/gce-push.sh (preview with --dry-run)."
echo ""
echo -e "${YELLOW}Tail logs:${NC}"
echo "gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --tunnel-through-iap --command='docker logs -f clack'"
