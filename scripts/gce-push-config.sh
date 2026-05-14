#!/bin/bash
# Push "project-class" files from local ./data/ → VM's persistent data disk.
#
# Reads data/.deploy-include (gitignored, per-instance) — one path per line,
# # for comments. Each listed path is tar-piped to the VM and overwrites the
# remote copy. Everything else on the persistent disk (sessions, state,
# repositories, stateful plugins, etc.) is left alone.
#
# First-time setup:
#   cp data/.deploy-include.example data/.deploy-include
#   $EDITOR data/.deploy-include   # add per-instance project paths
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

MANIFEST="$DATA_DIR/.deploy-include"

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Push project config to VM${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""

require_project
require_instance

if [ ! -f "$MANIFEST" ]; then
    echo -e "${RED}✗ Manifest not found at $MANIFEST${NC}"
    echo "  Create it from the template:"
    echo "    cp data/.deploy-include.example data/.deploy-include"
    exit 1
fi

# Read manifest into an array, skipping blank lines and comments.
PATHS=()
while IFS= read -r line; do
    # Strip leading/trailing whitespace and skip blank / comment lines.
    trimmed=$(echo "$line" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
    [ -z "$trimmed" ] && continue
    [[ "$trimmed" == \#* ]] && continue
    PATHS+=("$trimmed")
done < "$MANIFEST"

if [ "${#PATHS[@]}" -eq 0 ]; then
    echo -e "${RED}✗ Manifest is empty (no paths to push)${NC}"
    exit 1
fi

# Show plan + validate locally.
echo "Paths to push:"
MISSING=false
for p in "${PATHS[@]}"; do
    if [ ! -e "$PROJECT_DIR/$p" ]; then
        echo -e "${RED}  ✗ $p (does not exist locally)${NC}"
        MISSING=true
    else
        echo "  • $p"
    fi
done
echo ""

if [ "$MISSING" = "true" ]; then
    echo -e "${RED}Fix the missing paths in $MANIFEST and retry.${NC}"
    exit 1
fi

# Tar's --files-from reads the list of paths to include. Write to a tempfile
# so we don't depend on process substitution.
TMPLIST=$(mktemp)
printf '%s\n' "${PATHS[@]}" > "$TMPLIST"

echo -e "${YELLOW}Streaming paths to $REMOTE_DATA_DIR ...${NC}"

# Make sure the remote data dir exists and is writable (it will already, on
# any VM that's been through gce-deploy.sh, but be defensive).
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="sudo mkdir -p '$REMOTE_DATA_DIR' && sudo chmod a+rwx '$REMOTE_DATA_DIR'"

tar -C "$PROJECT_DIR" -cf - --files-from="$TMPLIST" \
    | gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
        --command="sudo tar -C '$DATA_MOUNT_POINT' -xf -"

rm -f "$TMPLIST"

# Reapply ownership for the in-container clack user (UID 1001).
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="sudo chown -R 1001:1001 '$REMOTE_DATA_DIR'"

echo -e "${GREEN}✓ Config pushed${NC}"
echo ""
echo -e "${YELLOW}Note:${NC} config.json and mcp.json hot-reload via the bot's file watcher."
echo "default_configuration changes take effect on the next session start."
echo "If you need them applied immediately, restart the container:"
echo "  bash scripts/gce-update-image.sh    # rebuilds + restarts"
echo "  # or just:"
echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker restart clack'"
