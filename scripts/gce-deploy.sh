#!/bin/bash
# First-time bootstrap: build + push image, provision VPC/firewall/disk/VM,
# format + mount the data disk, sync local ./data/ up, and start the container.
# Idempotent — safe to re-run; it skips anything that already exists.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Clack GCE Deployment${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""
echo "Project: $PROJECT_ID"
echo "Instance: $INSTANCE_NAME"
echo "Zone: $ZONE"
echo ""

# ============================================
# Pre-flight checks
# ============================================
echo -e "${YELLOW}Checking prerequisites...${NC}"

require_project

if [ ! -f "$DATA_DIR/config.json" ]; then
    echo -e "${RED}✗ config.json not found. Run 'npm run docker-setup' first.${NC}"
    exit 1
fi

if [ ! -f "$AUTH_DIR/slack.json" ]; then
    echo -e "${RED}✗ slack.json not found. Run 'npm run docker-setup' first.${NC}"
    exit 1
fi

if [ ! -f "$AUTH_DIR/.env" ]; then
    echo -e "${RED}✗ .env not found. Run 'npm run docker-setup' first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# ============================================
# Build and push Docker image
# ============================================
echo -e "${YELLOW}Building and pushing Docker image...${NC}"

# Enable Container Registry API if needed
gcloud services enable containerregistry.googleapis.com --quiet 2>/dev/null || true

# Build and push using Cloud Build
cd "$PROJECT_DIR"
gcloud builds submit --tag "$IMAGE_NAME" --quiet

echo -e "${GREEN}✓ Image pushed to $IMAGE_NAME${NC}"
echo ""

# ============================================
# Provision dedicated VPC network for Clack
# ============================================
echo -e "${YELLOW}Setting up dedicated VPC network...${NC}"

if gcloud compute networks describe "$NETWORK_NAME" &>/dev/null; then
    echo -e "${GREEN}✓ Network '$NETWORK_NAME' already exists${NC}"
else
    echo "Creating auto-mode VPC '$NETWORK_NAME' (isolates Clack from other VPCs)..."
    gcloud compute networks create "$NETWORK_NAME" \
        --subnet-mode=auto \
        --bgp-routing-mode=regional \
        --quiet
    echo -e "${GREEN}✓ Network created${NC}"
fi

# SSH firewall rule (auto-mode networks don't include one by default)
if gcloud compute firewall-rules describe "$SSH_FIREWALL_RULE" &>/dev/null; then
    echo -e "${GREEN}✓ SSH firewall rule '$SSH_FIREWALL_RULE' already exists${NC}"
else
    echo "Creating SSH firewall rule..."
    gcloud compute firewall-rules create "$SSH_FIREWALL_RULE" \
        --network="$NETWORK_NAME" \
        --direction=INGRESS \
        --action=ALLOW \
        --rules=tcp:22 \
        --source-ranges=0.0.0.0/0 \
        --target-tags=clack \
        --quiet
    echo -e "${GREEN}✓ SSH firewall rule created${NC}"
fi

echo ""

# ============================================
# Provision persistent data disk
# ============================================
echo -e "${YELLOW}Setting up persistent data disk...${NC}"

if gcloud compute disks describe "$DATA_DISK_NAME" --zone="$ZONE" &>/dev/null; then
    echo -e "${GREEN}✓ Data disk '$DATA_DISK_NAME' already exists${NC}"
else
    echo "Creating data disk '$DATA_DISK_NAME' ($DATA_DISK_SIZE $DATA_DISK_TYPE)..."
    gcloud compute disks create "$DATA_DISK_NAME" \
        --zone="$ZONE" \
        --size="$DATA_DISK_SIZE" \
        --type="$DATA_DISK_TYPE" \
        --quiet
    echo -e "${GREEN}✓ Data disk created${NC}"
fi

echo ""

# ============================================
# Create VM if it doesn't exist
# ============================================
echo -e "${YELLOW}Setting up Compute Engine instance...${NC}"

if gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" &>/dev/null; then
    echo -e "${YELLOW}Instance '$INSTANCE_NAME' already exists${NC}"
    if [ -t 0 ]; then
        read -p "Do you want to update it? (y/n) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted."
            exit 0
        fi
    else
        echo "Non-interactive shell — proceeding with update."
    fi
    INSTANCE_EXISTS=true

    # Ensure the data disk is attached (idempotent)
    if gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" \
        --format='value(disks[].source)' | grep -q "/disks/$DATA_DISK_NAME$"; then
        echo -e "${GREEN}✓ Data disk already attached${NC}"
    else
        echo "Attaching data disk to existing instance..."
        gcloud compute instances attach-disk "$INSTANCE_NAME" \
            --zone="$ZONE" \
            --disk="$DATA_DISK_NAME" \
            --device-name="$DATA_DISK_DEVICE_NAME" \
            --mode=rw \
            --quiet
        echo -e "${GREEN}✓ Data disk attached${NC}"
    fi
else
    echo "Creating new instance '$INSTANCE_NAME'..."

    gcloud compute instances create "$INSTANCE_NAME" \
        --zone="$ZONE" \
        --machine-type="$MACHINE_TYPE" \
        --image-family=cos-stable \
        --image-project=cos-cloud \
        --boot-disk-size=10GB \
        --disk="name=$DATA_DISK_NAME,device-name=$DATA_DISK_DEVICE_NAME,mode=rw,boot=no" \
        --network="$NETWORK_NAME" \
        --subnet="$NETWORK_NAME" \
        --tags=clack \
        --scopes=cloud-platform \
        --quiet

    echo -e "${GREEN}✓ Instance created${NC}"
    INSTANCE_EXISTS=false

    # Wait for instance to be ready
    echo "Waiting for instance to be ready..."
    sleep 30
fi

echo ""

# ============================================
# Install + run the data-disk mount script
# ============================================
echo -e "${YELLOW}Configuring data disk mount...${NC}"

MOUNT_SCRIPT=$(mktemp)
cat > "$MOUNT_SCRIPT" <<MOUNT_EOF
#!/bin/bash
set -e
DISK_DEV="/dev/disk/by-id/google-${DATA_DISK_DEVICE_NAME}"
MOUNT_POINT="${DATA_MOUNT_POINT}"

# Wait up to 30s for the disk device to appear (it can lag attach by a few seconds on first boot)
for i in {1..30}; do
  if [ -e "\$DISK_DEV" ]; then break; fi
  sleep 1
done

if [ ! -e "\$DISK_DEV" ]; then
  echo "Data disk not present at \$DISK_DEV" >&2
  exit 1
fi

# Format only if the disk has no filesystem yet (preserves data on subsequent runs)
if ! blkid "\$DISK_DEV" >/dev/null 2>&1; then
  echo "Formatting \$DISK_DEV with ext4..."
  mkfs.ext4 -F "\$DISK_DEV"
fi

mkdir -p "\$MOUNT_POINT"

if ! mountpoint -q "\$MOUNT_POINT"; then
  mount -o discard,defaults "\$DISK_DEV" "\$MOUNT_POINT"
fi

# Allow non-root container processes to write into the mount
chmod a+rwx "\$MOUNT_POINT"
MOUNT_EOF

# Set as startup-script metadata so the mount survives reboots
gcloud compute instances add-metadata "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --metadata-from-file=startup-script="$MOUNT_SCRIPT" \
    --quiet

# Run it now (via SSH) so we don't have to wait for a reboot
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="sudo bash -s" < "$MOUNT_SCRIPT"

rm -f "$MOUNT_SCRIPT"

echo -e "${GREEN}✓ Data disk mounted at $DATA_MOUNT_POINT${NC}"
echo ""

# ============================================
# Sync ./data/ to the persistent disk
# ============================================
echo -e "${YELLOW}Syncing ./data/ to the persistent disk...${NC}"

