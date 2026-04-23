#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="clack"
IMAGE_NAME="clack"

cd "$(dirname "$0")"

# pwd -W is an MSYS/Git Bash extension that returns the Windows-style path
# (e.g. E:/Clack) that Docker Desktop requires on Windows. On Linux/macOS
# it errors and we fall back to regular pwd, which Docker accepts natively.
HOST_DIR="$(pwd -W 2>/dev/null || pwd)"

echo "Building ${IMAGE_NAME}..."
docker build -t "$IMAGE_NAME" .

echo "Stopping ${CONTAINER_NAME}..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting ${CONTAINER_NAME}..."
docker run -d --name "$CONTAINER_NAME" --restart unless-stopped -v "${HOST_DIR}/data:/app/data" "$IMAGE_NAME"

echo "Done. Logs: docker logs -f ${CONTAINER_NAME}"
