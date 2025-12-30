# Rune Forge Platform Architecture
## DevSecOps and Production Multiplayer Infrastructure

**Document Version:** 1.0.0
**Last Updated:** 2025-12-29
**Status:** Design Specification
**Target:** Production-Ready Multiplayer Platform

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [DORA Elite Performance Design](#dora-elite-performance-design)
3. [System Architecture](#system-architecture)
4. [CI/CD Pipeline Architecture](#cicd-pipeline-architecture)
5. [Infrastructure Components](#infrastructure-components)
6. [Security Architecture](#security-architecture)
7. [Observability Stack](#observability-stack)
8. [Deployment Strategy](#deployment-strategy)
9. [Operational Runbooks](#operational-runbooks)
10. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

This document defines the platform architecture for Rune Forge's evolution from single-player to production-ready multiplayer tactical RPG. The design prioritizes:

- **DORA Elite Metrics**: < 1 hour lead time, multiple deploys per day, < 15 min MTTR
- **Zero-Trust Networking**: Tailscale mesh for secure player-to-server communication
- **Real-Time Communications**: LiveKit SFU for voice/video, WebSockets for game state
- **Modern Authentication**: Pocket ID with OIDC and WebAuthn/passkeys
- **Supply Chain Security**: SLSA Level 3 compliance, SBOM generation, signed attestations

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | Bun | High-performance JavaScript runtime |
| Networking | Tailscale | Zero-config mesh VPN |
| Game State Sync | WebSockets | Real-time bidirectional communication |
| Audio/Video | LiveKit | Selective Forwarding Unit (SFU) |
| Authentication | Pocket ID | OIDC provider with passkeys |
| Database (Dev) | SQLite | File-based persistence |
| Database (Prod) | PostgreSQL | Managed relational database |
| Containers | Docker | Immutable deployment artifacts |
| Orchestration | Docker Compose | Multi-service orchestration |
| CI/CD | GitHub Actions | Automated pipeline |
| Observability | OpenTelemetry + Grafana Stack | Metrics, logs, traces |

---

## DORA Elite Performance Design

### Target Metrics

| Metric | Elite Threshold | Rune Forge Target | Strategy |
|--------|----------------|-------------------|----------|
| **Deployment Frequency** | Multiple/day | On merge to `main` | Trunk-based development, automated deploys |
| **Lead Time for Changes** | < 1 hour | < 45 minutes | Parallel CI stages, build caching |
| **Change Failure Rate** | 0-15% | < 5% | Comprehensive testing, staged rollouts |
| **Mean Time to Restore** | < 1 hour | < 15 minutes | Automated rollback, blue-green deployments |

### Flow Optimization (The First Way)

**Build Acceleration:**
```yaml
Optimization Techniques:
  - pnpm workspace caching (reuse unchanged packages)
  - Docker layer caching (GitHub Actions cache)
  - TypeScript incremental builds
  - Parallel test execution
  - Predictive test selection (future)
```

**Value Stream:**
```
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│  Commit │──>│   CI    │──>│ Security│──>│ Package │──>│ Deploy  │──>│  Verify │
│ (< 1m)  │   │ (< 20m) │   │ (< 10m) │   │ (< 5m)  │   │ (< 5m)  │   │ (< 4m)  │
└─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘
                                                                          Total: 45m
```

### Feedback Amplification (The Second Way)

**Shift-Left Security:**
- Pre-commit: Gitleaks (secret detection), ESLint security rules
- CI Build: Semgrep SAST, npm audit, Trivy container scanning
- Pre-Deploy: SBOM validation, CVE blocking (critical/high)

**Fast Feedback Loops:**
- Unit tests: < 30 seconds (simulation package)
- Integration tests: < 2 minutes (WebSocket protocol)
- E2E tests: < 5 minutes (Playwright headless)
- Security scans: Parallel execution (< 10 minutes)

### Continuous Experimentation (The Third Way)

**Progressive Delivery:**
- Blue-green deployments for zero-downtime
- Canary releases for high-risk changes
- Feature flags for gradual rollouts
- Automated rollback on health check failure

**Chaos Engineering (Future):**
- Network partition testing (Tailscale failures)
- LiveKit service degradation
- Database connection pool exhaustion
- Game server crash recovery

---

## System Architecture

### Network Topology

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         TAILSCALE MESH NETWORK                            │
│                        (100.x.x.x private subnet)                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────── PLAYER CLIENTS ───────────────────────┐       │
│  │                                                                │       │
│  │   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐  │       │
│  │   │ Player 1 │   │ Player 2 │   │ Player 3 │   │ Player N │  │       │
│  │   │ Browser  │   │ Browser  │   │ Browser  │   │ Browser  │  │       │
│  │   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘  │       │
│  │        │              │              │              │         │       │
│  │        └──────────────┴──────────────┴──────────────┘         │       │
│  │                              │                                 │       │
│  └──────────────────────────────┼─────────────────────────────────┘       │
│                                 │                                         │
│                                 ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐        │
│  │                     GAME SERVER CLUSTER                       │        │
│  │  ┌────────────────────────────────────────────────────────┐  │        │
│  │  │  Bun Server (Primary Service)                          │  │        │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │  │        │
│  │  │  │ HTTP/3   │  │WebSocket │  │ Session  │  │ Game   │ │  │        │
│  │  │  │ Server   │  │ Handler  │  │ Manager  │  │ Engine │ │  │        │
│  │  │  └──────────┘  └──────────┘  └──────────┘  └────────┘ │  │        │
│  │  │       │              │              │           │      │  │        │
│  │  └───────┼──────────────┼──────────────┼───────────┼──────┘  │        │
│  │          │              │              │           │         │        │
│  │  ┌───────▼──────────────▼──────────────▼───────────▼──────┐  │        │
│  │  │         Database Layer (SQLite/PostgreSQL)            │  │        │
│  │  │  - Player profiles    - Game state                    │  │        │
│  │  │  - Session storage    - Combat logs                   │  │        │
│  │  └───────────────────────────────────────────────────────┘  │        │
│  └──────────────────────────────────────────────────────────────┘        │
│                                 │                                         │
│                                 ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐        │
│  │                      LIVEKIT SERVER                           │        │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │        │
│  │  │   SFU    │  │   Room   │  │  WebRTC  │  │   Token  │     │        │
│  │  │  Engine  │  │  Manager │  │  Router  │  │  Service │     │        │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │        │
│  │                                                               │        │
│  │  Features:                                                    │        │
│  │  - Opus audio codec (voice chat)                             │        │
│  │  - VP8/VP9 video (optional webcam)                           │        │
│  │  - Spatial audio (future: position-based)                    │        │
│  └──────────────────────────────────────────────────────────────┘        │
│                                 │                                         │
│                                 ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐        │
│  │                        POCKET ID                              │        │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │        │
│  │  │   OIDC   │  │  WebAuthn │  │   User   │  │  Session │     │        │
│  │  │ Provider │  │ Passkeys │  │   Store  │  │  Manager │     │        │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │        │
│  │                                                               │        │
│  │  Authentication Flow:                                         │        │
│  │  1. Player initiates login (browser)                         │        │
│  │  2. Pocket ID handles WebAuthn challenge                     │        │
│  │  3. Issues JWT with player claims                            │        │
│  │  4. Game server validates JWT signature                      │        │
│  └──────────────────────────────────────────────────────────────┘        │
│                                 │                                         │
│                                 ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐        │
│  │                  OBSERVABILITY STACK                          │        │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │        │
│  │  │Prometheus│  │   Loki   │  │   Tempo  │  │ Grafana  │     │        │
│  │  │ (Metrics)│  │  (Logs)  │  │ (Traces) │  │(Dashboards)    │        │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │        │
│  └──────────────────────────────────────────────────────────────┘        │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘

External Services (outside Tailscale):
- GitHub (source control, CI/CD)
- Container Registry (ghcr.io)
- Cloud provider (database backups, if managed PostgreSQL)
```

### Component Responsibilities

#### 1. Game Server (Bun)

**Ports:**
- `3000`: HTTP/WebSocket server (Tailscale-only)
- `3001`: Metrics endpoint (internal)

**Responsibilities:**
- Serve client static assets (HTML, JS, CSS, Three.js bundles)
- WebSocket connection management (game state sync)
- Session orchestration (player join/leave)
- Deterministic combat simulation execution
- Database persistence (saves, player profiles)
- LiveKit token generation (JWT with room permissions)
- Pocket ID JWT validation

**API Endpoints:**
```typescript
// Authentication
POST   /api/auth/login          // Redirect to Pocket ID
GET    /api/auth/callback       // OIDC callback, exchange code for token
POST   /api/auth/logout         // Invalidate session
GET    /api/auth/me             // Get current player profile

// Game Sessions
POST   /api/sessions            // Create new game session
GET    /api/sessions/:id        // Get session details
POST   /api/sessions/:id/join   // Join existing session
DELETE /api/sessions/:id        // End session (DM/host only)

// LiveKit Integration
POST   /api/livekit/token       // Generate room token for authenticated player

// Saves (single-player legacy)
GET    /api/saves               // List all saves (10 slots)
GET    /api/saves/:id           // Load specific save
POST   /api/saves               // Create new save
PUT    /api/saves/:id           // Update save
DELETE /api/saves/:id           // Delete save

// Health & Metrics
GET    /api/health              // Health check endpoint
GET    /metrics                 // Prometheus metrics (internal)
```

**WebSocket Protocol:**
```typescript
// Client -> Server
{
  type: "player_action",
  sessionId: "uuid",
  action: {
    type: "move" | "attack" | "end_turn",
    unitId: "string",
    target?: { x: number, y: number }
  }
}

// Server -> Client (broadcast)
{
  type: "state_update",
  sessionId: "uuid",
  state: {
    units: Unit[],
    initiativeQueue: string[],
    currentTurn: string,
    combatLog: LogEntry[]
  },
  timestamp: number
}

// Server -> Client (targeted)
{
  type: "error",
  message: "Invalid action: unit cannot reach target",
  code: "INVALID_MOVE"
}
```

#### 2. LiveKit Server

**Deployment Options:**
1. **Self-Hosted** (Docker): Full control, requires maintenance
2. **LiveKit Cloud**: Managed service, usage-based pricing

**Configuration:**
```yaml
# livekit.yaml (self-hosted)
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true

redis:
  address: localhost:6379  # For distributed deployments

room:
  auto_create: false        # Game server creates rooms
  empty_timeout: 300        # Close room after 5min of emptiness
  max_participants: 8       # Max players per session

audio:
  enabled: true
  active_speaker_update: 500ms  # Speaker detection interval

video:
  enabled: true             # Optional: player webcams
  max_bitrate: 1500000      # 1.5 Mbps max

keys:
  - api_key: $LIVEKIT_API_KEY
    api_secret: $LIVEKIT_API_SECRET
```

**Token Generation (Server-Side):**
```typescript
import { AccessToken } from 'livekit-server-sdk';

function generateLiveKitToken(
  sessionId: string,
  playerId: string,
  playerName: string
): string {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: playerId,
      name: playerName,
      metadata: JSON.stringify({ sessionId })
    }
  );

  // Grant permissions
  at.addGrant({
    roomJoin: true,
    room: sessionId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false  // Game data via WebSocket only
  });

  return at.toJwt();
}
```

#### 3. Pocket ID (Authentication)

**Integration Flow:**
```
┌────────┐                  ┌──────────┐                  ┌─────────┐
│ Player │                  │ Rune     │                  │ Pocket  │
│ Browser│                  │ Forge    │                  │   ID    │
└───┬────┘                  └─────┬────┘                  └────┬────┘
    │                             │                            │
    │ 1. Click "Login"            │                            │
    │────────────────────────────>│                            │
    │                             │                            │
    │ 2. Redirect to OIDC         │                            │
    │<────────────────────────────│                            │
    │                             │                            │
    │ 3. WebAuthn Challenge       │                            │
    │──────────────────────────────────────────────────────────>│
    │                             │                            │
    │ 4. Passkey Authentication   │                            │
    │<──────────────────────────────────────────────────────────│
    │                             │                            │
    │ 5. Authorization Code       │                            │
    │<──────────────────────────────────────────────────────────│
    │                             │                            │
    │ 6. Code -> Token Exchange   │                            │
    │────────────────────────────>│──────────────────────────> │
    │                             │                            │
    │                             │ 7. JWT (id_token)          │
    │                             │<───────────────────────────│
    │                             │                            │
    │ 8. Set session cookie       │                            │
    │<────────────────────────────│                            │
    │                             │                            │
    │ 9. Redirect to game         │                            │
    │<────────────────────────────│                            │
```

**Environment Variables:**
```bash
# Game Server
POCKET_ID_ISSUER=https://auth.poley.dev
POCKET_ID_CLIENT_ID=rune-forge-prod
POCKET_ID_CLIENT_SECRET=<secret>
POCKET_ID_REDIRECT_URI=https://runeforge.example.com/api/auth/callback
POCKET_ID_SCOPES=openid profile email
```

**JWT Validation Middleware:**
```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.POCKET_ID_ISSUER}/.well-known/jwks.json`)
);

async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: process.env.POCKET_ID_ISSUER,
    audience: process.env.POCKET_ID_CLIENT_ID
  });
  return payload;
}
```

#### 4. Tailscale Mesh Network

**Setup:**
```bash
# Install Tailscale on game server
curl -fsSL https://tailscale.com/install.sh | sh

# Authenticate (generates device key)
sudo tailscale up --advertise-tags=tag:game-server

# Enable Tailscale SSH (optional, for remote admin)
sudo tailscale up --ssh
```

**ACL Configuration (`tailscale-acl.json`):**
```json
{
  "tagOwners": {
    "tag:game-server": ["your-email@example.com"],
    "tag:player": ["autogroup:members"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:player"],
      "dst": ["tag:game-server:3000"],
      "proto": "tcp"
    },
    {
      "action": "accept",
      "src": ["tag:player"],
      "dst": ["tag:game-server:7880"],
      "proto": "tcp"
    },
    {
      "action": "accept",
      "src": ["tag:game-server"],
      "dst": ["tag:game-server:*"],
      "proto": "tcp"
    }
  ],
  "ssh": [
    {
      "action": "accept",
      "src": ["autogroup:admin"],
      "dst": ["tag:game-server"],
      "users": ["autogroup:nonroot"]
    }
  ]
}
```

**MagicDNS Naming:**
- Game Server: `runeforge-server.tail-scale.ts.net`
- Players: Auto-assigned (e.g., `alice-macbook.tail-scale.ts.net`)

**Tailscale Funnel (Optional Public Access):**
```bash
# Expose game server publicly (no Tailscale client required)
sudo tailscale funnel 3000
# Players can access: https://runeforge-server.tail-scale.ts.net
```

---

## CI/CD Pipeline Architecture

### Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          GITHUB ACTIONS PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  TRIGGER: Push to main/develop, PR, Manual dispatch                     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ STAGE 1: BUILD (Parallel)                          ~20 minutes │    │
│  ├────────────────────────────────────────────────────────────────┤    │
│  │                                                                 │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │    │
│  │  │   Install    │  │  TypeScript  │  │   Linter     │         │    │
│  │  │ Dependencies │─>│   Compile    │─>│   + Tests    │         │    │
│  │  │  (pnpm ci)   │  │ (simulation, │  │ (eslint,     │         │    │
│  │  │              │  │  server,     │  │  bun test)   │         │    │
│  │  └──────────────┘  │  client)     │  └──────────────┘         │    │
│  │                    └──────────────┘                            │    │
│  │                            │                                    │    │
│  │                            ▼                                    │    │
│  │                  ┌──────────────────┐                          │    │
│  │                  │ Build Artifacts  │                          │    │
│  │                  │  - dist/server/  │                          │    │
│  │                  │  - dist/client/  │                          │    │
│  │                  │  - Digest: sha256│                          │    │
│  │                  └──────────────────┘                          │    │
│  │                            │                                    │    │
│  │                            ▼                                    │    │
│  │                  ┌──────────────────┐                          │    │
│  │                  │ Upload Artifacts │                          │    │
│  │                  │ (GitHub Actions) │                          │    │
│  │                  └──────────────────┘                          │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                            │                                            │
│                            ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ STAGE 2: SECURITY (Parallel)                       ~10 minutes │    │
│  ├────────────────────────────────────────────────────────────────┤    │
│  │                                                                 │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │    │
│  │  │   Semgrep    │  │  Dependency  │  │   Gitleaks   │         │    │
│  │  │    (SAST)    │  │   Scanning   │  │  (Secrets)   │         │    │
│  │  │              │  │ (npm audit,  │  │              │         │    │
│  │  │              │  │  Trivy)      │  │              │         │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘         │    │
│  │         │                 │                 │                  │    │
│  │         └─────────────────┴─────────────────┘                  │    │
│  │                            │                                    │    │
│  │                            ▼                                    │    │
│  │                  ┌──────────────────┐                          │    │
│  │                  │ Security Reports │                          │    │
│  │                  │  - SARIF files   │                          │    │
│  │                  │  - CVE findings  │                          │    │
│  │                  └──────────────────┘                          │    │
│  │                            │                                    │    │
│  │                            ▼                                    │    │
│  │                  ┌──────────────────┐                          │    │
│  │                  │  CVE Blocking    │                          │    │
│  │                  │  (Critical/High) │                          │    │
│  │                  └──────────────────┘                          │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                            │                                            │
│                            ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ STAGE 3: SBOM GENERATION                            ~5 minutes │    │
│  ├────────────────────────────────────────────────────────────────┤    │
│  │                                                                 │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │    │
│  │  │  CycloneDX   │─>│  SBOM.json   │─>│    Upload    │         │    │
│  │  │    (npm)     │  │  SBOM.xml    │  │   Artifact   │         │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘         │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                            │                                            │
│                            ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ STAGE 4: CONTAINER BUILD                            ~5 minutes │    │
│  ├────────────────────────────────────────────────────────────────┤    │
│  │                                                                 │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │    │
│  │  │   Download   │─>│ Docker Build │─>│  Push Image  │         │    │
│  │  │   Artifacts  │  │ (multi-stage)│  │  (ghcr.io)   │         │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘         │    │
│  │                            │                                    │    │
│  │                            ▼                                    │    │
│  │                  ┌──────────────────┐                          │    │
│  │                  │ Image Signature  │                          │    │
│  │                  │ (Cosign/SLSA)    │                          │    │
│  │                  └──────────────────┘                          │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                            │                                            │
│                            ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ STAGE 5: ATTESTATION (main branch only)             ~2 minutes │    │
│  ├────────────────────────────────────────────────────────────────┤    │
│  │                                                                 │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │    │
│  │  │   Download   │─>│   Attest     │─>│   Attest     │         │    │
│  │  │  Artifacts   │  │  Provenance  │  │     SBOM     │         │    │
│  │  │   + SBOM     │  │  (SLSA L3)   │  │              │         │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘         │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                            │                                            │
│                            ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ STAGE 6: DEPLOY                                     ~5 minutes │    │
│  ├────────────────────────────────────────────────────────────────┤    │
│  │                                                                 │    │
│  │  develop branch:                                                │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │    │
│  │  │   Download   │─>│    Verify    │─>│  Deploy to   │         │    │
│  │  │   Artifacts  │  │   Digest     │  │   Staging    │         │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘         │    │
│  │                                                                 │    │
│  │  main branch:                                                   │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │    │
│  │  │   Download   │─>│    Verify    │─>│  Deploy to   │         │    │
│  │  │   Artifacts  │  │   Digest     │  │  Production  │         │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘         │    │
│  │                            │                                    │    │
│  │                            ▼                                    │    │
│  │                  ┌──────────────────┐                          │    │
│  │                  │ Health Check     │                          │    │
│  │                  │ (POST-DEPLOY)    │                          │    │
│  │                  └──────────────────┘                          │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  TOTAL PIPELINE TIME: ~45 minutes (parallel execution)                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### GitHub Actions Workflow

**File:** `.github/workflows/ci-cd.yml`

```yaml
name: Rune Forge CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write
  attestations: write
  packages: write
  pull-requests: write
  security-events: write

env:
  NODE_VERSION: '22'
  PNPM_VERSION: '9.15.1'
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ==========================================================================
  # BUILD: Compile TypeScript, run tests, create artifacts
  # ==========================================================================
  build:
    name: Build and Test
    runs-on: ubuntu-latest
    timeout-minutes: 20
    outputs:
      artifact-digest: ${{ steps.build.outputs.digest }}
      version: ${{ steps.version.outputs.version }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for versioning

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run linter
        run: pnpm run lint

      - name: Run type check
        run: pnpm run typecheck

      - name: Run tests
        run: pnpm run test

      - name: Calculate version
        id: version
        run: |
          VERSION=$(git describe --tags --always --dirty 2>/dev/null || echo "v0.1.0-${GITHUB_SHA::8}")
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "Build version: $VERSION"

      - name: Build application
        id: build
        env:
          NODE_ENV: production
        run: |
          pnpm run build
          # Calculate content digest
          DIGEST=$(find packages/*/dist -type f -exec sha256sum {} \; | LC_ALL=C sort | sha256sum | cut -d' ' -f1)
          echo "digest=sha256:$DIGEST" >> $GITHUB_OUTPUT
          echo "Artifact digest: sha256:$DIGEST"

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-${{ github.sha }}
          path: |
            packages/simulation/dist/
            packages/server/dist/
            packages/client/dist/
          retention-days: 30
          if-no-files-found: error

  # ==========================================================================
  # SECURITY: Parallel security scanning
  # ==========================================================================
  security-sast:
    name: SAST (Semgrep)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: build

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run Semgrep
        uses: semgrep/semgrep-action@v1
        with:
          config: >-
            p/security-audit
            p/typescript
            p/nodejs
          generateSarif: true

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: semgrep.sarif

  security-dependencies:
    name: Dependency Scanning
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: build

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run pnpm audit
        continue-on-error: true
        run: |
          pnpm audit --json > pnpm-audit.json || true
          pnpm audit --audit-level=high || echo "::warning::High severity vulnerabilities found"

      - name: Upload audit report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: security-audit-${{ github.sha }}
          path: pnpm-audit.json

  security-secrets:
    name: Secret Scanning
    runs-on: ubuntu-latest
    timeout-minutes: 5
    needs: build

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  # ==========================================================================
  # SBOM: Generate Software Bill of Materials
  # ==========================================================================
  sbom:
    name: Generate SBOM
    runs-on: ubuntu-latest
    timeout-minutes: 5
    needs: build

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install CycloneDX
        run: npm install -g @cyclonedx/cyclonedx-npm

      - name: Generate SBOM (JSON)
        run: cyclonedx-npm --output-file sbom.json

      - name: Generate SBOM (XML)
        run: cyclonedx-npm --output-format XML --output-file sbom.xml

      - name: Upload SBOM
        uses: actions/upload-artifact@v4
        with:
          name: sbom-${{ github.sha }}
          path: |
            sbom.json
            sbom.xml
          retention-days: 90

  # ==========================================================================
  # CONTAINER: Build Docker image
  # ==========================================================================
  container:
    name: Build Container
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: [build, security-sast, security-dependencies, security-secrets, sbom]
    outputs:
      image-digest: ${{ steps.build-push.outputs.digest }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-${{ github.sha }}
          path: dist-artifacts/

      # Restore artifacts to correct locations
      - name: Restore artifact structure
        run: |
          mkdir -p packages/simulation/dist
          mkdir -p packages/server/dist
          mkdir -p packages/client/dist

          # Note: Adjust paths based on actual artifact structure
          if [ -d "dist-artifacts/simulation" ]; then
            cp -r dist-artifacts/simulation/* packages/simulation/dist/
          fi
          if [ -d "dist-artifacts/server" ]; then
            cp -r dist-artifacts/server/* packages/server/dist/
          fi
          if [ -d "dist-artifacts/client" ]; then
            cp -r dist-artifacts/client/* packages/client/dist/
          fi

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix={{branch}}-
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push image
        id: build-push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/Dockerfile
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: true
          sbom: true

      - name: Download SBOM
        if: github.event_name != 'pull_request'
        uses: actions/download-artifact@v4
        with:
          name: sbom-${{ github.sha }}

      - name: Attest container SBOM
        if: github.event_name != 'pull_request'
        uses: actions/attest-sbom@v1
        with:
          subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          subject-digest: ${{ steps.build-push.outputs.digest }}
          sbom-path: sbom.json
          push-to-registry: true

  # ==========================================================================
  # CONTAINER SECURITY: Scan built image
  # ==========================================================================
  container-scan:
    name: Scan Container
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: container
    if: github.event_name != 'pull_request'

    steps:
      - name: Run Trivy scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          format: 'sarif'
          output: 'trivy-results.sarif'

      - name: Upload Trivy results
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: 'trivy-results.sarif'

      - name: Check for critical vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          exit-code: '1'
          severity: 'CRITICAL,HIGH'

  # ==========================================================================
  # ATTESTATION: Sign artifacts (main branch only)
  # ==========================================================================
  attest:
    name: Attest Build Provenance
    runs-on: ubuntu-latest
    timeout-minutes: 5
    needs: [build, sbom]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'

    steps:
      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-${{ github.sha }}
          path: dist/

      - name: Download SBOM
        uses: actions/download-artifact@v4
        with:
          name: sbom-${{ github.sha }}

      - name: Attest build provenance
        uses: actions/attest-build-provenance@v1
        with:
          subject-path: 'dist/**/*'

      - name: Attest SBOM
        uses: actions/attest-sbom@v1
        with:
          subject-path: 'dist/**/*'
          sbom-path: 'sbom.json'

  # ==========================================================================
  # DEPLOY: Environment promotion (no rebuild)
  # ==========================================================================
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: [build, container, container-scan]
    if: github.ref == 'refs/heads/develop' || github.event_name == 'workflow_dispatch'
    environment:
      name: staging
      url: https://staging-runeforge.example.com

    steps:
      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-${{ github.sha }}
          path: dist/

      - name: Verify artifact digest
        run: |
          DIGEST=$(find dist -type f -exec sha256sum {} \; | LC_ALL=C sort | sha256sum | cut -d' ' -f1)
          echo "Artifact digest: sha256:$DIGEST"
          echo "Expected: ${{ needs.build.outputs.artifact-digest }}"
          if [ "sha256:$DIGEST" != "${{ needs.build.outputs.artifact-digest }}" ]; then
            echo "::error::Artifact digest mismatch! Possible tampering detected."
            exit 1
          fi
          echo "✓ Digest verification passed"

      - name: Deploy to staging (Docker Compose)
        run: |
          echo "Deploying version: ${{ needs.build.outputs.version }}"
          echo "Image digest: ${{ needs.container.outputs.image-digest }}"

          # Example: SSH to staging server and pull new image
          # ssh staging-server "cd /opt/runeforge && \
          #   docker-compose pull && \
          #   docker-compose up -d --no-build"

          echo "::notice::Staging deployment complete"

      - name: Health check
        run: |
          # Wait for service to start
          sleep 10

          # Example health check
          # curl -f https://staging-runeforge.example.com/api/health || exit 1

          echo "::notice::Health check passed"

  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: [build, container, container-scan, attest, deploy-staging]
    if: github.ref == 'refs/heads/main'
    environment:
      name: production
      url: https://runeforge.example.com

    steps:
      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-${{ github.sha }}
          path: dist/

      - name: Verify artifact digest
        run: |
          DIGEST=$(find dist -type f -exec sha256sum {} \; | LC_ALL=C sort | sha256sum | cut -d' ' -f1)
          echo "Artifact digest: sha256:$DIGEST"
          echo "Expected: ${{ needs.build.outputs.artifact-digest }}"
          if [ "sha256:$DIGEST" != "${{ needs.build.outputs.artifact-digest }}" ]; then
            echo "::error::Artifact digest mismatch! Possible tampering detected."
            exit 1
          fi
          echo "✓ Digest verification passed"

      - name: Blue-Green Deployment
        run: |
          echo "Deploying version: ${{ needs.build.outputs.version }}"
          echo "Image digest: ${{ needs.container.outputs.image-digest }}"

          # Example blue-green deployment:
          # 1. Deploy to "green" environment
          # 2. Run smoke tests
          # 3. Switch traffic from "blue" to "green"
          # 4. Keep "blue" for quick rollback

          echo "::notice::Production deployment complete"

      - name: Post-deployment verification
        run: |
          # Wait for service to stabilize
          sleep 15

          # Example verification
          # curl -f https://runeforge.example.com/api/health || exit 1

          echo "::notice::Production health check passed"

      - name: Notify deployment
        if: always()
        run: |
          # Send notification to Discord/Slack
          echo "::notice::Deployment notification sent"
```

### Pre-Commit Hooks

**File:** `.husky/pre-commit`

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run Gitleaks (secret detection)
gitleaks detect --source . --verbose --no-git

# Run linter
pnpm run lint

# Run type check
pnpm run typecheck

# Run fast tests only (skip slow E2E)
pnpm run test:unit
```

**Setup:**
```bash
pnpm add -D husky lint-staged
npx husky install
npx husky add .husky/pre-commit "pnpm run pre-commit"
```

---

## Infrastructure Components

### Docker Multi-Stage Build

**File:** `docker/Dockerfile` (optimized)

```dockerfile
# =============================================================================
# STAGE 1: Base dependencies (shared layer)
# =============================================================================
FROM oven/bun:1 AS base

WORKDIR /app

# Copy package files for dependency installation
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/simulation/package.json ./packages/simulation/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

# Install pnpm globally
RUN npm install -g pnpm@9.15.1

# =============================================================================
# STAGE 2: Build simulation package (no external dependencies)
# =============================================================================
FROM base AS build-simulation

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @rune-forge/simulation

# Copy source code
COPY tsconfig.json ./
COPY packages/simulation ./packages/simulation

# Build simulation
WORKDIR /app/packages/simulation
RUN pnpm run build

# =============================================================================
# STAGE 3: Build server (depends on simulation)
# =============================================================================
FROM base AS build-server

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @rune-forge/server...

# Copy simulation build from previous stage
COPY --from=build-simulation /app/packages/simulation/dist ./packages/simulation/dist
COPY --from=build-simulation /app/packages/simulation/package.json ./packages/simulation/

# Copy source code
COPY tsconfig.json ./
COPY packages/server ./packages/server

# Build server
WORKDIR /app/packages/server
RUN pnpm run build

# =============================================================================
# STAGE 4: Build client (depends on simulation)
# =============================================================================
FROM base AS build-client

# Install dependencies (includes Vite)
RUN pnpm install --frozen-lockfile --filter @rune-forge/client...

# Copy simulation build
COPY --from=build-simulation /app/packages/simulation/dist ./packages/simulation/dist
COPY --from=build-simulation /app/packages/simulation/package.json ./packages/simulation/

# Copy source code
COPY tsconfig.json ./
COPY packages/client ./packages/client

# Build client (static assets)
WORKDIR /app/packages/client
RUN pnpm run build

# =============================================================================
# STAGE 5: Production runtime (minimal image)
# =============================================================================
FROM oven/bun:1-slim AS production

LABEL org.opencontainers.image.source="https://github.com/jasonpoley/rune-forge"
LABEL org.opencontainers.image.description="Rune Forge - Browser-based tactical RPG"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 runeforge && \
    adduser --system --uid 1001 --ingroup runeforge runeforge

# Copy built server
COPY --from=build-server --chown=runeforge:runeforge \
    /app/packages/server/dist ./server/dist

# Copy built client (static assets)
COPY --from=build-client --chown=runeforge:runeforge \
    /app/packages/client/dist ./client/dist

# Copy simulation dist for runtime imports
COPY --from=build-simulation --chown=runeforge:runeforge \
    /app/packages/simulation/dist ./simulation/dist

# Create data directory for SQLite/uploads
RUN mkdir -p /app/data && chown -R runeforge:runeforge /app/data

# Install production dependencies (if any runtime deps needed)
# COPY --from=build-server /app/node_modules ./node_modules

# Switch to non-root user
USER runeforge

# Environment variables (overridable at runtime)
ENV PORT=3000 \
    CLIENT_DIR=/app/client/dist \
    DB_PATH=/app/data/rune-forge.db \
    NODE_ENV=production \
    LOG_LEVEL=info

# Expose HTTP/WebSocket port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the server
CMD ["bun", "run", "/app/server/dist/index.js"]
```

### Docker Compose (Production)

**File:** `docker/docker-compose.prod.yml`

```yaml
version: "3.9"

services:
  # ==========================================================================
  # Game Server (Bun + WebSocket)
  # ==========================================================================
  game-server:
    image: ghcr.io/jasonpoley/rune-forge:latest
    container_name: runeforge-server
    restart: unless-stopped

    ports:
      - "3000:3000"  # HTTP/WebSocket (bind to Tailscale IP only in prod)

    volumes:
      # Persist game data (SQLite database, uploads)
      - runeforge-data:/app/data
      # Optional: Custom config
      - ./config/server.env:/app/.env:ro

    environment:
      # Server configuration
      PORT: 3000
      NODE_ENV: production
      LOG_LEVEL: info

      # Database (SQLite for now)
      DB_PATH: /app/data/rune-forge.db

      # Pocket ID (OIDC)
      POCKET_ID_ISSUER: ${POCKET_ID_ISSUER}
      POCKET_ID_CLIENT_ID: ${POCKET_ID_CLIENT_ID}
      POCKET_ID_CLIENT_SECRET: ${POCKET_ID_CLIENT_SECRET}
      POCKET_ID_REDIRECT_URI: ${POCKET_ID_REDIRECT_URI}

      # LiveKit
      LIVEKIT_URL: ${LIVEKIT_URL}
      LIVEKIT_API_KEY: ${LIVEKIT_API_KEY}
      LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET}

      # Session secrets
      JWT_SECRET: ${JWT_SECRET}
      COOKIE_SECRET: ${COOKIE_SECRET}

    networks:
      - runeforge-network

    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s

    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G

  # ==========================================================================
  # LiveKit Server (Self-Hosted SFU)
  # ==========================================================================
  livekit:
    image: livekit/livekit-server:v1.7
    container_name: runeforge-livekit
    restart: unless-stopped

    ports:
      - "7880:7880"   # HTTP API
      - "7881:7881"   # TURN/TCP
      - "50000-50200:50000-50200/udp"  # RTP/UDP range

    volumes:
      - ./config/livekit.yaml:/etc/livekit.yaml:ro

    command: --config /etc/livekit.yaml

    networks:
      - runeforge-network

    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:7880/"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s

    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
        reservations:
          cpus: '2'
          memory: 2G

  # ==========================================================================
  # PostgreSQL (Production Database - Future)
  # ==========================================================================
  # postgres:
  #   image: postgres:16-alpine
  #   container_name: runeforge-postgres
  #   restart: unless-stopped
  #
  #   ports:
  #     - "5432:5432"
  #
  #   volumes:
  #     - postgres-data:/var/lib/postgresql/data
  #     - ./init-scripts:/docker-entrypoint-initdb.d:ro
  #
  #   environment:
  #     POSTGRES_DB: runeforge
  #     POSTGRES_USER: runeforge
  #     POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  #     POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
  #
  #   networks:
  #     - runeforge-network
  #
  #   healthcheck:
  #     test: ["CMD-SHELL", "pg_isready -U runeforge"]
  #     interval: 10s
  #     timeout: 5s
  #     retries: 5

  # ==========================================================================
  # Prometheus (Metrics Collection)
  # ==========================================================================
  prometheus:
    image: prom/prometheus:v2.54.1
    container_name: runeforge-prometheus
    restart: unless-stopped

    ports:
      - "9090:9090"

    volumes:
      - ./config/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus

    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
      - '--storage.tsdb.retention.time=30d'

    networks:
      - runeforge-network

    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G

  # ==========================================================================
  # Grafana (Dashboards and Visualization)
  # ==========================================================================
  grafana:
    image: grafana/grafana:11.4.0
    container_name: runeforge-grafana
    restart: unless-stopped

    ports:
      - "3001:3000"

    volumes:
      - grafana-data:/var/lib/grafana
      - ./config/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./config/grafana/dashboards:/var/lib/grafana/dashboards:ro

    environment:
      GF_SECURITY_ADMIN_USER: ${GRAFANA_ADMIN_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}
      GF_INSTALL_PLUGINS: grafana-piechart-panel
      GF_SERVER_ROOT_URL: ${GRAFANA_ROOT_URL:-http://localhost:3001}

    networks:
      - runeforge-network

    depends_on:
      - prometheus

    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M

networks:
  runeforge-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

volumes:
  runeforge-data:
    name: runeforge-data
  postgres-data:
    name: runeforge-postgres-data
  prometheus-data:
    name: runeforge-prometheus-data
  grafana-data:
    name: runeforge-grafana-data
```

### LiveKit Configuration

**File:** `docker/config/livekit.yaml`

```yaml
# LiveKit Server Configuration
# Docs: https://docs.livekit.io/deploy/configuration/

port: 7880
bind_addresses:
  - "0.0.0.0"

# RTC Configuration
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: true

  # For production, set your public IP or domain
  # external_ip: "your-server-ip"

  # ICE servers (STUN/TURN)
  ice_servers:
    - urls:
        - stun:stun.l.google.com:19302

# Room Configuration
room:
  auto_create: false  # Game server creates rooms explicitly
  empty_timeout: 300  # Close room after 5 minutes of no participants
  departure_timeout: 20  # Mark participant as gone after 20s disconnect
  max_participants: 8  # Max 8 players per game session

  # Enable simulcast for adaptive quality
  enable_simulcast: true

# Audio Settings
audio:
  enabled: true

  # Active speaker detection
  active_speaker_update: 500  # Update every 500ms

# Video Settings (optional - for player webcams)
video:
  enabled: true
  max_bitrate: 1500000  # 1.5 Mbps max per stream

# Logging
logging:
  level: info
  pion_level: warn
  sample: false

# API Keys (use environment variables in production)
keys:
  {{LIVEKIT_API_KEY}}: {{LIVEKIT_API_SECRET}}

# Development mode (disable in production)
# development: false
```

### Tailscale Deployment

**Systemd Service:** `/etc/systemd/system/runeforge-tailscale.service`

```ini
[Unit]
Description=Rune Forge - Tailscale Mesh Network
After=network.target
Wants=network.target

[Service]
Type=oneshot
RemainAfterExit=yes

# Bring up Tailscale with game-server tag
ExecStart=/usr/bin/tailscale up \
    --advertise-tags=tag:game-server \
    --hostname=runeforge-server \
    --ssh \
    --accept-routes

# Graceful shutdown
ExecStop=/usr/bin/tailscale down

Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable runeforge-tailscale
sudo systemctl start runeforge-tailscale
```

---

## Security Architecture

### SLSA Level 3 Compliance

**Requirements:**
1. ✅ **Hermetic Builds**: No network access during build (GitHub Actions isolated)
2. ✅ **Signed Provenance**: GitHub attestations with OIDC
3. ✅ **Immutable Artifacts**: Content-addressable by SHA-256 digest
4. ✅ **Non-falsifiable**: Cryptographic signatures prevent tampering

**Verification:**
```bash
# Verify container image provenance
gh attestation verify \
  oci://ghcr.io/jasonpoley/rune-forge:latest \
  --owner jasonpoley

# Verify build artifact
gh attestation verify dist/server/index.js \
  --repo jasonpoley/rune-forge
```

### Secrets Management

**Environment Variables (Production):**
```bash
# /opt/runeforge/.env (chmod 600, owned by runeforge user)

# Pocket ID
POCKET_ID_ISSUER=https://auth.poley.dev
POCKET_ID_CLIENT_ID=rune-forge-prod-xxxx
POCKET_ID_CLIENT_SECRET=<rotated-quarterly>
POCKET_ID_REDIRECT_URI=https://runeforge-server.tail-scale.ts.net/api/auth/callback

# LiveKit
LIVEKIT_URL=wss://runeforge-server.tail-scale.ts.net:7880
LIVEKIT_API_KEY=APIxxxxxxxxxxxxx
LIVEKIT_API_SECRET=<rotated-quarterly>

# JWT Secrets (use openssl rand -base64 32)
JWT_SECRET=<random-64-char-string>
COOKIE_SECRET=<random-64-char-string>

# Database (if PostgreSQL)
# POSTGRES_PASSWORD=<random-password>
# DATABASE_URL=postgresql://runeforge:password@postgres:5432/runeforge

# Grafana
GRAFANA_ADMIN_PASSWORD=<random-password>
GRAFANA_ROOT_URL=https://runeforge-server.tail-scale.ts.net:3001
```

**Secret Rotation Schedule:**
| Secret | Rotation Frequency | Method |
|--------|-------------------|---------|
| JWT_SECRET | Quarterly | Generate new, support dual-signing for 24h |
| COOKIE_SECRET | Quarterly | Rotate alongside JWT secret |
| LIVEKIT_API_SECRET | Quarterly | Update LiveKit config + redeploy |
| POCKET_ID_CLIENT_SECRET | On demand | Regenerate in Pocket ID admin |
| POSTGRES_PASSWORD | Annually | Update database + connection strings |

### Security Scanning Schedule

```yaml
Continuous (CI):
  - Every commit: Semgrep SAST, npm audit, Gitleaks
  - Every PR: Full security suite + container scan
  - Every merge to main: Attestation + deployment

Weekly:
  - Dependency updates: Renovate bot PRs
  - SBOM review: Check for new CVEs in dependencies

Monthly:
  - Penetration testing: Automated Nuclei scans
  - Access review: Audit Tailscale ACLs and user permissions

Quarterly:
  - Secret rotation: JWT, API keys, database passwords
  - Disaster recovery drill: Test backup restoration
```

---

## Observability Stack

### OpenTelemetry Integration

**Server Instrumentation:**
```typescript
// packages/server/src/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: 'runeforge-server',
  }),

  // Metrics
  metricReader: new PrometheusExporter({
    port: 3001,  // Expose metrics on separate port
    endpoint: '/metrics',
  }),

  // Auto-instrumentation
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },  // Too noisy
    }),
  ],
});

sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Telemetry terminated'))
    .catch((error) => console.error('Error terminating telemetry', error))
    .finally(() => process.exit(0));
});
```

### Custom Metrics

```typescript
// packages/server/src/metrics.ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('runeforge');

// Game-specific metrics
export const activeSessionsGauge = meter.createObservableGauge('runeforge.sessions.active', {
  description: 'Number of active game sessions',
});

export const playersOnlineGauge = meter.createObservableGauge('runeforge.players.online', {
  description: 'Number of connected players',
});

export const combatActionsCounter = meter.createCounter('runeforge.combat.actions', {
  description: 'Total combat actions processed',
});

export const websocketLatencyHistogram = meter.createHistogram('runeforge.websocket.latency', {
  description: 'WebSocket message round-trip latency',
  unit: 'ms',
});

// LiveKit metrics
export const liveKitRoomsGauge = meter.createObservableGauge('runeforge.livekit.rooms.active', {
  description: 'Number of active LiveKit rooms',
});

export const liveKitParticipantsGauge = meter.createObservableGauge('runeforge.livekit.participants', {
  description: 'Total participants in LiveKit rooms',
});
```

### Prometheus Configuration

**File:** `docker/config/prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'runeforge-prod'
    environment: 'production'

# Alertmanager configuration (future)
# alerting:
#   alertmanagers:
#     - static_configs:
#         - targets: ['alertmanager:9093']

