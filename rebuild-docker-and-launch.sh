#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="clack"
IMAGE_NAME="clack"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building ${IMAGE_NAME}..."
docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

echo "Stopping ${CONTAINER_NAME}..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting ${CONTAINER_NAME}..."
docker run -d --name "$CONTAINER_NAME" --restart unless-stopped -v "${SCRIPT_DIR}/data:/app/data" "$IMAGE_NAME"

echo "Done. Logs: docker logs -f ${CONTAINER_NAME}"
