#!/bin/bash
# Fetch a single Clack session (Q&A and/or worker) plus its SDK JSONL from the
# GCE VM into ./data/.debug-sessions/<id>/. Non-destructive — never touches the
# rest of local ./data/.
#
# Usage:
#   scripts/gce-fetch-session.sh <slack-permalink>
#   scripts/gce-fetch-session.sh <channelId> <threadTs>
#
# Example:
#   scripts/gce-fetch-session.sh 'https://applauz.slack.com/archives/D0A92.../p17787...?thread_ts=1778763917.894779'

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

# ============================================
# Parse args
# ============================================
CHANNEL=""
THREAD_TS=""

if [ "$#" -eq 1 ]; then
    URL="$1"
    CHANNEL=$(echo "$URL" | sed -nE 's|.*/archives/([^/?]+).*|\1|p')
    THREAD_TS=$(echo "$URL" | sed -nE 's|.*[?&]thread_ts=([0-9.]+).*|\1|p')
    if [ -z "$THREAD_TS" ]; then
        PNUM=$(echo "$URL" | sed -nE 's|.*/p([0-9]{16}).*|\1|p')
        if [ -n "$PNUM" ]; then
            THREAD_TS="${PNUM:0:10}.${PNUM:10}"
        fi
    fi
elif [ "$#" -eq 2 ]; then
    CHANNEL="$1"
    THREAD_TS="$2"
fi

if [ -z "$CHANNEL" ] || [ -z "$THREAD_TS" ]; then
    echo -e "${RED}Usage:${NC}"
    echo "  $0 <slack-permalink>"
    echo "  $0 <channelId> <threadTs>"
    exit 1
fi

echo -e "${BLUE}Channel: ${NC}$CHANNEL"
echo -e "${BLUE}Thread:  ${NC}$THREAD_TS"
echo ""

require_project
require_instance

THREAD_PREFIX="${THREAD_TS/./-}"
OUT_ID="${CHANNEL}-${THREAD_PREFIX}"
OUT_DIR="$PROJECT_DIR/data/.debug-sessions/$OUT_ID"
mkdir -p "$OUT_DIR"

# ============================================
# Remote script (runs on the VM in one ssh round-trip).
# Discovers matching session dirs + their SDK JSONLs, tars to stdout.
# Manifest goes to stderr so it shows in the local terminal.
# ============================================
REMOTE_CMD=$(cat <<REMOTE
set -e
CHANNEL='$CHANNEL'
THREAD_TS='$THREAD_TS'
THREAD_PREFIX='$THREAD_PREFIX'
ROOT='$DATA_MOUNT_POINT'

# 1. Fast path: dir-prefix match (works when session messageTs == threadTs)
QA_DIRS=\$(sudo ls "\$ROOT/data/sessions/" 2>/dev/null | grep "^\${CHANNEL}-\${THREAD_PREFIX}" || true)

# 2. Fallback: grep context.json for the exact threadTs field. Needed for DMs
#    where the session was created by a reply in the thread (messageTs != threadTs).
if [ -z "\$QA_DIRS" ]; then
    MATCHES=\$(sudo grep -lE "\"threadTs\"[[:space:]]*:[[:space:]]*\"\${THREAD_TS}\"" \
        \$(sudo ls -d \$ROOT/data/sessions/\${CHANNEL}-*/context.json 2>/dev/null) 2>/dev/null || true)
    for m in \$MATCHES; do
        QA_DIRS="\$QA_DIRS \$(basename \$(dirname \$m))"
    done

    if [ -z "\$QA_DIRS" ]; then
        PARTIAL=\$(sudo ls "\$ROOT/data/sessions/" 2>/dev/null | grep "^\${CHANNEL}-" | tail -10 || true)
        if [ -n "\$PARTIAL" ]; then
            {
                echo "=== No exact match for thread \$THREAD_TS ==="
                echo "Most recent sessions for channel \$CHANNEL (up to 10):"
                echo "\$PARTIAL"
                echo "============================================="
            } >&2
        fi
    fi
fi

WORKER_DIRS=""
if sudo test -d "\$ROOT/data/worktree-sessions"; then
    for sd in \$(sudo ls "\$ROOT/data/worktree-sessions/"); do
        F="\$ROOT/data/worktree-sessions/\$sd/state.json"
        if sudo test -f "\$F" \
            && sudo grep -q "\"channel\"[[:space:]]*:[[:space:]]*\"\${CHANNEL}\"" "\$F" \
            && sudo grep -q "\"threadTs\"[[:space:]]*:[[:space:]]*\"\${THREAD_TS}\"" "\$F"; then
            WORKER_DIRS="\$WORKER_DIRS \$sd"
        fi
    done
fi

SDK_IDS=""
for d in \$QA_DIRS; do
    F="\$ROOT/data/sessions/\$d/context.json"
    if sudo test -f "\$F"; then
        ID=\$(sudo grep -oE '"sdkSessionId"[[:space:]]*:[[:space:]]*"[^"]+"' "\$F" | sed -E 's/.*"([^"]+)"\$/\1/' | head -1)
        if [ -n "\$ID" ]; then
            SDK_IDS="\$SDK_IDS \$ID"
        fi
    fi
done

JSONL_REL=""
if [ -n "\$SDK_IDS" ] && sudo test -d "\$ROOT/data/.claude/projects"; then
    for id in \$SDK_IDS; do
        while IFS= read -r p; do
            JSONL_REL="\$JSONL_REL \${p#\$ROOT/}"
        done < <(sudo find "\$ROOT/data/.claude/projects" -name "\${id}.jsonl" 2>/dev/null || true)
    done
fi

{
    echo "=== Fetch manifest ==="
    echo "Q&A sessions:    \$QA_DIRS"
    echo "Worker sessions: \$WORKER_DIRS"
    echo "SDK JSONLs:      \$JSONL_REL"
    echo "======================"
} >&2

TAR_LIST=""
for d in \$QA_DIRS; do TAR_LIST="\$TAR_LIST data/sessions/\$d"; done
for d in \$WORKER_DIRS; do TAR_LIST="\$TAR_LIST data/worktree-sessions/\$d"; done
for j in \$JSONL_REL; do TAR_LIST="\$TAR_LIST \$j"; done

if [ -z "\$TAR_LIST" ]; then
    echo "NO_MATCH" >&2
    exit 2
fi

sudo tar -C "\$ROOT" -cf - \$TAR_LIST
REMOTE
)

echo -e "${YELLOW}Fetching from VM...${NC}"

set +e
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="$REMOTE_CMD" \
    | tar -C "$OUT_DIR" -xf -
SSH_RESULT=${PIPESTATUS[0]}
set -e

if [ "$SSH_RESULT" = "2" ]; then
    echo -e "${RED}✗ No matching session found on VM${NC}"
    rmdir "$OUT_DIR" 2>/dev/null || true
    exit 2
elif [ "$SSH_RESULT" != "0" ]; then
    echo -e "${RED}✗ Fetch failed (exit $SSH_RESULT)${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Extracted to data/.debug-sessions/$OUT_ID/${NC}"
echo ""
echo "Contents:"
( cd "$OUT_DIR" && find . -type f | sort )
