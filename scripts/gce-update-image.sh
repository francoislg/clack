#!/bin/bash
# Build a new image from local source, push to GCR, and restart the container
# on the existing GCE VM. Does NOT touch the persistent data disk.
#
# Use this when you've made code changes and want to deploy a new image without
# overwriting the bot's runtime state on the VM.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Clack Image Update${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""
echo "Project: $PROJECT_ID"
echo "Instance: $INSTANCE_NAME"
echo ""

require_project
require_instance

# ============================================
# Build and push image
# ============================================
gcloud services enable artifactregistry.googleapis.com --quiet 2>/dev/null || true
require_ar_repo

cd "$PROJECT_DIR"

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
trap 'rm -f "${TOOLS_CFG:-}" "${OVERLAY_CFG:-}" "${APP_CFG:-}"' EXIT

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
        gcloud builds submit "$PROJECT_DIR" --config="$TOOLS_CFG" --quiet
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
        gcloud builds submit "$PROJECT_DIR" --config="$TOOLS_CFG" --quiet
        echo -e "${GREEN}✓ Tools image pushed to $TOOLS_IMAGE_NAME_HASH${NC}"
    fi
    rm -f "$TOOLS_CFG"
fi

# --- Application image: a single build FROM the tools image ---
echo -e "${YELLOW}Building application image...${NC}"
APP_CFG=$(mktemp)
cat > "$APP_CFG" <<EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-t', '$IMAGE_NAME', '--build-arg', 'TOOLS_IMAGE=$TOOLS_IMAGE_NAME_HASH', '.']
images: ['$IMAGE_NAME']
EOF
gcloud builds submit "$PROJECT_DIR" --config="$APP_CFG" --quiet
rm -f "$APP_CFG"
echo -e "${GREEN}✓ Image pushed to $IMAGE_NAME${NC}"
echo ""

# Runtime status endpoint (published to the VM's loopback in the run command below)
# and the drain gate's bound wait. Override via env if needed.
STATUS_PORT="${STATUS_PORT:-8787}"
DRAIN_MAX_WAIT="${DRAIN_MAX_WAIT:-300}"

# ============================================
# Phase 1: Pre-pull new image (old container keeps running, no downtime)
# ============================================
echo -e "${YELLOW}Pre-pulling new image (bot still running)...${NC}"

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
    set -e

    # Make sure .env is readable by the SSH user (idempotent — gce-deploy.sh
    # sets this initially, but reapply in case a sync run reverted it).
    sudo chmod 644 $DATA_MOUNT_POINT/data/auth/.env

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
# Phase 1.2: Sync worker settings (optional operator guardrails)
# ============================================
# data/worker-settings.json (gitignored) is an operator-provided native Claude
# Code settings file injected into worker-mode Claude — see
# docs/worker-settings.md. It is operator-owned and never edited VM-side, so
# the local copy is the source of truth and travels with every deploy. When
# absent locally, the VM copy (if any) is deliberately left untouched so a
# deploy from a fresh checkout doesn't silently disable guardrails.
if [ -f "$DATA_DIR/worker-settings.json" ]; then
    echo -e "${YELLOW}Pushing worker settings...${NC}"
    tar -C "$DATA_DIR" -cf - worker-settings.json \
        | gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
            set -e
            sudo tar -C '$REMOTE_DATA_DIR' -xf -
            sudo chown 1001:1001 '$REMOTE_DATA_DIR/worker-settings.json'
        "
    echo -e "${GREEN}✓ Worker settings pushed${NC}"
else
    echo "No local data/worker-settings.json — VM copy (if any) left untouched."
fi
echo ""

