# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY src/ ./src/
COPY tsconfig.json tsconfig.build.json ./
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install git for repository operations
RUN apk add --no-cache git curl bash

# Enable corepack so pnpm/yarn shims are available for repo hooks
RUN corepack enable

# Install github-mcp-server for GitHub API access via MCP
ARG GITHUB_MCP_SERVER_VERSION=0.31.0
ARG TARGETARCH
RUN ARCH=$(echo "${TARGETARCH}" | sed 's/amd64/x86_64/' | sed 's/arm64/arm64/') && \
    wget -qO- "https://github.com/github/github-mcp-server/releases/download/v${GITHUB_MCP_SERVER_VERSION}/github-mcp-server_Linux_${ARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin github-mcp-server

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy example configs for reference
COPY data/config.example.json ./data/
COPY data/mcp.example.json ./data/
COPY data/auth/slack.example.json ./data/auth/
COPY data/auth/.env.example ./data/auth/
COPY data/auth/github.example.json ./data/auth/

# Copy default configuration (instruction templates)
COPY data/default_configuration/ ./data/default_configuration/

# Create data directories
RUN mkdir -p data/repositories data/sessions data/auth data/configuration

# Create non-root user and set permissions
RUN addgroup -g 1001 -S nodejs && \
    adduser -S clack -u 1001 -G nodejs && \
    chown -R clack:nodejs /app

# Switch to non-root user
USER clack

# Set HOME for Claude Code
ENV HOME=/home/clack
# Store Claude Code sessions inside /app/data so they survive container restarts
ENV CLAUDE_CONFIG_DIR=/app/data/.claude
# Persist npm/npx cache in /app/data so MCP packages survive container rebuilds
ENV npm_config_cache=/app/data/.npm

# Configure git for the clack user (needed by Claude Code for push operations)
RUN git config --global user.name "Clack" && \
    git config --global user.email "clack[bot]@users.noreply.github.com" && \
    git config --global safe.directory '*'

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('ok')" || exit 1

# Start the application
CMD ["node", "dist/index.js"]
