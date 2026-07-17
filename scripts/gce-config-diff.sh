#!/bin/bash
# Read-only diff of "project-class" config between local ./data/ and the VM's
# persistent data disk. Answers "is what's on GCP the right thing?" BEFORE a
# push — including the case gce-push-config.sh cannot express: files that were
# deleted/renamed locally but still exist on the VM (the push is a tar-pipe
# overlay and never deletes, so those go stale silently).
#
# Scope: the same data/.deploy-include manifest gce-push-config.sh pushes.
#
# For every file under the manifest paths, prints one of:
#   IN SYNC     — identical content
#   DIFFERS     — content differs; mtimes decide the suggested direction
#   LOCAL ONLY  — exists locally only → will be created by the next push
#   VM ONLY     — exists on the VM only → either a VM-side addition to pull,
#                 or a locally-deleted file the push would leave stale
#
# Usage:
#   scripts/gce-config-diff.sh                 # full manifest
#   scripts/gce-config-diff.sh --path data/default_configuration
#   scripts/gce-config-diff.sh --show data/config.json   # unified diff of one file
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

ONLY_PATH=""
SHOW_PATH=""
while [ $# -gt 0 ]; do
    case "$1" in
        --path) ONLY_PATH="$2"; shift 2 ;;
        --show) SHOW_PATH="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--path <manifest-path>] [--show <file>]"
            echo "  --path <p>   restrict the report to one manifest path"
            echo "  --show <f>   print a unified diff (- VM, + local) for one file"
            exit 0
            ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

require_project
require_instance

MANIFEST="$DATA_DIR/.deploy-include"
if [ ! -f "$MANIFEST" ]; then
    echo -e "${RED}✗ Manifest not found at $MANIFEST${NC}"
    echo "  cp data/.deploy-include.example data/.deploy-include"
    exit 1
fi

