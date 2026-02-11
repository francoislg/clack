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

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}   Clack Docker Setup Script${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""

# Create auth directory
mkdir -p "$AUTH_DIR"

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
# Step 2: GitHub App Credentials
# ============================================
echo ""
echo -e "${YELLOW}Step 2: Setting up GitHub App credentials...${NC}"

if [ -f "$AUTH_DIR/github.json" ]; then
    echo -e "${GREEN}✓ github.json already exists${NC}"
else
    echo ""
    echo -e "${BLUE}You need a GitHub App to authenticate with GitHub.${NC}"
    echo ""
    echo "To create one:"
    echo "  1. Go to your org: Settings → Developer settings → GitHub Apps → New GitHub App"
    echo "  2. Set permissions:"
    echo "     - Repository permissions → Contents: Read & write"
    echo "     - Repository permissions → Pull requests: Read & write"
    echo "     - Repository permissions → Metadata: Read-only"
    echo "  3. Install the app on your org and select the repositories"
    echo "  4. Note the App ID (on the app's General page)"
    echo "  5. Note the Installation ID (from the URL when viewing the installation)"
    echo "  6. Generate a private key (on the app's General page → Private keys)"
    echo ""

    read -p "Enter GitHub App ID: " app_id
    read -p "Enter Installation ID: " installation_id

    if [ -z "$app_id" ] || [ -z "$installation_id" ]; then
        echo -e "${RED}✗ App ID and Installation ID are required${NC}"
        exit 1
    fi

    # Private key setup
    echo ""
    read -p "Enter path to GitHub App private key (.pem file): " pem_path
    pem_path="${pem_path/#\~/$HOME}"  # Expand ~

    if [ ! -f "$pem_path" ]; then
        echo -e "${RED}✗ Private key not found at $pem_path${NC}"
        exit 1
    fi

    cp "$pem_path" "$AUTH_DIR/github-app.pem"
    chmod 600 "$AUTH_DIR/github-app.pem"

    # Write github.json
    cat > "$AUTH_DIR/github.json" << EOF
{
  "appId": "$app_id",
  "installationId": "$installation_id",
  "privateKeyPath": "data/auth/github-app.pem"
}
EOF

    echo -e "${GREEN}✓ Created github.json and copied private key${NC}"
fi

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
# Step 4: Claude Authentication
# ============================================
echo ""
echo -e "${YELLOW}Step 4: Setting up Claude authentication...${NC}"

# Check if already configured
has_api_key=false
has_oauth_token=false

if [ -f "$AUTH_DIR/.env" ]; then
    grep -q "ANTHROPIC_API_KEY" "$AUTH_DIR/.env" 2>/dev/null && has_api_key=true
    grep -q "CLAUDE_CODE_OAUTH_TOKEN" "$AUTH_DIR/.env" 2>/dev/null && has_oauth_token=true
fi

if $has_api_key || $has_oauth_token; then
    if $has_oauth_token; then
        echo -e "${GREEN}✓ CLAUDE_CODE_OAUTH_TOKEN already configured (uses Claude Max subscription)${NC}"
    else
        echo -e "${GREEN}✓ ANTHROPIC_API_KEY already configured (uses API pay-as-you-go)${NC}"
    fi
else
    echo "Claude authentication not found."
    echo ""
    echo "Choose authentication method:"
    echo "  1) OAuth Token - Use your Claude Max/Pro subscription (no API charges)"
    echo "  2) API Key - Pay-as-you-go API usage"
    echo ""
    read -p "Choose an option (1/2): " -n 1 -r
    echo ""

    if [[ $REPLY == "1" ]]; then
        # OAuth Token setup
        echo ""
        echo -e "${BLUE}To generate an OAuth token:${NC}"
        echo "  1. Install Claude Code CLI: npm install -g @anthropic-ai/claude-code"
        echo "  2. Run: claude setup-token"
        echo "  3. Copy the token (starts with sk-ant-oat01-...)"
        echo ""
        echo -e "${YELLOW}Note: You must have a Claude Max or Pro subscription.${NC}"
        echo ""

        read -p "Enter your OAuth Token (sk-ant-oat01-...): " oauth_token

        # Validate format
        if [[ ! $oauth_token == sk-ant-oat01-* ]]; then
            echo -e "${YELLOW}Warning: OAuth token doesn't match expected format (sk-ant-oat01-...)${NC}"
            read -p "Continue anyway? (y/n) " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi

        echo "CLAUDE_CODE_OAUTH_TOKEN=$oauth_token" > "$AUTH_DIR/.env"
        chmod 600 "$AUTH_DIR/.env"

        echo -e "${GREEN}✓ Created .env with OAuth token${NC}"
        echo -e "${YELLOW}Note: Using OAuth token means no API charges - uses your Claude subscription.${NC}"

    elif [[ $REPLY == "2" ]]; then
        # API Key setup
        echo ""
        echo "Get your API key from: https://console.anthropic.com/settings/keys"
        echo ""

        read -p "Enter your Anthropic API Key (sk-ant-api...): " api_key

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
        echo -e "${YELLOW}Note: Using API key means pay-as-you-go charges.${NC}"
    else
        echo -e "${RED}✗ Invalid option${NC}"
        exit 1
    fi
fi

# ============================================
# Step 5: Validation
# ============================================
echo ""
echo -e "${YELLOW}Step 5: Validating setup...${NC}"

errors=0

# Check GitHub App credentials
if [ -f "$AUTH_DIR/github.json" ]; then
    echo -e "${GREEN}✓ GitHub App credentials configured${NC}"

    # Check private key
    pem_path=$(grep -o '"privateKeyPath":[[:space:]]*"[^"]*"' "$AUTH_DIR/github.json" 2>/dev/null | sed 's/.*"privateKeyPath":[[:space:]]*"\(.*\)"/\1/')
    if [ -n "$pem_path" ]; then
        full_pem_path="$PROJECT_DIR/$pem_path"
        if [ -f "$full_pem_path" ]; then
            echo -e "${GREEN}✓ GitHub App private key found${NC}"
        else
            echo -e "${RED}✗ GitHub App private key not found at $full_pem_path${NC}"
            errors=$((errors + 1))
        fi
    fi
else
    echo -e "${RED}✗ GitHub App credentials not configured${NC}"
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

# Check .env for authentication
if [ -f "$AUTH_DIR/.env" ]; then
    if grep -q "CLAUDE_CODE_OAUTH_TOKEN=" "$AUTH_DIR/.env" 2>/dev/null; then
        echo -e "${GREEN}✓ Claude OAuth token configured (uses subscription)${NC}"
    elif grep -q "ANTHROPIC_API_KEY=" "$AUTH_DIR/.env" 2>/dev/null; then
        echo -e "${GREEN}✓ Anthropic API key configured (pay-as-you-go)${NC}"
    else
        echo -e "${RED}✗ Claude authentication not configured${NC}"
        errors=$((errors + 1))
    fi
else
    echo -e "${RED}✗ Claude authentication not configured${NC}"
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
