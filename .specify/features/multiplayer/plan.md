# Rune Forge Multiplayer - Implementation Plan

> **Version:** 1.0 | **Created:** 2025-12-29 | **Status:** Planned
> **Workflow State:** `workflow:Planned`

## Executive Summary

This plan transforms Rune Forge from a single-player tactical combat game into a full-featured multiplayer platform supporting 2-8 players with Dungeon Master facilitation, persistent character progression, and integrated voice/video communication.

### Key Technology Decisions

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Networking** | Tailscale | Zero-trust mesh VPN, NAT traversal, encryption |
| **Real-time Sync** | WebSockets | Full-duplex, Bun-native, typed protocol |
| **Audio/Video** | LiveKit | SFU architecture, self-hostable, browser SDKs |
| **Auth** | Pocket ID | OIDC + WebAuthn passkeys |
| **Database** | SQLite (dev) / PostgreSQL (prod) | Simple development, scalable production |

### Architecture Decision Records

| ADR | Decision | Status |
|-----|----------|--------|
| ADR-001 | Tailscale for secure networking | Accepted |
| ADR-002 | LiveKit for audio/video | Accepted |
| ADR-003 | Server-authoritative game state | Accepted (Non-Negotiable) |
| ADR-004 | WebSocket with typed envelope | Accepted |
| ADR-005 | Delta state synchronization | Accepted |
| ADR-006 | Character ownership split | Accepted |

---

## Implementation Phases

### Phase 1: Foundation (Tasks 1-5, 28, 31)

**Goal:** Authentication, networking, and WebSocket infrastructure

**Deliverables:**
- Pocket ID OIDC integration with passkeys
- Tailscale network configuration
- WebSocket server with auth flow
- Database schema with migrations
- CI/CD pipeline with security scanning
- Shared message type definitions

**Tasks:**
- [task-1] Phase 1: Pocket ID OIDC Integration
- [task-2] Phase 1: Tailscale Network Setup
- [task-3] Phase 1: WebSocket Server Foundation
- [task-4] Phase 1: Database Schema Implementation
- [task-5] Phase 1: CI/CD Pipeline Setup
- [task-28] Client: Auth Flow Integration
- [task-31] Shared: WebSocket Message Types Package

**Success Criteria:**
- User can log in via Pocket ID and establish authenticated WebSocket connection
- CI/CD pipeline runs on every push with security scanning
- Database migrations work for SQLite and PostgreSQL

---

### Phase 2: Game Server Core (Tasks 6-9, 27, 29)

**Goal:** Server-side game execution and state synchronization

**Deliverables:**
- Server-side simulation execution
- Session management system
- All WebSocket message handlers
- Full and delta state synchronization
- Client-side WebSocket integration

**Tasks:**
- [task-6] Phase 2: Server-Side Simulation Integration
- [task-7] Phase 2: Session Management System
- [task-8] Phase 2: WebSocket Message Handlers
- [task-9] Phase 2: State Synchronization
- [task-27] Client: WebSocket Client Implementation
- [task-29] Client: GameController Multiplayer Refactor

**Success Criteria:**
- Single game session works with server-side logic
- Multiple clients receive synchronized state
- Desync detection and recovery works

---

### Phase 3: Multiplayer Logic (Tasks 10-14)

**Goal:** Full multiplayer turn management and DM controls

**Deliverables:**
- Multi-player turn management
- Disconnect handling and reconnection
- All DM commands
- Chat system
- Rate limiting

**Tasks:**
- [task-10] Phase 3: Multi-Player Turn Management
- [task-11] Phase 3: Disconnect Handling and Reconnection
- [task-12] Phase 3: DM Commands Implementation
- [task-13] Phase 3: Chat System
- [task-14] Phase 3: Rate Limiting

**Success Criteria:**
- Full 2-8 player + DM game works
- Disconnected players can reconnect
- DM can control game flow and grant rewards

---

### Phase 4: Character System & LiveKit (Tasks 15-19)

**Goal:** Persistent characters and voice communication

**Deliverables:**
- Offline character creator
- Server-side progression tracking
- LiveKit server deployment
- Token generation service
- Client-side voice chat UI

**Tasks:**
- [task-15] Phase 4: Offline Character Creator
- [task-16] Phase 4: Character Sync and Progression
- [task-17] Phase 4: LiveKit Server Deployment
- [task-18] Phase 4: LiveKit Token Service
- [task-19] Phase 4: LiveKit Client Integration

**Success Criteria:**
- Characters persist across sessions with XP/gold/inventory
- Voice chat works for all players in a session
- Offline-created characters sync to server

---

### Phase 5: Polish & Testing (Tasks 20-26, 30, 32-34)

**Goal:** Production readiness

**Deliverables:**
- Comprehensive error handling
- Complete lobby and game UI
- Integration and load tests
- Security audit completion
- Observability stack
- Documentation

