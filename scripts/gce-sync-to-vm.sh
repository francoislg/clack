#!/bin/bash
# Push local ./data/ up to the VM's persistent data disk.
#
# Use this when you've been running locally and want the deployed bot to pick up
# your local state (sessions, configuration overrides, repository clones, etc.).
# This OVERWRITES files on the VM. If the bot is running there, it may clobber
# state the bot has just written. The script will offer to stop it first.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Sync local ./data → VM${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""

require_project
require_instance

if [ ! -d "$DATA_DIR" ]; then
    echo -e "${RED}✗ Local $DATA_DIR not found.${NC}"
    exit 1
fi

# ============================================
# Pre-flight: warn about live writers on either side
# ============================================
REMOTE_WAS_RUNNING=false
echo -e "${YELLOW}Checking for running clack containers...${NC}"

REMOTE_RUNNING=$(gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^clack$' && echo yes || echo no" \
    2>/dev/null || echo "no")

if [ "$REMOTE_RUNNING" = "yes" ]; then
    echo -e "${YELLOW}⚠ The 'clack' container is running on the VM.${NC}"
    echo -e "${YELLOW}  This sync will overwrite anything it writes to data/sessions/, data/state/, etc.${NC}"
    read -p "  Stop it before syncing (and restart it after)? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="docker stop clack" >/dev/null
        echo -e "${GREEN}  ✓ Remote clack stopped${NC}"
        REMOTE_WAS_RUNNING=true
    else
        echo -e "${YELLOW}  Continuing — clobbering live remote state.${NC}"
    fi
fi

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^clack$'; then
    echo -e "${YELLOW}⚠ A local 'clack' container is running and may write mid-sync.${NC}"
    read -p "  Stop it for a clean snapshot? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker stop clack >/dev/null
        echo -e "${GREEN}  ✓ Local clack stopped${NC}"
    fi
fi

echo ""

# ============================================
# Sync ./data/ → VM
# ============================================
echo -e "${YELLOW}Syncing ./data/ → $REMOTE_DATA_DIR ...${NC}"

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="sudo mkdir -p '$REMOTE_DATA_DIR' && sudo chmod a+rwx '$REMOTE_DATA_DIR'"

tar -C "$PROJECT_DIR" -cf - "${DATA_TAR_EXCLUDES[@]}" data \
    | gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
        --command="sudo tar -C '$DATA_MOUNT_POINT' -xf -"

# Restore in-container ownership (clack user is UID 1001 per Dockerfile)
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="sudo chown -R 1001:1001 '$REMOTE_DATA_DIR'"

echo -e "${GREEN}✓ ./data/ synced${NC}"
echo ""

# ============================================
# Restart the remote container if we stopped it
# ============================================
if [ "$REMOTE_WAS_RUNNING" = "true" ]; then
    echo -e "${YELLOW}Restarting remote container...${NC}"
    gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="docker start clack" >/dev/null
    echo -e "${GREEN}✓ Remote clack restarted${NC}"
fi
