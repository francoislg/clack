#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
INSTANCE_NAME="clack"
ZONE="northamerica-northeast1-a"
MACHINE_TYPE="e2-micro"
IMAGE_NAME="gcr.io/${PROJECT_ID}/clack:latest"

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_DIR/data"
AUTH_DIR="$DATA_DIR/auth"

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

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}✗ No GCP project set. Run: gcloud config set project YOUR_PROJECT${NC}"
    exit 1
fi

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
# Create VM if it doesn't exist
# ============================================
echo -e "${YELLOW}Setting up Compute Engine instance...${NC}"

if gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" &>/dev/null; then
    echo -e "${YELLOW}Instance '$INSTANCE_NAME' already exists${NC}"
    read -p "Do you want to update it? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
    INSTANCE_EXISTS=true
else
    echo "Creating new instance '$INSTANCE_NAME'..."

    gcloud compute instances create "$INSTANCE_NAME" \
        --zone="$ZONE" \
        --machine-type="$MACHINE_TYPE" \
        --image-family=cos-stable \
        --image-project=cos-cloud \
        --boot-disk-size=10GB \
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
# Copy config files to instance
# ============================================
echo -e "${YELLOW}Copying configuration files...${NC}"

# Create a temporary directory with the config files
TEMP_DIR=$(mktemp -d)
mkdir -p "$TEMP_DIR/data/auth"
cp "$DATA_DIR/config.json" "$TEMP_DIR/data/"
cp "$AUTH_DIR/slack.json" "$TEMP_DIR/data/auth/"
cp "$AUTH_DIR/.env" "$TEMP_DIR/data/auth/"
cp "$AUTH_DIR/github.json" "$TEMP_DIR/data/auth/"

# Copy GitHub App private key
pem_path=$(grep -o '"privateKeyPath":[[:space:]]*"[^"]*"' "$AUTH_DIR/github.json" 2>/dev/null | sed 's/.*"privateKeyPath":[[:space:]]*"\(.*\)"/\1/')
if [ -n "$pem_path" ]; then
    full_pem_path="$PROJECT_DIR/$pem_path"
    if [ -f "$full_pem_path" ]; then
        cp "$full_pem_path" "$TEMP_DIR/data/auth/"
    fi
fi

# Copy files to instance
gcloud compute scp --recurse "$TEMP_DIR/data" "$INSTANCE_NAME:~/" --zone="$ZONE" --quiet

# Clean up temp directory
rm -rf "$TEMP_DIR"

echo -e "${GREEN}✓ Configuration files copied${NC}"
echo ""

# ============================================
# Deploy container on instance
# ============================================
echo -e "${YELLOW}Deploying container...${NC}"

# Load ANTHROPIC_API_KEY from .env
ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY "$AUTH_DIR/.env" | cut -d '=' -f2)

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
    # Authenticate with Container Registry
    docker-credential-gcr configure-docker --registries=gcr.io

    # Stop and remove existing container if running
    docker stop clack 2>/dev/null || true
    docker rm clack 2>/dev/null || true

    # Pull latest image
    docker pull $IMAGE_NAME

    # Run container
    docker run -d \\
        --name clack \\
        --restart unless-stopped \\
        -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \\
        -v \$HOME/data/config.json:/app/data/config.json:ro \\
        -v \$HOME/data/auth:/app/data/auth:ro \\
        -v clack-repos:/app/data/repositories \\
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
