# Rune Forge Platform - Quick Start Guide

**Last Updated:** 2025-12-29

## Overview

This guide provides the essential commands and steps to deploy Rune Forge's production multiplayer platform.

## Prerequisites

- Docker and Docker Compose installed
- Tailscale account
- Pocket ID instance (auth.poley.dev)
- GitHub account (for CI/CD)

## Local Development Setup

### 1. Install Dependencies

```bash
cd /Users/jasonpoley/prj/jp/rune-forge
pnpm install
```

### 2. Start Development Environment

```bash
# Start server and client with hot reload
./scripts/dev.sh

# Or manually:
pnpm run dev:server  # http://localhost:41204
pnpm run dev:client  # http://localhost:5173
```

### 3. Run Tests

```bash
pnpm run test:simulation
pnpm run typecheck
pnpm run lint
```

## Docker Deployment

### Development (SQLite + Local LiveKit)

```bash
cd docker
docker-compose up --build
```

Access:
- Game: http://localhost:41204
- Grafana: http://localhost:3001

### Production (Full Stack)

```bash
# 1. Configure environment
cp .env.example .env.production
vim .env.production  # Fill in secrets

# 2. Build and deploy
docker-compose -f docker/docker-compose.prod.yml up -d

# 3. Verify health
curl http://localhost:41204/api/health
```

## CI/CD Setup

### 1. Configure GitHub Secrets

Navigate to: `Settings > Secrets and variables > Actions`

Add secrets:
```
POCKET_ID_CLIENT_SECRET
LIVEKIT_API_SECRET
JWT_SECRET
COOKIE_SECRET
GRAFANA_ADMIN_PASSWORD
```

### 2. Enable GitHub Actions

The workflow file is at: `.github/workflows/ci-cd.yml`

Triggers:
- Push to `main` or `develop`
- Pull requests to `main`
- Manual dispatch

### 3. Monitor Pipeline

Visit: `https://github.com/jasonpoley/rune-forge/actions`

Expected stages:
1. Build (~20 min)
2. Security Scan (~10 min)
3. SBOM Generation (~5 min)
4. Container Build (~5 min)
5. Deploy (~5 min)

**Total:** ~45 minutes

## Tailscale Setup

### Server Configuration

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Authenticate with tags
sudo tailscale up --advertise-tags=tag:game-server --hostname=runeforge-server

# Verify
sudo tailscale status
```

### Player Connection

Players need:
1. Tailscale installed
2. Connected to same tailnet
3. Game server URL: `https://runeforge-server.tail-scale.ts.net`

## Observability

### Access Dashboards

- **Grafana:** http://localhost:3001 (admin / [from .env])
- **Prometheus:** http://localhost:9090

### Key Metrics

```bash
# Server health
curl http://localhost:3001/metrics | grep runeforge_sessions_active

# View logs
docker logs -f runeforge-server

# Check LiveKit
docker logs -f runeforge-livekit
```

## Common Operations

### Deploy New Version

```bash
# Blue-green deployment
./scripts/deploy-blue-green.sh production ghcr.io/jasonpoley/rune-forge:v1.1.0
```

### Rollback

```bash
# Instant rollback to previous version
./scripts/rollback.sh
```

### Backup Database

```bash
# Manual backup
./scripts/backup-database.sh

# Restore from backup
docker stop runeforge-server
cp /opt/runeforge/backups/rune-forge-YYYYMMDD.db.gz /opt/runeforge/data/
gunzip /opt/runeforge/data/rune-forge-YYYYMMDD.db.gz
mv /opt/runeforge/data/rune-forge-YYYYMMDD.db /opt/runeforge/data/rune-forge.db
docker start runeforge-server
```

## Troubleshooting

### Server Won't Start

```bash
# Check logs
docker logs runeforge-server --tail 100

# Verify environment variables
docker exec runeforge-server env | grep POCKET_ID

# Test database connection
docker exec runeforge-server ls -lh /app/data
```

### Players Can't Connect

```bash
# Check Tailscale
sudo tailscale status
sudo tailscale ping runeforge-server

# Verify firewall
sudo iptables -L -n | grep 41204

# Test from player side
tailscale ping runeforge-server
curl http://runeforge-server.tail-scale.ts.net:41204/api/health
```

### High Latency

```bash
# Check Grafana dashboard: WebSocket Latency panel

# View active connections
docker exec runeforge-server ss -tunap | grep :41204

# Inspect LiveKit quality
docker exec runeforge-livekit livekit-cli room list
```

## Security Checklist

- [ ] All secrets in `.env.production` (not in code)
- [ ] Tailscale ACLs configured (restrict to `tag:player`)
- [ ] JWT secret rotated quarterly
- [ ] Database backups verified (test restore)
- [ ] HTTPS enabled (Tailscale Funnel or reverse proxy)
- [ ] Container images signed (GitHub attestations)
- [ ] Security scanning passing (no critical CVEs)

## Next Steps

1. **Review Full Architecture:** [PLATFORM_ARCHITECTURE.md](./PLATFORM_ARCHITECTURE.md)
2. **Set Up CI/CD:** Configure GitHub Actions
3. **Deploy Observability:** Start Prometheus + Grafana
4. **Integrate Pocket ID:** Configure OIDC client
5. **Test Multiplayer:** Connect 2+ clients

## Support

- **Documentation:** `/docs/platform/`
- **Runbooks:** See [PLATFORM_ARCHITECTURE.md](./PLATFORM_ARCHITECTURE.md) - Operational Runbooks
- **Issues:** https://github.com/jasonpoley/rune-forge/issues
