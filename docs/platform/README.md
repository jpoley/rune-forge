# Rune Forge Platform Documentation

**Last Updated:** 2025-12-29
**Status:** Design Complete, Implementation Pending

## Overview

This directory contains comprehensive platform engineering documentation for Rune Forge's evolution from single-player tactical RPG to production-ready multiplayer platform.

## Documents

### 1. [PLATFORM_ARCHITECTURE.md](./PLATFORM_ARCHITECTURE.md)
**Comprehensive platform specification (60+ pages)**

Topics covered:
- DORA Elite Performance Design (< 1 hour lead time, < 15 min MTTR)
- System Architecture (Tailscale mesh, LiveKit SFU, Pocket ID OIDC)
- CI/CD Pipeline Architecture (GitHub Actions, SLSA Level 3)
- Infrastructure Components (Docker, observability stack)
- Security Architecture (secrets management, scanning schedule)
- Observability Stack (OpenTelemetry, Prometheus, Grafana)
- Deployment Strategy (blue-green, rollback procedures)
- Operational Runbooks (incident response)
- Implementation Roadmap (6-phase, 10-week plan)

### 2. [QUICK_START.md](./QUICK_START.md)
**Practical getting-started guide**

Essential commands for:
- Local development setup
- Docker deployment
- CI/CD configuration
- Tailscale networking
- Observability access
- Common operations
- Troubleshooting

## Key Deliverables

### CI/CD Pipeline
**Location:** `/.github/workflows/ci-cd.yml`

**Features:**
- ✅ Automated build and test (TypeScript, ESLint, pnpm test)
- ✅ Parallel security scanning (Semgrep SAST, pnpm audit, Gitleaks)
- ✅ SBOM generation (CycloneDX format, JSON + XML)
- ✅ Container build with caching (GitHub Container Registry)
- ✅ Image attestation (SLSA provenance, signed SBOM)
- ✅ Container vulnerability scanning (Trivy, blocks on critical CVEs)
- ✅ Pipeline summary (visual status in GitHub Actions)

**Target Metrics:**
- Total pipeline time: ~45 minutes (parallel execution)
- Build stage: ~20 minutes
- Security scanning: ~10 minutes (parallel)
- Container packaging: ~5 minutes
- Deployment: ~5 minutes

### Docker Infrastructure
**Location:** `/docker/`

**Components:**
- **Dockerfile:** Multi-stage build (optimized for caching)
- **docker-compose.yml:** Development stack (game server only)
- **docker-compose.prod.yml:** Production stack (documented in PLATFORM_ARCHITECTURE.md)
  - Game server (Bun + WebSocket)
  - LiveKit server (SFU for audio/video)
  - PostgreSQL (future, currently SQLite)
  - Prometheus (metrics collection)
  - Grafana (dashboards and visualization)

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Runtime** | Bun | High-performance JavaScript runtime |
| **Networking** | Tailscale | Zero-config mesh VPN |
| **Game State** | WebSockets | Real-time bidirectional communication |
| **Audio/Video** | LiveKit | Selective Forwarding Unit (SFU) |
| **Authentication** | Pocket ID | OIDC provider with WebAuthn/passkeys |
| **Database (Dev)** | SQLite | File-based persistence |
| **Database (Prod)** | PostgreSQL | Managed relational database |
| **Containers** | Docker | Immutable deployment artifacts |
| **Orchestration** | Docker Compose | Multi-service orchestration |
| **CI/CD** | GitHub Actions | Automated pipeline |
| **Observability** | OpenTelemetry + Grafana Stack | Metrics, logs, traces |

## Architecture Highlights

### Network Topology
```
Players (Tailscale clients)
    ↓
Tailscale Mesh Network (100.x.x.x private subnet)
    ↓
Game Server (Bun + WebSocket)
    ├── HTTP/WebSocket handler
    ├── Session manager
    ├── Combat simulation engine
    └── Database (SQLite/PostgreSQL)
    ↓
External Services:
    ├── LiveKit (audio/video SFU)
    ├── Pocket ID (authentication)
    └── Observability Stack (Prometheus, Grafana)
```

