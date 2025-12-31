# Rune Forge Multiplayer Constitution

> **Version:** 1.0 | **Ratified:** 2025-12-29 | **Last Amended:** 2025-12-29

## Core Principles

### I. Simulation Purity (NON-NEGOTIABLE)

The `@rune-forge/simulation` package MUST remain:
- **Renderer-Agnostic:** No Three.js, DOM, or browser dependencies
- **Network-Agnostic:** No WebSocket, HTTP, or network imports
- **Deterministic:** Given identical inputs, produce identical outputs
- **Pure Logic:** Combat, pathfinding, LoS, damage calculation only

**Rationale:** Enables server-authoritative multiplayer, unit testing, and future platform expansion.

### II. Server Authority (NON-NEGOTIABLE)

The server is the single source of truth for all game state:
- Clients NEVER modify `GameState` directly
- All `executeAction()` calls happen server-side only
- State deltas include monotonic version numbers for desync detection
- Clients send action requests; server validates, executes, and broadcasts results

**Rationale:** Anti-cheat, fairness, and consistent state across all clients.

### III. Message Typing (NON-NEGOTIABLE)

All WebSocket messages MUST use typed TypeScript interfaces:
- Standard envelope: `{ type, payload, seq, ts }`
- Response envelope: `{ type, payload, reqSeq, success, error }`
- Zod validation for all incoming messages
- Discriminated unions for type-safe message handling

**Rationale:** Prevents runtime errors, enables compile-time checks, improves debugging.

### IV. Graceful Degradation

Handle failures without crashes or data loss:
- Disconnect: 30-second grace period for reconnection
- Desync: Automatic full state sync on version mismatch
- LiveKit failure: Game continues without voice (not blocked)
- Database error: Queue writes, retry with backoff

**Rationale:** Multiplayer games must tolerate network instability.

### V. Security by Default

All inputs are hostile until validated:
- JWT validation on every WebSocket connection
- Zod schema validation on every message
- Rate limiting on all client-initiated operations
- Input sanitization for chat and character data
- Tailscale encryption for all network traffic

**Rationale:** Server-authoritative architecture requires robust input handling.

### VI. Observability First

Production debugging requires visibility:
- Structured JSON logging with correlation IDs
- OpenTelemetry metrics for performance tracking
- Complete event logs for session replay/audit
- Health endpoints for monitoring

**Rationale:** Cannot debug what you cannot see.

## Technology Constraints

### Required Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Bun | Performance, native TypeScript, WebSocket support |
| Networking | Tailscale | Zero-trust, NAT traversal, encryption |
| Real-time | WebSockets | Full-duplex, low overhead, Bun-native |
| Audio/Video | LiveKit | SFU architecture, browser SDK, self-hostable |
| Auth | Pocket ID | OIDC + WebAuthn passkeys |
| DB (dev) | SQLite | Simple, file-based, no setup |
| DB (prod) | PostgreSQL | Scalable, relational, managed options |

### Forbidden Patterns

1. **Client-side game state mutation** - All state comes from server
2. **Direct database queries in route handlers** - Use repository pattern
3. **Hardcoded secrets** - Environment variables only
4. **Synchronous blocking in WebSocket handlers** - Use async/await
5. **Polling for state updates** - Use WebSocket push only

## Development Workflow

### Git Flow

- `main` - Production-ready code
- `develop` - Integration branch
- `feature/*` - Individual features
- `fix/*` - Bug fixes
- `multiplayer` - Current feature branch

### Quality Gates

1. **Pre-commit:** ESLint, TypeScript compile
2. **CI Pipeline:** Unit tests, integration tests, security scans
3. **Pre-merge:** All checks green, code review approved
4. **Pre-deploy:** E2E tests, security audit (critical/high blocked)

### Testing Requirements

| Test Type | Scope | Coverage Target |
|-----------|-------|-----------------|
| Unit | Simulation package | >80% |
| Integration | WebSocket protocol | All message types |
| E2E | Critical paths | Login, join game, combat round |
| Load | WebSocket server | 8 concurrent players × 10 sessions |

## Architecture Decision Record Summary

| ADR | Decision | Status |
|-----|----------|--------|
| ADR-001 | Tailscale for secure networking | Accepted |
| ADR-002 | LiveKit for audio/video | Accepted |
| ADR-003 | Server-authoritative game state | Accepted (Non-Negotiable) |
| ADR-004 | WebSocket with typed envelope | Accepted |
| ADR-005 | Delta state synchronization | Accepted |
| ADR-006 | Character ownership split (client persona, server progression) | Accepted |

## Governance

1. **Constitution Supremacy:** This document supersedes all other practices
2. **Amendment Process:** Requires documentation, team review, migration plan
3. **ADR Updates:** New architectural decisions require formal ADR with review triggers
4. **Violation Handling:** Code violating principles fails CI or blocked in review

## Package Structure

```
packages/
├── simulation/          # UNCHANGED - pure game logic
│   └── src/
│       ├── types.ts
│       ├── combat.ts
│       ├── pathfinding.ts
│       └── line-of-sight.ts
│
├── server/              # Enhanced for multiplayer
│   └── src/
│       ├── index.ts
│       ├── config.ts
│       ├── auth/        # Pocket ID OIDC
│       ├── ws/          # WebSocket handler
│       ├── game/        # Session, executor, sync
│       ├── livekit/     # Token generation
│       └── db/          # Database operations
│
└── client/              # Enhanced for multiplayer
    └── src/
        ├── network/     # WebSocket client
        ├── auth/        # Login flow
        ├── character/   # Creator, storage
        ├── lobby/       # Game creation/join
        └── livekit/     # Audio/video UI
```

## Operational Standards

### CI/CD Targets (DORA Elite)

- **Deployment Frequency:** On merge to main
- **Lead Time:** < 45 minutes
- **Change Failure Rate:** < 5%
- **Mean Time to Restore:** < 15 minutes

### Security Requirements

- SLSA Level 3 compliance (signed builds, attestations)
- SBOM generation for all releases
- Container scanning (Trivy) blocks on critical/high
- Secret rotation quarterly (JWT keys, API secrets)

### Monitoring

- P1 Alerts: Server down, auth unavailable (page immediately)
- P2 Alerts: High latency >100ms, error rate >5%
- P3 Alerts: Capacity warnings, slow queries
- P4 Alerts: Non-critical anomalies
