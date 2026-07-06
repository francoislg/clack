#!/bin/bash
# Push "project-class" files from local ./data/ → VM's persistent data disk.
#
# Reads data/.deploy-include (gitignored, per-instance) — one path per line,
# # for comments. Each listed path is tar-piped to the VM and overwrites the
# remote copy. Everything else on the persistent disk (sessions, state,
# repositories, stateful plugins, etc.) is left alone.
#
# Before pushing, the script checks each manifest path against the VM and
# aborts if the VM has divergent edits (e.g. config.json edits made through
# the bot's Home Tab). Pass --force to overwrite anyway.
#
# First-time setup:
#   cp data/.deploy-include.example data/.deploy-include
#   $EDITOR data/.deploy-include   # add per-instance project paths
set -e

FORCE=false
for arg in "$@"; do
    case "$arg" in
        -f|--force) FORCE=true ;;
        -h|--help)
            echo "Usage: $0 [--force]"
            echo "  --force, -f   skip the VM-divergence safety check"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 1
            ;;
    esac
done

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

# ============================================
# Pre-push: detect VM-side divergence
# ============================================
# Files in the manifest can be edited from the VM too (e.g. config.json gets
# updated when admins use the Home Tab). Pushing local blindly would clobber
# those edits — happened more than once. Fetch all manifest paths from the
# VM into a temp dir, diff each, and refuse to push if anything diverges
# (unless --force was passed).
if [ "$FORCE" != "true" ]; then
    TMP_REMOTE=$(mktemp -d)
    # shellcheck disable=SC2064
    trap "rm -rf '$TMP_REMOTE'" EXIT

    REMOTE_FETCH_ARGS=""
    for p in "${PATHS[@]}"; do
        REMOTE_FETCH_ARGS+=" '$p'"
    done

    echo -e "${YELLOW}Checking VM for divergent edits...${NC}"
    gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
        --command="sudo tar -C '$DATA_MOUNT_POINT' -cf -$REMOTE_FETCH_ARGS" 2>/dev/null \
        | tar -C "$TMP_REMOTE" -xf -

    CONFLICTING=()
    for p in "${PATHS[@]}"; do
        LOCAL="$PROJECT_DIR/$p"
        REMOTE="$TMP_REMOTE/$p"
        # Path may not yet exist on the VM (e.g. brand-new plugin) — that's fine.
        [ ! -e "$REMOTE" ] && continue
        if ! diff -ruq "$LOCAL" "$REMOTE" >/dev/null 2>&1; then
            CONFLICTING+=("$p")
        fi
    done

    if [ "${#CONFLICTING[@]}" -gt 0 ]; then
        echo ""
        echo -e "${RED}⚠ VM has changes that differ from local for:${NC}"
        for p in "${CONFLICTING[@]}"; do
            echo "  • $p"
        done
        echo ""
        echo -e "${YELLOW}Diff (- local, + VM) — first 40 lines per path:${NC}"
        for p in "${CONFLICTING[@]}"; do
            echo "--- $p ---"
            diff -ruN "$PROJECT_DIR/$p" "$TMP_REMOTE/$p" | head -40
            echo ""
        done

        if [ -t 0 ]; then
            read -p "Overwrite VM with local? (y/n) " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo -e "${YELLOW}Aborted. To reconcile:${NC}"
                echo "  1. Pull the VM's version of conflicting paths into local"
                echo "  2. Merge with your local edits"
                echo "  3. Re-run scripts/gce-push-config.sh"
                exit 1
            fi
        else
            echo -e "${RED}Non-interactive shell: aborting to avoid clobbering VM edits.${NC}"
            echo "Re-run with --force to overwrite anyway."
            exit 1
        fi
    else
        echo -e "${GREEN}✓ No VM-side divergence — safe to push${NC}"
    fi
    echo ""
fi

# Tar's --files-from reads the list of paths to include. Write to a tempfile
# so we don't depend on process substitution.
TMPLIST=$(mktemp)
printf '%s\n' "${PATHS[@]}" > "$TMPLIST"

# Build a space-separated list of pushed paths for the remote-side chown.
# Scoped to just what we pushed so we don't chown the whole data tree
# (which contains gigabytes of sessions / repos / mcp_packages).
REMOTE_CHOWN_TARGETS=""
for p in "${PATHS[@]}"; do
    REMOTE_CHOWN_TARGETS+=" '$DATA_MOUNT_POINT/$p'"
done

echo -e "${YELLOW}Streaming paths to $REMOTE_DATA_DIR ...${NC}"

# Single SSH session: mkdir (defensive) + tar -x (from stdin) + scoped chown.
# Consolidating into one call avoids ~10s of cumulative SSH setup overhead
# vs the previous three-call approach.
tar -C "$PROJECT_DIR" -cf - --files-from="$TMPLIST" \
    | gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
        --command="
set -e
sudo mkdir -p '$REMOTE_DATA_DIR'
sudo chmod a+rwx '$REMOTE_DATA_DIR'
sudo tar -C '$DATA_MOUNT_POINT' -xf -
sudo chown -R 1001:1001$REMOTE_CHOWN_TARGETS
sudo chmod -R u+rwX,go+rX$REMOTE_CHOWN_TARGETS
"

rm -f "$TMPLIST"

# tar preserves the source file mode, so a restrictively-permissioned local file
# (Write-tool output is mode 600) would land unreadable/unwritable for the app.
# The chown+chmod above reassigns every pushed manifest path to the container
# user with owner read/write (dirs traversable) — user config the app edits via
# the Home Tab needs write; shipped defaults just need read. Verify from the
# container's own point of view so a botched push fails here, not at a 9am cron.
CONTAINER_PATHS=""
for p in "${PATHS[@]}"; do
    CONTAINER_PATHS+=" /app/$p"
done
echo -e "${YELLOW}Verifying container read-access...${NC}"
if ! verify_container_reads $CONTAINER_PATHS; then
    echo -e "${RED}✗ Pushed files are not readable by the app. Fix perms/ownership on the VM before relying on this push.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Config pushed${NC}"
echo ""
echo -e "${YELLOW}Note:${NC} config.json and mcp.json hot-reload via the bot's file watcher."
echo "default_configuration changes take effect on the next session start."
echo "If you need them applied immediately, restart the container:"
echo "  bash scripts/gce-update-image.sh    # rebuilds + restarts"
echo "  # or just:"
echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker restart clack'"