# Warn if a local clack container is running — mid-write sessions/state files
# can land in an inconsistent state on the remote side. When stdin is not a
# terminal (e.g. background run), skip the prompt and continue.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^clack$'; then
    echo -e "${YELLOW}⚠ A local 'clack' container is running.${NC}"
    echo -e "${YELLOW}  It may be writing to data/sessions/ or data/state/ during this rsync.${NC}"
    if [ -t 0 ]; then
        read -p "  Stop it now to ensure a consistent snapshot? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker stop clack >/dev/null
            echo -e "${GREEN}  ✓ Local clack stopped${NC}"
        else
            echo -e "${YELLOW}  Continuing — some session/state files may sync mid-write.${NC}"
        fi
    else
        echo -e "${YELLOW}  Non-interactive shell — continuing without stopping. Stop it manually if state consistency matters.${NC}"
    fi
fi

# Excludes (DATA_TAR_EXCLUDES from gce-common.sh): caches and locally-regeneratable
# artifacts. Everything else (auth, config, sessions, state, configuration overrides,
# default_configuration, repositories, worktrees) is synced.

# Ensure the remote data dir exists and is writable, then stream the tree in.
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="sudo mkdir -p '$REMOTE_DATA_DIR' && sudo chmod a+rwx '$REMOTE_DATA_DIR'"

tar -C "$PROJECT_DIR" -cf - "${DATA_TAR_EXCLUDES[@]}" data \
    | gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
        --command="sudo tar -C '$DATA_MOUNT_POINT' -xf - --strip-components=0"

# The container runs as the 'clack' user (UID 1001 per Dockerfile). Make the
# entire data tree owned by that UID/GID so the bot can read + write everything.
# Then loosen .env to mode 644 so the SSH user (not in the clack group) can read
# it when invoking `docker run --env-file`. The file stays owned by UID 1001 so
# the in-container clack user can also read it.
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="sudo chown -R 1001:1001 '$REMOTE_DATA_DIR' && sudo chmod 644 '$REMOTE_DATA_DIR/auth/.env'"

echo -e "${GREEN}✓ ./data/ synced to $REMOTE_DATA_DIR${NC}"
echo ""

# ============================================
# Deploy container on instance
# ============================================
echo -e "${YELLOW}Deploying container...${NC}"

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
    set -e

    # Register the GCR credential helper for THIS user. Running without sudo
    # so the config writes to the SSH user's writable \$HOME/.docker/config.json
    # (sudo would target /root/.docker, which is read-only on COS).
    docker-credential-gcr configure-docker --registries=gcr.io

    # Pull latest image (using the credential helper just configured)
    docker pull $IMAGE_NAME

    # Stop and remove existing container if running
    docker stop clack 2>/dev/null || true
    docker rm clack 2>/dev/null || true

    # Run container with the full ./data tree bind-mounted writable from the persistent disk.
    # --env-file loads CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY / etc. from the synced .env,
    # skipping comment lines (matches the local docker-setup.sh run command).
    # .env is mode 644 (set above) so the SSH user can read it for --env-file parsing,
    # while still owned by UID 1001 for the in-container clack user.
    docker run -d \\
        --name clack \\
        --restart unless-stopped \\
        --env-file $DATA_MOUNT_POINT/data/auth/.env \\
        -v $DATA_MOUNT_POINT/data:/app/data \\
        $IMAGE_NAME

    echo ''
    echo 'Container status:'
    docker ps --filter name=clack
"

echo ""
echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Deployment Complete!${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""
echo -e "${GREEN}Clack is now running on GCE.${NC}"
echo ""
echo "Useful commands:"
echo ""
echo -e "${YELLOW}# View logs${NC}"
echo "gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker logs -f clack'"
echo ""
echo -e "${YELLOW}# Restart container${NC}"
echo "gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker restart clack'"
echo ""
echo -e "${YELLOW}# SSH into instance${NC}"
echo "gcloud compute ssh $INSTANCE_NAME --zone=$ZONE"
echo ""
echo -e "${YELLOW}# Stop instance (to save costs)${NC}"
echo "gcloud compute instances stop $INSTANCE_NAME --zone=$ZONE"
echo ""
echo -e "${YELLOW}# Start instance${NC}"
echo "gcloud compute instances start $INSTANCE_NAME --zone=$ZONE"
echo ""
echo -e "${YELLOW}# Delete instance${NC}"
echo "gcloud compute instances delete $INSTANCE_NAME --zone=$ZONE"
echo ""
