# Build stage for client
FROM node:22-slim AS client-builder

WORKDIR /app

# Enable corepack for pnpm and install Bun (needed for build scripts)
RUN corepack enable pnpm && npm install -g bun

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/simulation/package.json ./packages/simulation/
COPY packages/client/package.json ./packages/client/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY packages/simulation/ ./packages/simulation/
COPY packages/client/ ./packages/client/

# Build simulation first (client depends on it)
WORKDIR /app/packages/simulation
RUN pnpm run build

# Build client
WORKDIR /app/packages/client
RUN pnpm run build

# Build stage for server
FROM node:22-slim AS server-builder

WORKDIR /app

# Enable corepack for pnpm and install Bun (needed for build scripts)
RUN corepack enable pnpm && npm install -g bun

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/simulation/package.json ./packages/simulation/
COPY packages/server/package.json ./packages/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY packages/simulation/ ./packages/simulation/
COPY packages/server/ ./packages/server/

# Build simulation
WORKDIR /app/packages/simulation
RUN pnpm run build

# Build server
WORKDIR /app/packages/server
RUN pnpm run build

# Production stage
FROM oven/bun:1-slim AS production

WORKDIR /app

# Create non-root user for security (using groupadd/useradd for Debian slim)
RUN groupadd --system --gid 1001 runeforge && \
    useradd --system --uid 1001 --gid runeforge --no-create-home runeforge

# Copy built artifacts
COPY --from=client-builder /app/packages/client/dist ./client/dist
COPY --from=server-builder /app/packages/server/dist ./server/dist

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R runeforge:runeforge /app/data

# Switch to non-root user
USER runeforge

# Environment variables
ENV PORT=41204
ENV CLIENT_DIR=/app/client/dist
ENV DB_PATH=/app/data/rune-forge.db
ENV NODE_ENV=production

# Expose port
EXPOSE 41204

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:41204/api/health || exit 1

# Start the server
CMD ["bun", "run", "/app/server/dist/index.js"]
