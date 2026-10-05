#!/bin/bash
# First-time infrastructure for the Clack GCE VM. Sourced by scripts/gce-deploy.sh --provision after gce-common.sh; defines provision_infra and seed_data_disk_if_empty.

provision_infra() {
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

# SSH firewall rule (auto-mode networks don't include one by default). It admits
# only GCE_SSH_SOURCE_RANGES — the IAP range every connection tunnels through.
if gcloud compute firewall-rules describe "$SSH_FIREWALL_RULE" &>/dev/null; then
    echo -e "${GREEN}✓ SSH firewall rule '$SSH_FIREWALL_RULE' already exists${NC}"
else
    if [ -z "$SSH_SOURCE_RANGES" ]; then
        echo -e "${RED}✗ GCE_SSH_SOURCE_RANGES is not set (see data/gce.env.example) — not creating an SSH rule open to everyone.${NC}"
        exit 1
    fi
    echo "Creating SSH firewall rule (source: $SSH_SOURCE_RANGES)..."
    gcloud compute firewall-rules create "$SSH_FIREWALL_RULE" \
        --network="$NETWORK_NAME" \
        --direction=INGRESS \
        --action=ALLOW \
        --rules=tcp:22 \
        --source-ranges="$SSH_SOURCE_RANGES" \
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

    # Grant the VM's default compute service account read access to Artifact
    # Registry so it can pull the image. AR is strictly IAM-gated (unlike GCR's
    # backing bucket), so a fresh VM cannot pull without this. Project-level grant.
    #
    # For a VM provisioned before this change, grant the role manually:
    #   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
    #   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    #       --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    #       --role=roles/artifactregistry.reader
    echo "Granting Artifact Registry read access to the VM service account..."
    PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
        --role=roles/artifactregistry.reader \
        --condition=None \
        --quiet >/dev/null
    echo -e "${GREEN}✓ Artifact Registry reader role granted${NC}"

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

# Containers race this mount at boot: their binds under the mountpoint resolve
# to empty paths pre-mount (the tester sidecar exits 127; clack can come up
# against an empty data dir). Restart them now that the disk is up.
for c in clack clack-playwright clack-docker-proxy; do
  if docker ps -a --format '{{.Names}}' | grep -q "^\$c\$"; then
    docker restart "\$c" || true
  fi
done
MOUNT_EOF

# Set as startup-script metadata so the mount survives reboots
gcloud compute instances add-metadata "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --metadata-from-file=startup-script="$MOUNT_SCRIPT" \
    --quiet

# Run it now (via SSH) so we don't have to wait for a reboot
gce_ssh --command="sudo bash -s" < "$MOUNT_SCRIPT"

rm -f "$MOUNT_SCRIPT"

echo -e "${GREEN}✓ Data disk mounted at $DATA_MOUNT_POINT${NC}"
echo ""
}

seed_data_disk_if_empty() {
    local disk_state
    disk_state=$(gce_ssh --command="sudo sh -c '[ -d \"$REMOTE_DATA_DIR\" ] && [ -n \"\$(ls -A \"$REMOTE_DATA_DIR\" 2>/dev/null)\" ] && echo used || echo empty'") || true

    if printf '%s' "$disk_state" | grep -q used; then
        echo -e "${YELLOW}Data disk already holds data — skipping the seed. Move files with scripts/gce-push.sh.${NC}"
        return 0
    fi

    disk_state=$(printf '%s' "$disk_state" | tr -d '[:space:]')
    if [ "$disk_state" != "empty" ]; then
        echo -e "${RED}✗ Could not tell whether the data disk is empty (probe output: '$disk_state') — not seeding.${NC}"
        return 1
    fi

    # Excludes (DATA_TAR_EXCLUDES from gce-common.sh): caches and locally-regeneratable
    # artifacts. Everything else (auth, config, sessions, state, configuration overrides,
    # default_configuration, repositories, worktrees) is synced.

    # Ensure the remote data dir exists and is writable, then stream the tree in.
    gce_ssh \
        --command="sudo mkdir -p '$REMOTE_DATA_DIR' && sudo chmod a+rwx '$REMOTE_DATA_DIR'"

    COPYFILE_DISABLE=1 tar -C "$PROJECT_DIR" -cf - "${DATA_TAR_EXCLUDES[@]}" data \
        | gce_ssh \
            --command="sudo tar -C '$DATA_MOUNT_POINT' -xf - --strip-components=0"

    # The container runs as the 'clack' user (UID 1001 per Dockerfile). Make the
    # entire data tree owned by that UID/GID so the bot can read + write everything.
    # Then loosen .env to mode 644 so the SSH user (not in the clack group) can read
    # it when invoking `docker run --env-file`. The file stays owned by UID 1001 so
    # the in-container clack user can also read it.
    gce_ssh \
        --command="sudo chown -R 1001:1001 '$REMOTE_DATA_DIR' && sudo chmod 644 '$REMOTE_DATA_DIR/auth/.env'"

    echo -e "${GREEN}✓ Empty data disk seeded from ./data/${NC}"
}
