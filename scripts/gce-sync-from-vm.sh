#!/bin/bash
# Pull the VM's data/ tree down to the local ./data/ directory.
#
# Use this when the deployed bot has accumulated state (sessions, roles, etc.)
# and you want to resume testing locally from that state. This OVERWRITES local
# files. The local clack container is stopped first if running.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Sync VM data → local ./data${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""

require_project
require_instance

# ============================================
# Confirm the destructive overwrite
# ============================================
echo -e "${YELLOW}⚠ This will overwrite your local ./data/ with the VM's copy.${NC}"
echo -e "${YELLOW}  data/sessions/, data/state/, data/repositories/, data/configuration/, etc.${NC}"
echo -e "${YELLOW}  will be replaced. Caches (.npm, .claude, cache, mcp_packages, error-reports)${NC}"
echo -e "${YELLOW}  are not touched.${NC}"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# ============================================
# Stop local container if running
# ============================================
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^clack$'; then
    echo -e "${YELLOW}Stopping local clack to avoid file-overwrite conflicts...${NC}"
    docker stop clack >/dev/null
    echo -e "${GREEN}✓ Local clack stopped${NC}"
fi

# ============================================
# Stream VM data → local
# ============================================
echo -e "${YELLOW}Streaming $REMOTE_DATA_DIR → ./data/ ...${NC}"

# Build a space-delimited exclude string for the remote tar invocation. Patterns
# have no spaces so word-splitting is safe.
REMOTE_EXCLUDES=""
for ex in "${DATA_TAR_EXCLUDES[@]}"; do
    REMOTE_EXCLUDES+=" $ex"
done

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="sudo tar -C '$DATA_MOUNT_POINT' -cf - $REMOTE_EXCLUDES data" \
    | tar -C "$PROJECT_DIR" -xf -

echo -e "${GREEN}✓ VM data synced to ./data/${NC}"
echo ""
echo -e "${YELLOW}Note: extracted files are owned by your local user (BSD/GNU tar default${NC}"
echo -e "${YELLOW}for non-root extraction), not the VM's UID 1001.${NC}"
