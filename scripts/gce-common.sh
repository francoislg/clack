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
MACHINE_TYPE="e2-small"
IMAGE_NAME="gcr.io/${PROJECT_ID}/clack:latest"

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
