#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_DIR/data"
AUTH_DIR="$DATA_DIR/auth"
SSH_DIR="$AUTH_DIR/ssh"

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Clack Docker Setup Script${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""

# Create auth directories
mkdir -p "$SSH_DIR"

# ============================================
# Step 1: Config file check
# ============================================
echo -e "${YELLOW}Step 1: Checking config.json...${NC}"

if [ ! -f "$DATA_DIR/config.json" ]; then
    echo -e "${YELLOW}Config file not found at $DATA_DIR/config.json${NC}"

    if [ -f "$DATA_DIR/config.example.json" ]; then
        read -p "Would you like to copy config.example.json? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            cp "$DATA_DIR/config.example.json" "$DATA_DIR/config.json"
            echo -e "${GREEN}✓ Created config.json from example${NC}"

            # Open in editor if available
            if [ -n "$EDITOR" ]; then
                read -p "Would you like to edit config.json now? (y/n) " -n 1 -r
                echo ""
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    $EDITOR "$DATA_DIR/config.json"
                fi
            else
                echo -e "${YELLOW}Please edit $DATA_DIR/config.json with your settings${NC}"
            fi
        else
            echo -e "${RED}✗ Config file required. Please create $DATA_DIR/config.json${NC}"
            exit 1
        fi
    else
        echo -e "${RED}✗ No config.example.json found. Please create $DATA_DIR/config.json${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ config.json exists${NC}"
fi

# ============================================
# Step 2: SSH Key Setup
# ============================================
echo ""
echo -e "${YELLOW}Step 2: Setting up SSH key for Git access...${NC}"

if [ -f "$SSH_DIR/id_rsa" ]; then
    echo -e "${GREEN}✓ SSH key already exists at $SSH_DIR/id_rsa${NC}"
else
    echo "No SSH key found. Options:"
    echo "  1) Generate a new SSH key"
    echo "  2) Import an existing SSH key"
    read -p "Choose an option (1/2): " -n 1 -r
    echo ""

    if [[ $REPLY == "1" ]]; then
        # Generate new key
        read -p "Enter email for SSH key (or press Enter for none): " ssh_email
        if [ -n "$ssh_email" ]; then
            ssh-keygen -t ed25519 -C "$ssh_email" -f "$SSH_DIR/id_rsa" -N ""
        else
            ssh-keygen -t ed25519 -f "$SSH_DIR/id_rsa" -N ""
        fi
        echo -e "${GREEN}✓ Generated new SSH key${NC}"
    elif [[ $REPLY == "2" ]]; then
        # Import existing key
        read -p "Enter path to existing private key (e.g., ~/.ssh/id_rsa): " key_path
        key_path="${key_path/#\~/$HOME}"  # Expand ~

        if [ ! -f "$key_path" ]; then
            echo -e "${RED}✗ Key not found at $key_path${NC}"
            exit 1
        fi

        cp "$key_path" "$SSH_DIR/id_rsa"
        if [ -f "${key_path}.pub" ]; then
            cp "${key_path}.pub" "$SSH_DIR/id_rsa.pub"
        else
            # Generate public key from private key
            ssh-keygen -y -f "$SSH_DIR/id_rsa" > "$SSH_DIR/id_rsa.pub"
        fi
        echo -e "${GREEN}✓ Imported SSH key${NC}"
    else
        echo -e "${RED}✗ Invalid option${NC}"
        exit 1
    fi
fi

# Set correct permissions
chmod 600 "$SSH_DIR/id_rsa"
if [ -f "$SSH_DIR/id_rsa.pub" ]; then
    chmod 644 "$SSH_DIR/id_rsa.pub"
fi

# Display GitHub instructions
echo ""
echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   GitHub Deploy Key Setup${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""
echo "Add this public key as a Deploy Key to your GitHub repository:"
echo ""
echo -e "${GREEN}$(cat "$SSH_DIR/id_rsa.pub")${NC}"
echo ""
echo "Steps:"
echo "  1. Go to your repository on GitHub"
echo "  2. Navigate to Settings → Deploy keys"
echo "  3. Click 'Add deploy key'"
echo "  4. Paste the key above and save"
echo ""
echo "Or visit: https://github.com/YOUR-ORG/YOUR-REPO/settings/keys"
echo ""
read -p "Press Enter when you've added the key to GitHub..."

# ============================================
# Step 3: Slack Credentials
# ============================================
echo ""
echo -e "${YELLOW}Step 3: Setting up Slack credentials...${NC}"

if [ -f "$AUTH_DIR/slack.json" ]; then
    echo -e "${GREEN}✓ slack.json already exists${NC}"

    # Validate format
    if ! grep -q '"botToken"' "$AUTH_DIR/slack.json" 2>/dev/null; then
        echo -e "${YELLOW}Warning: slack.json may be malformed${NC}"
    fi
else
    echo "Slack credentials not found. Let's set them up."
    echo ""
    echo "You can find these values in your Slack App settings:"
    echo "  - Bot Token: OAuth & Permissions → Bot User OAuth Token"
    echo "  - App Token: Basic Information → App-Level Tokens"
    echo "  - Signing Secret: Basic Information → App Credentials"
    echo ""

    read -p "Enter Slack Bot Token (xoxb-...): " bot_token
    read -p "Enter Slack App Token (xapp-...): " app_token
    read -p "Enter Slack Signing Secret: " signing_secret

    # Validate tokens
    if [[ ! $bot_token == xoxb-* ]]; then
        echo -e "${RED}✗ Bot token must start with 'xoxb-'${NC}"
        exit 1
    fi
    if [[ ! $app_token == xapp-* ]]; then
        echo -e "${RED}✗ App token must start with 'xapp-'${NC}"
        exit 1
    fi
    if [ -z "$signing_secret" ]; then
        echo -e "${RED}✗ Signing secret is required${NC}"
        exit 1
    fi

    # Write slack.json
    cat > "$AUTH_DIR/slack.json" << EOF
{
  "botToken": "$bot_token",
  "appToken": "$app_token",
  "signingSecret": "$signing_secret"
}
EOF

    echo -e "${GREEN}✓ Created slack.json${NC}"
fi

# ============================================
# Step 4: Anthropic API Key
# ============================================
echo ""
echo -e "${YELLOW}Step 4: Setting up Anthropic API key...${NC}"

if [ -f "$AUTH_DIR/.env" ] && grep -q "ANTHROPIC_API_KEY" "$AUTH_DIR/.env" 2>/dev/null; then
    echo -e "${GREEN}✓ ANTHROPIC_API_KEY already configured${NC}"
else
    echo "Anthropic API key not found."
    echo ""
    echo "Get your API key from: https://console.anthropic.com/settings/keys"
    echo ""

    read -p "Enter your Anthropic API Key (sk-ant-...): " api_key

    # Validate format
    if [[ ! $api_key == sk-ant-* ]]; then
        echo -e "${YELLOW}Warning: API key doesn't match expected format (sk-ant-...)${NC}"
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    echo "ANTHROPIC_API_KEY=$api_key" > "$AUTH_DIR/.env"
    chmod 600 "$AUTH_DIR/.env"

    echo -e "${GREEN}✓ Created .env with API key${NC}"
fi

# ============================================
# Step 5: Validation
# ============================================
echo ""
echo -e "${YELLOW}Step 5: Validating setup...${NC}"

errors=0

# Check SSH key permissions
if [ -f "$SSH_DIR/id_rsa" ]; then
    perms=$(stat -f "%OLp" "$SSH_DIR/id_rsa" 2>/dev/null || stat -c "%a" "$SSH_DIR/id_rsa" 2>/dev/null)
    if [ "$perms" = "600" ]; then
        echo -e "${GREEN}✓ SSH key permissions correct (600)${NC}"
    else
        echo -e "${RED}✗ SSH key permissions incorrect: $perms (should be 600)${NC}"
        chmod 600 "$SSH_DIR/id_rsa"
        echo -e "${GREEN}  Fixed permissions${NC}"
    fi
else
    echo -e "${RED}✗ SSH key not found${NC}"
    errors=$((errors + 1))
fi

# Check slack.json
if [ -f "$AUTH_DIR/slack.json" ]; then
    if grep -q '"botToken":.*"xoxb-' "$AUTH_DIR/slack.json" 2>/dev/null; then
        echo -e "${GREEN}✓ Slack bot token format valid${NC}"
    else
        echo -e "${RED}✗ Slack bot token format invalid${NC}"
        errors=$((errors + 1))
    fi
    if grep -q '"appToken":.*"xapp-' "$AUTH_DIR/slack.json" 2>/dev/null; then
        echo -e "${GREEN}✓ Slack app token format valid${NC}"
    else
        echo -e "${RED}✗ Slack app token format invalid${NC}"
        errors=$((errors + 1))
    fi
else
    echo -e "${RED}✗ slack.json not found${NC}"
    errors=$((errors + 1))
fi

# Check .env
if [ -f "$AUTH_DIR/.env" ] && grep -q "ANTHROPIC_API_KEY=" "$AUTH_DIR/.env" 2>/dev/null; then
    echo -e "${GREEN}✓ Anthropic API key configured${NC}"
else
    echo -e "${RED}✗ Anthropic API key not configured${NC}"
    errors=$((errors + 1))
fi

# Check config.json
if [ -f "$DATA_DIR/config.json" ]; then
    echo -e "${GREEN}✓ config.json exists${NC}"
else
    echo -e "${RED}✗ config.json not found${NC}"
    errors=$((errors + 1))
fi

if [ $errors -gt 0 ]; then
    echo ""
    echo -e "${RED}Setup completed with $errors error(s). Please fix the issues above.${NC}"
    exit 1
fi

# ============================================
# Step 6: Output Docker Commands
# ============================================
echo ""
echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Setup Complete!${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""
echo "All credentials are configured. Run these commands to build and start Clack:"
echo ""
echo -e "${GREEN}# Build the Docker image${NC}"
echo "docker build -t clack ."
echo ""
echo -e "${GREEN}# Run the container${NC}"
echo "docker run -d \\"
echo "  --name clack \\"
echo "  --restart unless-stopped \\"
echo "  --env-file $AUTH_DIR/.env \\"
echo "  -v $DATA_DIR/config.json:/app/data/config.json:ro \\"
echo "  -v $AUTH_DIR:/app/data/auth:ro \\"
echo "  -v clack-repos:/app/data/repositories \\"
echo "  clack"
echo ""
echo -e "${GREEN}# View logs${NC}"
echo "docker logs -f clack"
echo ""