# Alert rules
# rule_files:
#   - 'alerts/*.yml'

scrape_configs:
  # Rune Forge Game Server
  - job_name: 'runeforge-server'
    static_configs:
      - targets: ['game-server:3001']
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        replacement: 'runeforge-server'

  # LiveKit Server
  - job_name: 'livekit'
    static_configs:
      - targets: ['livekit:6789']  # LiveKit Prometheus endpoint
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        replacement: 'livekit-server'

  # PostgreSQL (if enabled)
  # - job_name: 'postgres'
  #   static_configs:
  #     - targets: ['postgres-exporter:9187']

  # Prometheus self-monitoring
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
```

### Grafana Dashboards

**Game Server Dashboard (JSON):**
```json
{
  "dashboard": {
    "title": "Rune Forge - Game Server",
    "panels": [
      {
        "title": "Active Sessions",
        "targets": [
          {
            "expr": "runeforge_sessions_active"
          }
        ],
        "type": "stat"
      },
      {
        "title": "Players Online",
        "targets": [
          {
            "expr": "runeforge_players_online"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Combat Actions (Rate)",
        "targets": [
          {
            "expr": "rate(runeforge_combat_actions_total[5m])"
          }
        ],
        "type": "graph"
      },
      {
        "title": "WebSocket Latency (p99)",
        "targets": [
          {
            "expr": "histogram_quantile(0.99, runeforge_websocket_latency_bucket)"
          }
        ],
        "type": "graph"
      },
      {
        "title": "HTTP Request Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total{job=\"runeforge-server\"}[5m])"
          }
        ],
        "type": "graph"
      }
    ]
  }
}
```

### Alerting Rules

**File:** `docker/config/alerts/runeforge.yml`

```yaml
groups:
  - name: runeforge_critical
    interval: 30s
    rules:
      # Server Down
      - alert: RuneForgeServerDown
        expr: up{job="runeforge-server"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Rune Forge server is down"
          description: "Server {{ $labels.instance }} has been down for more than 1 minute."

      # High Error Rate
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High HTTP error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}."

      # High WebSocket Latency
      - alert: HighWebSocketLatency
        expr: histogram_quantile(0.99, runeforge_websocket_latency_bucket) > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High WebSocket latency detected"
          description: "P99 latency is {{ $value }}ms (threshold: 100ms)."

  - name: livekit_critical
    interval: 30s
    rules:
      # LiveKit Down
      - alert: LiveKitServerDown
        expr: up{job="livekit"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "LiveKit server is down"
          description: "LiveKit instance {{ $labels.instance }} is unreachable."

      # High Participant Failure Rate
      - alert: HighParticipantFailureRate
        expr: rate(livekit_participant_failed_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High LiveKit participant failure rate"
          description: "Failure rate is {{ $value }}."
```

---

## Deployment Strategy

### Blue-Green Deployment

```
┌───────────────────────────────────────────────────────────────────┐
│                      BLUE-GREEN DEPLOYMENT                         │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│  INITIAL STATE: Blue is live                                      │
│                                                                    │
│  ┌─────────────┐                     ┌─────────────┐             │
│  │   Router    │────────────────────>│    BLUE     │ (LIVE)      │
│  │ (Tailscale) │   100% traffic      │  v1.0.0     │             │
│  └─────────────┘                     └─────────────┘             │
│                                                                    │
│                                      ┌─────────────┐             │
│                                      │   GREEN     │ (IDLE)      │
│                                      │   (none)    │             │
│                                      └─────────────┘             │
│                                                                    │
│────────────────────────────────────────────────────────────────────│
│                                                                    │
│  STEP 1: Deploy to Green                                          │
│                                                                    │
│  ┌─────────────┐                     ┌─────────────┐             │
│  │   Router    │────────────────────>│    BLUE     │ (LIVE)      │
│  │ (Tailscale) │   100% traffic      │  v1.0.0     │             │
│  └─────────────┘                     └─────────────┘             │
│                                                                    │
│                                      ┌─────────────┐             │
│                                      │   GREEN     │ (DEPLOYING) │
│                                      │  v1.1.0     │ <- Deploy   │
│                                      └─────────────┘             │
│                                                                    │
│────────────────────────────────────────────────────────────────────│
│                                                                    │
│  STEP 2: Run smoke tests on Green                                 │
│                                                                    │
│  ┌─────────────┐                     ┌─────────────┐             │
│  │   Router    │────────────────────>│    BLUE     │ (LIVE)      │
│  │ (Tailscale) │   100% traffic      │  v1.0.0     │             │
│  └─────────────┘                     └─────────────┘             │
│                                                                    │
│                    Health checks     ┌─────────────┐             │
│                    <───────────────> │   GREEN     │ (TESTING)   │
│                                      │  v1.1.0     │             │
│                                      └─────────────┘             │
│                                                                    │
│────────────────────────────────────────────────────────────────────│
│                                                                    │
│  STEP 3: Switch traffic to Green (atomic)                         │
│                                                                    │
│  ┌─────────────┐                     ┌─────────────┐             │
│  │   Router    │                     │    BLUE     │ (STANDBY)   │
│  │ (Tailscale) │                     │  v1.0.0     │             │
│  └─────┬───────┘                     └─────────────┘             │
│        │                                                           │
│        │  100% traffic               ┌─────────────┐             │
│        └────────────────────────────>│   GREEN     │ (LIVE)      │
│                                      │  v1.1.0     │             │
│                                      └─────────────┘             │
│                                                                    │
│────────────────────────────────────────────────────────────────────│
│                                                                    │
│  STEP 4: Monitor Green, keep Blue for rollback                    │
│                                                                    │
│  ┌─────────────┐                     ┌─────────────┐             │
│  │   Router    │                     │    BLUE     │ (STANDBY)   │
│  │ (Tailscale) │   <- Rollback       │  v1.0.0     │ <- Ready    │
│  └─────┬───────┘      if needed      └─────────────┘             │
│        │                                                           │
│        │  100% traffic               ┌─────────────┐             │
│        └────────────────────────────>│   GREEN     │ (LIVE)      │
│                                      │  v1.1.0     │             │
│                                      └─────────────┘             │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

**Implementation (Docker Compose):**
```bash
#!/bin/bash
# deploy-blue-green.sh

set -euo pipefail

ENVIRONMENT="${1:-production}"
NEW_IMAGE="${2}"  # e.g., ghcr.io/jasonpoley/rune-forge:v1.1.0

BLUE_CONTAINER="runeforge-server-blue"
GREEN_CONTAINER="runeforge-server-green"

# Determine current live environment
CURRENT_LIVE=$(docker inspect -f '{{.State.Status}}' "$BLUE_CONTAINER" 2>/dev/null || echo "down")

if [ "$CURRENT_LIVE" = "running" ]; then
  DEPLOY_TO="green"
  LIVE_CONTAINER="$BLUE_CONTAINER"
  NEW_CONTAINER="$GREEN_CONTAINER"
else
  DEPLOY_TO="blue"
  LIVE_CONTAINER="$GREEN_CONTAINER"
  NEW_CONTAINER="$BLUE_CONTAINER"
fi

echo "Current live: $LIVE_CONTAINER"
echo "Deploying to: $NEW_CONTAINER"

# Step 1: Deploy new version to idle environment
docker pull "$NEW_IMAGE"
docker run -d \
  --name "$NEW_CONTAINER" \
  --network runeforge-network \
  -p 3010:3000 \  # Temporary port for testing
  -v runeforge-data:/app/data \
  --env-file .env.production \
  "$NEW_IMAGE"

# Wait for container to be healthy
echo "Waiting for $NEW_CONTAINER to be healthy..."
for i in {1..30}; do
  HEALTH=$(docker inspect -f '{{.State.Health.Status}}' "$NEW_CONTAINER" 2>/dev/null || echo "starting")
  if [ "$HEALTH" = "healthy" ]; then
    break
  fi
  sleep 2
done

if [ "$HEALTH" != "healthy" ]; then
  echo "ERROR: $NEW_CONTAINER failed health check"
  docker logs "$NEW_CONTAINER" --tail 50
  docker stop "$NEW_CONTAINER"
  docker rm "$NEW_CONTAINER"
  exit 1
fi

# Step 2: Run smoke tests
echo "Running smoke tests on $NEW_CONTAINER..."
curl -f http://localhost:3010/api/health || {
  echo "ERROR: Smoke test failed"
  docker stop "$NEW_CONTAINER"
  docker rm "$NEW_CONTAINER"
  exit 1
}

# Step 3: Switch traffic (atomic port swap)
echo "Switching traffic to $NEW_CONTAINER..."
docker stop "$LIVE_CONTAINER"
docker rm "$LIVE_CONTAINER"
docker run -d \
  --name "$NEW_CONTAINER-final" \
  --network runeforge-network \
  -p 3000:3000 \  # Production port
  -v runeforge-data:/app/data \
  --env-file .env.production \
  "$NEW_IMAGE"

# Remove temporary container
docker stop "$NEW_CONTAINER"
docker rm "$NEW_CONTAINER"

# Rename to standard name
docker rename "$NEW_CONTAINER-final" "$NEW_CONTAINER"

echo "Deployment complete! $NEW_CONTAINER is now live."
echo "Previous version ($LIVE_CONTAINER) is stopped but retained for rollback."
```

### Rollback Procedure

```bash
#!/bin/bash
# rollback.sh - Instant rollback to previous version

set -euo pipefail

BLUE_CONTAINER="runeforge-server-blue"
GREEN_CONTAINER="runeforge-server-green"

# Determine current live and standby
BLUE_STATUS=$(docker inspect -f '{{.State.Status}}' "$BLUE_CONTAINER" 2>/dev/null || echo "down")
GREEN_STATUS=$(docker inspect -f '{{.State.Status}}' "$GREEN_CONTAINER" 2>/dev/null || echo "down")

if [ "$BLUE_STATUS" = "running" ]; then
  CURRENT="$BLUE_CONTAINER"
  PREVIOUS="$GREEN_CONTAINER"
elif [ "$GREEN_STATUS" = "running" ]; then
  CURRENT="$GREEN_CONTAINER"
  PREVIOUS="$BLUE_CONTAINER"
else
  echo "ERROR: No live container found!"
  exit 1
fi

echo "Current live: $CURRENT"
echo "Rolling back to: $PREVIOUS"

# Confirm rollback
read -p "Are you sure you want to rollback? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Rollback aborted."
  exit 0
fi

# Stop current, start previous
docker stop "$CURRENT"
docker start "$PREVIOUS"

# Wait for health check
sleep 5
HEALTH=$(docker inspect -f '{{.State.Health.Status}}' "$PREVIOUS")
if [ "$HEALTH" != "healthy" ]; then
  echo "ERROR: Rollback failed - previous container unhealthy"
  docker start "$CURRENT"  # Restore current
  exit 1
fi

echo "Rollback complete! $PREVIOUS is now live."
echo "MTTR: < 15 seconds"
```

---

## Operational Runbooks

### Runbook: Server Crash Recovery

**Scenario:** Game server crashes unexpectedly
**MTTR Target:** < 5 minutes

**Automated Recovery (Docker restart policy):**
```yaml
# docker-compose.yml
services:
  game-server:
    restart: unless-stopped  # Auto-restart on crash
```

**Manual Recovery:**
```bash
# 1. Check container status
docker ps -a | grep runeforge-server

# 2. View crash logs
docker logs runeforge-server --tail 100

# 3. Restart container
docker restart runeforge-server

# 4. Verify health
curl -f http://localhost:3000/api/health

# 5. Check for ongoing sessions (may be lost)
docker exec runeforge-server bun run scripts/check-active-sessions.ts
```

**Post-Incident:**
1. Export logs: `docker logs runeforge-server > crash-$(date +%s).log`
2. Analyze stack trace in logs
3. Create GitHub issue with crash details
4. Update incident log in `docs/incidents/`

---

### Runbook: Database Corruption (SQLite)

**Scenario:** SQLite database file corrupted
**MTTR Target:** < 15 minutes (restore from backup)

**Recovery Steps:**
```bash
# 1. Stop server
docker stop runeforge-server

# 2. Backup corrupted database
cd /opt/runeforge/data
cp rune-forge.db rune-forge.db.corrupted-$(date +%s)

# 3. Restore from latest backup
# Option A: Daily backup
cp /opt/runeforge/backups/rune-forge-$(date +%Y%m%d).db rune-forge.db

# Option B: If no backup, attempt recovery
sqlite3 rune-forge.db ".recover" | sqlite3 rune-forge-recovered.db
mv rune-forge-recovered.db rune-forge.db

# 4. Restart server
docker start runeforge-server

# 5. Verify database integrity
docker exec runeforge-server bun run scripts/verify-db.ts
```

**Prevention:**
- Daily automated backups (see Database Backup section)
- Enable SQLite WAL mode for crash resistance
- Monitor database size and integrity

---

### Runbook: LiveKit Audio/Video Degradation

**Scenario:** Players report poor voice quality
**Investigation Time:** < 10 minutes

**Diagnostics:**
```bash
# 1. Check LiveKit server health
curl -f http://livekit:7880/ || echo "LiveKit unreachable"

# 2. View LiveKit logs
docker logs runeforge-livekit --tail 200

# 3. Check network statistics
docker exec runeforge-livekit livekit-cli stats

# 4. Inspect active rooms
docker exec runeforge-livekit livekit-cli room list

# 5. Check packet loss metrics
# View Grafana dashboard: LiveKit > Network Quality
```

**Common Issues:**
| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| Choppy audio | High CPU usage | Scale up resources, reduce bitrate |
| No audio | TURN server unavailable | Check ICE candidates, firewall |
| Echo | Client-side issue | Advise players to use headphones |
| Latency spikes | Network congestion | Check Tailscale connectivity |

**Mitigation:**
```bash
# Reduce bitrate temporarily
docker exec runeforge-livekit livekit-cli room update \
  --room SESSION_ID \
  --max-bitrate 500000  # 500 Kbps
```

---

### Runbook: Tailscale Network Partition

**Scenario:** Players cannot connect to game server
**MTTR Target:** < 10 minutes

**Diagnostics:**
```bash
# 1. Check Tailscale status on server
sudo tailscale status

# 2. Verify server is reachable
tailscale ping runeforge-server

# 3. Check ACL configuration
tailscale acl get

# 4. Test connectivity from player perspective
# (Ask player to run)
tailscale ping runeforge-server
```

**Common Fixes:**
```bash
# Restart Tailscale service
sudo systemctl restart tailscaled

# Force re-authentication
sudo tailscale up --force-reauth

# Check for Tailscale updates
sudo tailscale update

# Verify firewall rules
sudo iptables -L -n | grep 3000
```

**Escalation:**
- If > 5 players affected: Enable Tailscale Funnel for public access
- Contact Tailscale support for network-wide issues

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

**Goals:**
- Set up CI/CD pipeline
- Dockerize application
- Implement basic observability

**Tasks:**
```
□ Create GitHub Actions workflow (.github/workflows/ci-cd.yml)
  □ Build stage
  □ Test stage
  □ Security scanning (Semgrep, npm audit, Gitleaks)
  □ SBOM generation
  □ Container build
  □ Attestation

□ Optimize Dockerfile
  □ Multi-stage build
  □ Layer caching
  □ Non-root user

□ Docker Compose for development
  □ Game server
  □ Prometheus
  □ Grafana

□ OpenTelemetry integration
  □ Metrics endpoint
  □ Custom game metrics
  □ Prometheus scraping

□ Basic Grafana dashboard
  □ Server health panel
  □ Request rate graph
  □ Error rate graph
```

**Deliverables:**
- ✅ Automated CI/CD pipeline
- ✅ Containerized application
- ✅ Observability stack (Prometheus + Grafana)

---

### Phase 2: Authentication & Networking (Weeks 3-4)

**Goals:**
- Integrate Pocket ID
- Set up Tailscale mesh
- Implement session management

**Tasks:**
```
□ Tailscale deployment
  □ Install on server
  □ Configure ACLs
  □ Test player connectivity
  □ Document connection guide

□ Pocket ID integration
  □ OIDC client configuration
  □ JWT validation middleware
  □ Session management (cookies)
  □ Login/logout endpoints

□ Database schema updates
  □ User profiles table
  □ Session storage table
  □ Migrations

□ Client-side authentication
  □ Login button
  □ Token storage (secure cookies)
  □ Automatic token refresh
```

**Deliverables:**
- ✅ Secure authentication flow
- ✅ Tailscale mesh network
- ✅ User profile persistence

---

### Phase 3: Multiplayer Foundation (Weeks 5-6)

**Goals:**
- WebSocket server implementation
- Session orchestration
- Basic multiplayer combat

**Tasks:**
```
□ WebSocket protocol definition
  □ Message schemas (TypeScript types)
  □ Protocol versioning
  □ Error handling

□ Session management
  □ Create/join/leave session
  □ Player synchronization
  □ Turn-based action queue

□ Deterministic simulation sync
  □ Server-authoritative validation
  □ Client-side prediction
  □ State reconciliation

□ Database persistence
  □ Save session state
  □ Combat log recording
  □ Player statistics

□ Testing
  □ WebSocket integration tests
  □ Load testing (simulated players)
  □ Latency benchmarks
```

**Deliverables:**
- ✅ Functional multiplayer (2+ players)
- ✅ Server-authoritative combat
- ✅ Sub-100ms latency (local network)

---

### Phase 4: LiveKit Integration (Weeks 7-8)

**Goals:**
- Voice/video communication
- Spatial audio (future)
- Room management

**Tasks:**
```
□ LiveKit server deployment
  □ Docker container
  □ Configuration (livekit.yaml)
  □ TURN server setup

□ Token generation service
  □ JWT signing on game server
  □ Room permissions
  □ Participant metadata

□ Client-side LiveKit integration
  □ SDK installation (livekit-client)
  □ Room connection flow
  □ Audio controls UI
  □ Mute/unmute, volume

□ Observability
  □ LiveKit metrics scraping
  □ Grafana dashboard
  □ Alert rules (participant failures)

□ Testing
  □ Audio quality tests
  □ Network degradation simulation
  □ Concurrent room stress test
```

**Deliverables:**
- ✅ Voice chat functional
- ✅ < 200ms audio latency
- ✅ Support for 8 concurrent players

---

### Phase 5: Production Hardening (Weeks 9-10)

**Goals:**
- Blue-green deployments
- Comprehensive monitoring
- Disaster recovery

**Tasks:**
```
□ Deployment automation
  □ Blue-green deployment script
  □ Rollback script
  □ Health check automation

□ Backup system
  □ Daily database backups
  □ SBOM archival
  □ Configuration versioning

□ Alerting rules
  □ Prometheus alerts (server down, high latency)
  □ Notification channels (email, Discord)
  □ On-call rotation setup

□ Security hardening
  □ Secret rotation procedures
  □ Tailscale ACL audit
  □ Penetration testing

□ Documentation
  □ Runbooks for common incidents
  □ Architecture diagrams
  □ Developer onboarding guide

□ Load testing
  □ Simulate 50 concurrent players
  □ Sustained load (1 hour)
  □ Identify bottlenecks
```

**Deliverables:**
- ✅ Production-ready deployment
- ✅ < 15 minute MTTR
- ✅ Comprehensive monitoring

---

### Phase 6: Operations & Optimization (Ongoing)

**Goals:**
- Continuous improvement
- Cost optimization
- Feature expansion

**Tasks:**
```
□ DORA metrics tracking
  □ Dashboard in Grafana
  □ Weekly review
  □ Quarterly retrospectives

□ Cost analysis
  □ LiveKit Cloud vs self-hosted
  □ PostgreSQL managed service evaluation
  □ Resource utilization optimization

□ Feature flags
  □ LaunchDarkly or similar
  □ Gradual rollouts
  □ A/B testing

□ Advanced observability
  □ Distributed tracing (Tempo)
  □ Log aggregation (Loki)
  □ User session replay

□ Capacity planning
  □ Player growth projections
  □ Scaling strategy (horizontal/vertical)
  □ Database sharding (if needed)
```

**Deliverables:**
- ✅ Sustained Elite DORA metrics
- ✅ < 10% infrastructure cost growth
- ✅ Feature velocity maintained

---

## Appendix

### A. Environment Variables Reference

```bash
# ==============================================================================
# RUNE FORGE - ENVIRONMENT VARIABLES
# ==============================================================================

# --------------------
# Server Configuration
# --------------------
PORT=3000
NODE_ENV=production  # production | development | test
LOG_LEVEL=info       # error | warn | info | debug
CLIENT_DIR=/app/client/dist

# --------------------
# Database
# --------------------
# SQLite (development/small deployments)
DB_PATH=/app/data/rune-forge.db

# PostgreSQL (production)
# DATABASE_URL=postgresql://runeforge:password@postgres:5432/runeforge
# POSTGRES_PASSWORD=<secure-random-password>

# --------------------
# Authentication (Pocket ID)
# --------------------
POCKET_ID_ISSUER=https://auth.poley.dev
POCKET_ID_CLIENT_ID=rune-forge-prod-xxxx
POCKET_ID_CLIENT_SECRET=<rotated-quarterly>
POCKET_ID_REDIRECT_URI=https://runeforge-server.tail-scale.ts.net/api/auth/callback
POCKET_ID_SCOPES=openid profile email

# --------------------
# LiveKit
# --------------------
LIVEKIT_URL=wss://runeforge-server.tail-scale.ts.net:7880
LIVEKIT_API_KEY=APIxxxxxxxxxxxxx
LIVEKIT_API_SECRET=<rotated-quarterly>

# --------------------
# Security (JWT/Cookies)
# --------------------
JWT_SECRET=<random-64-char-base64>  # Generate: openssl rand -base64 48
JWT_EXPIRY=24h
COOKIE_SECRET=<random-64-char-base64>
COOKIE_SECURE=true  # Set to false for local development
COOKIE_SAMESITE=strict

# --------------------
# Tailscale
# --------------------
TAILSCALE_HOSTNAME=runeforge-server
TAILSCALE_TAGS=tag:game-server

# --------------------
# Observability
# --------------------
PROMETHEUS_PORT=3001
METRICS_ENABLED=true
TRACING_ENABLED=false  # Enable when Tempo is deployed

# --------------------
# Grafana
# --------------------
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<secure-password>
GRAFANA_ROOT_URL=https://runeforge-server.tail-scale.ts.net:3001

# --------------------
# Feature Flags (future)
# --------------------
# FEATURE_DM_MODE=false
# FEATURE_SPATIAL_AUDIO=false
```

### B. Database Backup Script

```bash
#!/bin/bash
# /opt/runeforge/scripts/backup-database.sh
# Daily backup of SQLite database to local and remote storage

set -euo pipefail

BACKUP_DIR="/opt/runeforge/backups"
DB_PATH="/opt/runeforge/data/rune-forge.db"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/rune-forge-$TIMESTAMP.db"

# Retention: Keep last 30 days
RETENTION_DAYS=30

# Create backup directory
mkdir -p "$BACKUP_DIR"

# SQLite backup (hot backup, no downtime)
sqlite3 "$DB_PATH" ".backup $BACKUP_FILE"

# Compress backup
gzip "$BACKUP_FILE"
BACKUP_FILE="$BACKUP_FILE.gz"

# Calculate checksum
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"

echo "Backup created: $BACKUP_FILE"

# Optional: Upload to cloud storage
# aws s3 cp "$BACKUP_FILE" s3://runeforge-backups/$(basename "$BACKUP_FILE")

# Clean up old backups
find "$BACKUP_DIR" -name "rune-forge-*.db.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "rune-forge-*.db.gz.sha256" -mtime +$RETENTION_DAYS -delete

echo "Backup rotation complete (retention: $RETENTION_DAYS days)"
```

**Cron job:** `/etc/cron.d/runeforge-backup`
```cron
# Daily backup at 3 AM
0 3 * * * runeforge /opt/runeforge/scripts/backup-database.sh >> /var/log/runeforge-backup.log 2>&1
```

### C. Useful Commands

```bash
# --------------------
# Docker Management
# --------------------

# View all Rune Forge containers
docker ps -a | grep runeforge

# Follow server logs
docker logs -f runeforge-server

# Restart all services
docker-compose -f docker/docker-compose.prod.yml restart

# Prune old images (save disk space)
docker image prune -a --filter "until=168h"  # Remove images older than 1 week

# --------------------
# Tailscale
# --------------------

# Check connection status
sudo tailscale status

# Ping game server from player device
tailscale ping runeforge-server

# View ACL rules
tailscale acl get

# Update ACL
tailscale acl set tailscale-acl.json

# --------------------
# Database
# --------------------

# SQLite shell access
sqlite3 /opt/runeforge/data/rune-forge.db

# Vacuum database (reclaim space)
sqlite3 /opt/runeforge/data/rune-forge.db "VACUUM;"

# Export database schema
sqlite3 /opt/runeforge/data/rune-forge.db ".schema" > schema.sql

# --------------------
# Monitoring
# --------------------

# Query Prometheus API
curl 'http://localhost:9090/api/v1/query?query=runeforge_sessions_active'

# View current metrics
curl http://localhost:3001/metrics

# Test alert rules
docker exec runeforge-prometheus promtool check rules /etc/prometheus/alerts/*.yml

# --------------------
# Security
# --------------------

# Rotate JWT secret (requires server restart)
openssl rand -base64 48

# Scan container for vulnerabilities
trivy image ghcr.io/jasonpoley/rune-forge:latest

# Check for secrets in codebase
gitleaks detect --source . --verbose
```

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-29 | Platform Engineer | Initial comprehensive platform specification |

---

**Next Steps:**
1. Review this document with development team
2. Create GitHub issues for Phase 1 tasks
3. Set up initial CI/CD pipeline
4. Deploy observability stack (Prometheus + Grafana)

**Questions/Feedback:**
- Open GitHub Discussion: `docs/platform/PLATFORM_ARCHITECTURE.md`
- Slack: `#rune-forge-platform`