# ============================================
# Phase 1.5: Drain — wait for the running bot to go idle before the swap
# ============================================
# Bounded wait (then proceed) so the hard `docker stop` lands on an idle bot
# instead of killing an in-flight Claude run. Probes the running container's
# status endpoint via `docker exec ... node` — guaranteed present in the image,
# so no dependency on curl/jq being on the COS host. Unreachable endpoint (e.g.
# an older image without /status) => skip and proceed.
echo -e "${YELLOW}Draining: waiting for active runs to finish (up to ${DRAIN_MAX_WAIT}s)...${NC}"

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="bash -s ${STATUS_PORT} ${DRAIN_MAX_WAIT}" <<'REMOTE' || true
PORT="$1"
MAX="$2"
deadline=$(( $(date +%s) + MAX ))
probe() {
    docker exec -e SP="$PORT" clack node -e 'fetch("http://127.0.0.1:"+process.env.SP+"/status").then(r=>r.json()).then(j=>process.stdout.write(j.busy+" "+j.activeRuns.count+" "+j.workers.active)).catch(()=>process.exit(2))' 2>/dev/null
}
while :; do
    out=$(probe) || { echo "Drain check skipped (status endpoint unreachable)."; exit 0; }
    set -- $out
    busy="$1"; runs="$2"; workers="$3"
    if [ "$busy" != "true" ] && [ "$busy" != "false" ]; then
        echo "Drain check skipped (status endpoint returned unexpected output)."; exit 0
    fi
    if [ "$busy" = "false" ]; then echo "Bot idle — proceeding."; exit 0; fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "Drain timeout — still busy ($runs runs, $workers workers). Proceeding with swap."
        exit 0
    fi
    echo "Draining: ($runs runs, $workers workers) waiting..."
    sleep 5
done
REMOTE

echo ""

# ============================================
# Phase 2: Swap container (downtime starts here)
# ============================================
echo -e "${YELLOW}Stopping old container and starting new one...${NC}"

TESTER_ENABLED=$(read_tester_enabled)
SIDECAR_RESERVE_MB=0
if [ "$TESTER_ENABLED" = "true" ]; then
    SIDECAR_RESERVE_MB=$SIDECAR_MEM_MB
fi

DOWNTIME_START=$(date +%s)

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
    set -e
    TOTAL_MB=\$(free -m | grep Mem | tr -s ' ' | cut -d' ' -f2)
    CLACK_MEM_MB=\$((TOTAL_MB - $HOST_RESERVE_MB - $SIDECAR_RESERVE_MB))
    echo \"Memory cap: \${CLACK_MEM_MB}m of \${TOTAL_MB}m (host reserve ${HOST_RESERVE_MB}m, sidecar reserve ${SIDECAR_RESERVE_MB}m)\"
    docker stop clack 2>/dev/null || true
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
    tar -C "$PROJECT_DIR/docker/clack-playwright" -cf - config.json \
        | gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
            set -e
            sudo mkdir -p '$REMOTE_DATA_DIR/tester/recordings' '$DATA_MOUNT_POINT/clack-playwright'
            sudo chmod 777 '$REMOTE_DATA_DIR/tester/recordings'
            sudo tar -C '$DATA_MOUNT_POINT/clack-playwright' -xf -
            docker network create clack 2>/dev/null || true
            docker pull mcr.microsoft.com/playwright/mcp:latest
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
            docker network connect clack clack 2>/dev/null || true
        "
    echo -e "${GREEN}✓ Playwright sidecar running (shared docker network: clack)${NC}"
else
    gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
        if docker ps -a --format '{{.Names}}' | grep -q '^clack-playwright\$'; then
            docker rm -f clack-playwright
            echo 'Tester disabled — removed stale clack-playwright sidecar.'
        fi
    " || true
fi
echo ""

# ============================================
# Phase 3: Wait for 'Clack is ready' (downtime ends here)
# ============================================
echo -e "${YELLOW}Waiting for bot to reach 'Clack is ready' (up to 5 min)...${NC}"

WAIT_EXIT=0
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command='bash -s' <<'REMOTE' || WAIT_EXIT=$?
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
        echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker logs --tail 80 clack'"
        exit 1
        ;;
    124)
        echo -e "${RED}✗ Bot did not become ready within 5 min (downtime ${DOWNTIME_MIN}m ${DOWNTIME_SEC}s). Logs:${NC}"
        echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker logs -f clack'"
        exit 1
        ;;
    *)
        echo -e "${RED}✗ Readiness check failed (exit $WAIT_EXIT). Logs:${NC}"
        echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker logs --tail 80 clack'"
        exit 1
        ;;
esac
echo ""
echo -e "${YELLOW}Reminder:${NC} this script only rolls out the docker image. If you've"
echo "edited any project-class config locally (config.json, mcp.json,"
echo "default_configuration/, etc.) since the last push, also run:"
echo "  bash scripts/gce-push-config.sh"
echo ""
echo -e "${YELLOW}Tail logs:${NC}"
echo "gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker logs -f clack'"