### Security Architecture
- **Zero-Trust Networking:** All player-server communication via Tailscale
- **SLSA Level 3 Compliance:** Signed provenance, hermetic builds, immutable artifacts
- **Shift-Left Security:** Pre-commit hooks, CI scanning, deployment gates
- **Secrets Management:** Quarterly rotation, encrypted storage, no code commits
- **SBOM Generation:** CycloneDX format, linked to vulnerability management

### DORA Elite Metrics Targets

| Metric | Elite Threshold | Rune Forge Target |
|--------|----------------|-------------------|
| **Deployment Frequency** | Multiple/day | On merge to `main` |
| **Lead Time for Changes** | < 1 hour | < 45 minutes |
| **Change Failure Rate** | 0-15% | < 5% |
| **Mean Time to Restore** | < 1 hour | < 15 minutes |

## Implementation Status

### Phase 1: Foundation (Weeks 1-2) ✅
- [x] CI/CD pipeline design
- [x] Docker architecture
- [x] Observability stack design
- [ ] Implementation pending

### Phase 2: Authentication & Networking (Weeks 3-4) 📋
- [ ] Tailscale deployment
- [ ] Pocket ID integration
- [ ] Session management

### Phase 3: Multiplayer Foundation (Weeks 5-6) 📋
- [ ] WebSocket protocol
- [ ] Session orchestration
- [ ] Server-authoritative simulation

### Phase 4: LiveKit Integration (Weeks 7-8) 📋
- [ ] LiveKit deployment
- [ ] Token generation service
- [ ] Client-side audio controls

### Phase 5: Production Hardening (Weeks 9-10) 📋
- [ ] Blue-green deployments
- [ ] Comprehensive monitoring
- [ ] Disaster recovery

### Phase 6: Operations & Optimization (Ongoing) 📋
- [ ] DORA metrics tracking
- [ ] Cost optimization
- [ ] Feature velocity improvements

## Next Steps

### Immediate Actions (This Week)
1. **Review Documentation:** Team review of PLATFORM_ARCHITECTURE.md
2. **Set Up CI/CD:** Push workflow to GitHub, verify pipeline runs
3. **Deploy Observability:** Start Prometheus + Grafana locally
4. **Test Docker Build:** Verify multi-stage Dockerfile builds successfully

### Short-Term Goals (Next 2 Weeks)
1. Integrate Tailscale mesh networking
2. Implement Pocket ID authentication
3. Design WebSocket protocol for multiplayer
4. Set up development environment with docker-compose

### Medium-Term Goals (Next 2 Months)
1. Full multiplayer implementation (2-8 players)
2. LiveKit voice chat integration
3. Production deployment with blue-green strategy
4. Comprehensive observability dashboards

## Resources

### Documentation
- [PLATFORM_ARCHITECTURE.md](./PLATFORM_ARCHITECTURE.md) - Full platform specification
- [QUICK_START.md](./QUICK_START.md) - Getting started guide
- [/goal.md](/goal.md) - Original game specification

### External Links
- [Tailscale Documentation](https://tailscale.com/kb/)
- [LiveKit Documentation](https://docs.livekit.io/)
- [Pocket ID Documentation](https://pocketid.app/docs/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [SLSA Framework](https://slsa.dev/)

### Tools
- [Bun Runtime](https://bun.sh/)
- [Docker](https://docs.docker.com/)
- [Prometheus](https://prometheus.io/docs/)
- [Grafana](https://grafana.com/docs/)
- [Semgrep](https://semgrep.dev/)
- [Trivy](https://aquasecurity.github.io/trivy/)

## Contributing

When implementing platform features:

1. **Follow Architecture Principles:**
   - DORA Elite metrics as success criteria
   - Security by design (shift-left, defense in depth)
   - Observability first (high-cardinality metrics)
   - Immutable infrastructure (GitOps, declarative)

2. **Update Documentation:**
   - ADRs for architectural decisions
   - Runbooks for operational procedures
   - Update implementation status in README

3. **Maintain Security Posture:**
   - Never commit secrets
   - Use environment variables
   - Rotate secrets quarterly
   - Scan dependencies continuously

## Support

- **Issues:** [GitHub Issues](https://github.com/jasonpoley/rune-forge/issues)
- **Discussions:** [GitHub Discussions](https://github.com/jasonpoley/rune-forge/discussions)
- **Documentation:** This directory (`/docs/platform/`)

---

**Questions?** Open a GitHub Discussion or create an issue with the `platform` label.
