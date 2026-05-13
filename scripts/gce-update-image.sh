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
echo -e "${YELLOW}Building and pushing Docker image...${NC}"

gcloud services enable containerregistry.googleapis.com --quiet 2>/dev/null || true

cd "$PROJECT_DIR"
gcloud builds submit --tag "$IMAGE_NAME" --quiet

echo -e "${GREEN}✓ Image pushed to $IMAGE_NAME${NC}"
echo ""

# ============================================
# Phase 1: Pre-pull new image (old container keeps running, no downtime)
# ============================================
echo -e "${YELLOW}Pre-pulling new image (bot still running)...${NC}"

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
    set -e

    # Make sure .env is readable by the SSH user (idempotent — gce-deploy.sh
    # sets this initially, but reapply in case a sync run reverted it).
    sudo chmod 644 $DATA_MOUNT_POINT/data/auth/.env

    # Register GCR credential helper for THIS user (writes to SSH user's \$HOME,
    # which is writable; /root is read-only on COS so sudo would fail).
    docker-credential-gcr configure-docker --registries=gcr.io

    docker pull $IMAGE_NAME
"

echo -e "${GREEN}✓ New image pulled${NC}"
echo ""

# ============================================
# Phase 2: Swap container (downtime starts here)
# ============================================
echo -e "${YELLOW}Stopping old container and starting new one...${NC}"

DOWNTIME_START=$(date +%s)

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
    set -e
    docker stop clack 2>/dev/null || true
    docker rm clack 2>/dev/null || true
    docker run -d \\
        --name clack \\
        --restart unless-stopped \\
        --env-file $DATA_MOUNT_POINT/data/auth/.env \\
        -v $DATA_MOUNT_POINT/data:/app/data \\
        $IMAGE_NAME
"

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
echo -e "${YELLOW}Tail logs:${NC}"
echo "gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker logs -f clack'"