PATHS=()
while IFS= read -r line; do
    trimmed=$(echo "$line" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
    [ -z "$trimmed" ] && continue
    [[ "$trimmed" == \#* ]] && continue
    if [ -n "$ONLY_PATH" ] && [ "$trimmed" != "$ONLY_PATH" ]; then continue; fi
    PATHS+=("$trimmed")
done < "$MANIFEST"

if [ "${#PATHS[@]}" -eq 0 ]; then
    echo -e "${RED}✗ No manifest paths matched${NC}"
    exit 1
fi

# --show: unified diff of a single file and exit.
if [ -n "$SHOW_PATH" ]; then
    REMOTE_CONTENT=$(gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
        --command="sudo cat '$DATA_MOUNT_POINT/$SHOW_PATH' 2>/dev/null" 2>/dev/null || true)
    diff -u <(printf '%s' "$REMOTE_CONTENT") "$PROJECT_DIR/$SHOW_PATH" \
        --label "vm/$SHOW_PATH" --label "local/$SHOW_PATH" || true
    exit 0
fi

TMP=$(mktemp -d)
# shellcheck disable=SC2064
trap "rm -rf '$TMP'" EXIT

REMOTE_ARGS=""
for p in "${PATHS[@]}"; do
    REMOTE_ARGS+=" '$p'"
done

# One SSH round-trip: for every file under the manifest paths on the VM, emit
# "<md5>  <epoch-mtime>  <path>". Missing paths are skipped silently.
echo -e "${YELLOW}Fetching VM file inventory...${NC}" >&2
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
cd '$DATA_MOUNT_POINT' 2>/dev/null || exit 0
for p in$REMOTE_ARGS; do
    [ -e \"\$p\" ] || continue
    sudo find \"\$p\" -type f ! -name '._*' ! -name '.DS_Store' | while IFS= read -r f; do
        h=\$(sudo md5sum \"\$f\" | cut -d' ' -f1)
        m=\$(sudo stat -c '%Y' \"\$f\")
        printf '%s\t%s\t%s\n' \"\$h\" \"\$m\" \"\$f\"
    done
done
" 2>/dev/null | sort -t$'\t' -k3 > "$TMP/remote.tsv"

# Local inventory in the same shape (portable across macOS/Linux stat+md5).
(
cd "$PROJECT_DIR"
for p in "${PATHS[@]}"; do
    [ -e "$p" ] || continue
    find "$p" -type f ! -name '._*' ! -name '.DS_Store' | while IFS= read -r f; do
        if command -v md5sum >/dev/null 2>&1; then
            h=$(md5sum "$f" | cut -d' ' -f1)
        else
            h=$(md5 -q "$f")
        fi
        if stat -c '%Y' "$f" >/dev/null 2>&1; then
            m=$(stat -c '%Y' "$f")
        else
            m=$(stat -f '%m' "$f")
        fi
        printf '%s\t%s\t%s\n' "$h" "$m" "$f"
    done
done
) | sort -t$'\t' -k3 > "$TMP/local.tsv"

cut -f3 "$TMP/local.tsv" > "$TMP/local.paths"
cut -f3 "$TMP/remote.tsv" > "$TMP/remote.paths"
sort -u "$TMP/local.paths" "$TMP/remote.paths" > "$TMP/all.paths"

fmt_epoch() {
    # Portable epoch → "YYYY-MM-DD HH:MM" (local timezone).
    if date -r 0 +%s >/dev/null 2>&1; then
        date -r "$1" '+%Y-%m-%d %H:%M'
    else
        date -d "@$1" '+%Y-%m-%d %H:%M'
    fi
}

lookup() { # $1=file $2=path → "hash<TAB>mtime" or empty
    grep -F "	$2" "$1" | while IFS=$'\t' read -r h m p; do
        [ "$p" = "$2" ] && printf '%s\t%s\n' "$h" "$m"
    done
    return 0
}

IN_SYNC=0
DIFFER=()
LOCAL_ONLY=()
VM_ONLY=()

while IFS= read -r p; do
    L=$(lookup "$TMP/local.tsv" "$p")
    R=$(lookup "$TMP/remote.tsv" "$p")
    if [ -n "$L" ] && [ -z "$R" ]; then
        LOCAL_ONLY+=("$p")
    elif [ -z "$L" ] && [ -n "$R" ]; then
        VM_ONLY+=("$p")
    else
        LH=$(printf '%s' "$L" | cut -f1); LM=$(printf '%s' "$L" | cut -f2)
        RH=$(printf '%s' "$R" | cut -f1); RM=$(printf '%s' "$R" | cut -f2)
        if [ "$LH" = "$RH" ]; then
            IN_SYNC=$((IN_SYNC + 1))
        else
            if [ "$LM" -gt "$RM" ]; then dir="local newer ($(fmt_epoch "$LM") vs $(fmt_epoch "$RM")) → push"
            elif [ "$RM" -gt "$LM" ]; then dir="VM newer ($(fmt_epoch "$RM") vs $(fmt_epoch "$LM")) → pull / merge before pushing"
            else dir="same mtime, different content → inspect with --show"
            fi
            DIFFER+=("$p|$dir")
        fi
    fi
done < "$TMP/all.paths"

echo ""
echo -e "${BLUE}=== gce-config-diff — local ./data vs $INSTANCE_NAME:$DATA_MOUNT_POINT ===${NC}"
echo ""
echo -e "${GREEN}✓ $IN_SYNC file(s) in sync${NC}"

if [ "${#DIFFER[@]}" -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}DIFFERS (${#DIFFER[@]}):${NC}"
    for e in "${DIFFER[@]}"; do
        echo -e "  • ${e%%|*}\n      ${e#*|}"
    done
fi

if [ "${#LOCAL_ONLY[@]}" -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}LOCAL ONLY (${#LOCAL_ONLY[@]}) — created by the next push:${NC}"
    for p in "${LOCAL_ONLY[@]}"; do echo "  • $p"; done
fi

if [ "${#VM_ONLY[@]}" -gt 0 ]; then
    echo ""
    echo -e "${RED}VM ONLY (${#VM_ONLY[@]}) — push NEVER deletes these; if deleted/renamed locally they are stale on the VM:${NC}"
    for p in "${VM_ONLY[@]}"; do echo "  • $p"; done
    echo "  Remove stale ones manually:"
    echo "    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='sudo rm $DATA_MOUNT_POINT/<path>'"
fi

echo ""
if [ "${#DIFFER[@]}" -eq 0 ] && [ "${#LOCAL_ONLY[@]}" -eq 0 ] && [ "${#VM_ONLY[@]}" -eq 0 ]; then
    echo -e "${GREEN}✓ Fully in sync${NC}"
else
    echo -e "${YELLOW}Inspect a file with: $0 --show <path>${NC}"
    echo -e "${YELLOW}Push local → VM with: scripts/gce-push-config.sh${NC}"
fi