**Tasks:**
- [task-20] Phase 5: Error Handling and Recovery
- [task-21] Phase 5: Lobby UI Implementation
- [task-22] Phase 5: Game UI Enhancements for Multiplayer
- [task-23] Phase 5: Integration Testing
- [task-24] Phase 5: Load Testing
- [task-25] Phase 5: Security Audit
- [task-26] Phase 5: Observability Stack
- [task-30] Client: Screen State Machine
- [task-32] Documentation: Player Setup Guide
- [task-33] Documentation: DM Guide
- [task-34] Documentation: Operations Runbook

**Success Criteria:**
- All tests pass with >80% coverage on simulation
- Load test supports 8 players × 10 sessions
- Security audit finds no critical/high issues
- Documentation complete for players and DMs

---

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
├── shared/              # NEW - shared types
│   └── src/
│       ├── messages.ts      # WebSocket message types
│       ├── schemas.ts       # Zod validation schemas
│       └── errors.ts        # Error codes
│
├── server/              # Enhanced for multiplayer
│   └── src/
│       ├── index.ts
│       ├── config.ts
│       ├── auth/
│       │   ├── oidc.ts      # Pocket ID integration
│       │   ├── jwt.ts       # JWT creation/validation
│       │   └── middleware.ts
│       ├── ws/
│       │   ├── handler.ts   # WebSocket manager
│       │   ├── messages.ts  # Message processing
│       │   └── rooms.ts     # Session room management
│       ├── game/
│       │   ├── session.ts   # Session lifecycle
│       │   ├── executor.ts  # Server-side action execution
│       │   ├── turns.ts     # Turn management
│       │   └── sync.ts      # State synchronization
│       ├── livekit/
│       │   ├── client.ts    # LiveKit SDK wrapper
│       │   └── tokens.ts    # Token generation
│       └── db/
│           ├── schema.ts    # Database schema
│           ├── migrations/  # Version migrations
│           ├── users.ts
│           ├── characters.ts
│           └── sessions.ts
│
└── client/              # Enhanced for multiplayer
    └── src/
        ├── main.ts
        ├── game.ts          # Modified for multiplayer
        ├── renderer.ts      # Mostly unchanged
        ├── ui.ts            # Extended UI
        ├── network/
        │   ├── websocket.ts # WebSocket client wrapper
        │   ├── sync.ts      # State sync handler
        │   └── reconnect.ts # Reconnection logic
        ├── auth/
        │   ├── login.ts     # Pocket ID flow
        │   ├── session.ts   # JWT management
        │   └── guard.ts     # Route protection
        ├── character/
        │   ├── creator.ts   # Offline character creator
        │   ├── storage.ts   # IndexedDB storage
        │   └── sync.ts      # Server sync
        ├── lobby/
        │   ├── screens.ts   # Screen management
        │   ├── create.ts    # Create game UI
        │   ├── join.ts      # Join game UI
        │   └── waiting.ts   # Waiting room
        └── livekit/
            ├── room.ts      # LiveKit room component
            └── controls.ts  # Audio controls UI
```

---

## Key Technical Specifications

### WebSocket Message Protocol

```typescript
// Standard envelope
interface WSMessage<T = unknown> {
  type: string;          // Message type identifier
  payload: T;            // Type-specific payload
  seq: number;           // Sequence number
  ts: number;            // Timestamp (ms since epoch)
}

// Response envelope
interface WSResponse<T = unknown> extends WSMessage<T> {
  reqSeq?: number;       // Original request sequence
  success: boolean;      // Operation success flag
  error?: string;        // Error message if !success
}
```

### State Synchronization

- **Full Sync:** On join, reconnect, every N rounds, on desync
- **Delta Sync:** After every state change with version tracking
- **Desync Detection:** Version mismatch triggers full sync request

### Session Lifecycle

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ CREATED │────>│  LOBBY  │────>│ PLAYING │────>│  ENDED  │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
                    │               │
                    │               ▼
                    │          ┌─────────┐
                    └─────────>│ PAUSED  │
                               └─────────┘
```

### Security Model

1. **Tailscale:** All traffic encrypted, ACL-based access control
2. **JWT:** 7-day tokens with refresh, validated on every WebSocket connection
3. **Server Authority:** Clients render, never modify state
4. **Rate Limiting:** 30 actions/min, 20 chat/min, 60 DM commands/min
5. **Input Validation:** Zod schemas for all messages

---

## Reference Documentation

- **Architecture:** `docs/architecture.md` (6 ADRs, component design)
- **Platform:** `docs/platform/PLATFORM_ARCHITECTURE.md` (CI/CD, infrastructure)
- **Constitution:** `.specify/memory/constitution.md` (core principles)
- **Original Spec:** `docs/multiplayer.md` (detailed protocol)

---

## Next Steps

1. Start with Phase 1 tasks (authentication and infrastructure)
2. Use `/flow:implement` to execute tasks in order
3. Run security scans after each phase
4. Update constitution as edge cases emerge

**Workflow State:** Ready for `/flow:implement`
