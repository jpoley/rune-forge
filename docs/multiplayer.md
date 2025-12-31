# Rune Forge Multiplayer Guide

> **Version:** 1.0
> **Last Updated:** 2024-12-30
> **Status:** Implemented

---

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 9+
- Bun runtime
- (Optional) Pocket ID instance for authentication

### Running Single-Player Mode

No configuration needed:

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Start the server
bun run packages/server/dist/index.js

# Open browser
open http://localhost:41204
```

### Running Multiplayer Mode

1. **Configure Pocket ID** (create `.env` in project root):

```bash
# Required for multiplayer
POCKET_ID_URL=https://auth.yourdomain.com
POCKET_ID_CLIENT_ID=rune-forge
POCKET_ID_CLIENT_SECRET=your-secret-here

# Optional overrides
PORT=41204
DATABASE_PATH=.data/rune-forge.db
```

2. **Start the server:**

```bash
pnpm run build
bun run packages/server/dist/index.js
```

3. **Access multiplayer mode:**

```
http://localhost:41204?mode=multi
```

### URL Parameters

| Parameter | Values | Description |
|-----------|--------|-------------|
| `mode` | `single`, `offline` | Force single-player mode |
| `mode` | `multi`, `online` | Force multiplayer mode |
| (none) | - | Defaults to single-player |

### Development Mode

```bash
# Run with hot reload
./scripts/dev.sh

# Or separately:
pnpm run dev:server   # Server on port 41204
pnpm run dev:client   # Vite dev server on port 5173 (proxies API)
```

### Testing Multiplayer Locally

To test multiplayer with multiple players on a single machine:

1. Open browser tab 1: `http://localhost:41204?mode=multi` (Player 1 / DM)
2. Log in with Pocket ID
3. Create a game → Note the join code (e.g., "ABC123")
4. Open browser tab 2 in incognito: `http://localhost:41204?mode=multi` (Player 2)
5. Log in with a different Pocket ID account
6. Enter the join code to join the game
7. Both players mark "Ready"
8. DM starts the game

### Debugging in Browser Console

When running in development mode, these objects are exposed on `window`:

```javascript
// Multiplayer mode
window.mp           // MultiplayerController instance
window.screens      // ScreenManager instance

// Single-player mode
window.game         // GameController instance

// Check current state
console.log(window.mp?.state)     // View multiplayer state
console.log(window.mp?.ws)        // View WebSocket status
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "WebSocket connection failed" | Server not running or auth not configured | Ensure server is running and Pocket ID env vars are set |
| Stuck on "Connecting..." | WebSocket upgrade failed | Check browser console for errors; verify `/ws` endpoint accessible |
| "Authentication required" | No session or expired session | Click "Login" to authenticate with Pocket ID |
| "Game not found" | Invalid join code | Verify the 6-character join code is correct |
| Can't start game | Not all players ready | All players must click "Ready" before DM can start |
| Reconnection loops | Server restarted or network issues | Refresh browser page after server restarts |

### Health Check Endpoint

```bash
# Check server status
curl http://localhost:41204/api/health

# Response
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": 1735500000000,
  "connections": 3,      # Total WebSocket connections
  "authenticated": 2     # Authenticated connections
}
```

### Disabling Authentication (Local Testing)

For local testing without Pocket ID, omit the `POCKET_ID_*` environment variables. The server will log:

```
🔐 Authentication: disabled
```

In this mode, the auth endpoints return mock data for testing the WebSocket flow.

---

## Implementation Files

### Server (`packages/server/src/`)

| File | Purpose |
|------|---------|
| `index.ts` | Main entry point, HTTP/WebSocket server |
| `auth/index.ts` | OIDC authentication routes and handlers |
| `ws/index.ts` | WebSocket connection management |
| `ws/types.ts` | WebSocket message type definitions |
| `game/index.ts` | Game message handlers |
| `game/sessions.ts` | Session management and state |
| `db/index.ts` | SQLite database initialization |
| `db/schema.ts` | Database schema definitions |

### Client (`packages/client/src/`)

| File | Purpose |
|------|---------|
| `main.ts` | Entry point with mode detection |
| `multiplayer.ts` | MultiplayerController class |
| `screens.ts` | Screen state machine for UI |
| `auth-client.ts` | Authentication API client |
| `game.ts` | Single-player GameController |
| `renderer.ts` | Three.js 3D renderer |

### Shared (`packages/shared/src/`)

| File | Purpose |
|------|---------|
| `messages.ts` | Shared WebSocket message types |

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Authentication](#authentication)
4. [WebSocket Protocol](#websocket-protocol)
5. [State Synchronization](#state-synchronization)
6. [Game Sessions](#game-sessions)
7. [Character System](#character-system)
8. [DM Privileges](#dm-privileges)
9. [Database Schema](#database-schema)
10. [Security](#security)
11. [Implementation Phases](#implementation-phases)
12. [Client Changes](#client-changes)

---

## Overview

### Goals

Transform Rune Forge from a single-player experience to a multiplayer tactical RPG supporting:

- **2-8 players** per game session
- **1 Dungeon Master (DM)** with elevated privileges
- **Real-time state synchronization** via WebSockets
- **Server-authoritative game logic** (anti-cheat)
- **Passwordless authentication** via Pocket ID (OIDC + WebAuthn)
- **Offline character creation** with server-side progression tracking
- **Secure access** via Cloudflare Tunnel

### Non-Goals (v1)

- Spectator mode (future)
- Voice/video chat (use Discord)
- Mobile native apps (PWA only)
- Cross-server play
- Ranked matchmaking

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE TUNNEL                             │
│  - SSL termination                                               │
│  - DDoS protection                                               │
│  - WAF rules                                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BUN SERVER                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    Auth     │  │   REST API  │  │  WebSocket  │              │
│  │  (Pocket ID)│  │  /api/*     │  │    /ws      │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         │                │                │                      │
│         └────────────────┼────────────────┘                      │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   GAME ENGINE                            │    │
│  │  - Session management                                    │    │
│  │  - Action validation & execution                         │    │
│  │  - State synchronization                                 │    │
│  │  - Turn management                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    DATABASE                              │    │
│  │  SQLite (dev) / PostgreSQL (prod)                        │    │
│  │  - Users, Characters, Sessions, Event Logs               │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Package Structure

```
packages/
├── simulation/          # Unchanged - pure game logic
│   └── src/
│       ├── types.ts
│       ├── combat.ts
│       ├── pathfinding.ts
│       └── ...
│
├── server/              # Enhanced - WebSocket + Auth + Game Engine
│   └── src/
│       ├── index.ts           # Entry point
│       ├── config.ts          # Environment config
│       ├── auth/
│       │   ├── oidc.ts        # Pocket ID integration
│       │   ├── jwt.ts         # JWT creation/validation
│       │   └── middleware.ts  # Auth middleware
│       ├── ws/
│       │   ├── handler.ts     # WebSocket manager
│       │   ├── messages.ts    # Message definitions
│       │   └── rooms.ts       # Game room management
│       ├── game/
│       │   ├── session.ts     # Session lifecycle
│       │   ├── executor.ts    # Server-side action execution
│       │   ├── turns.ts       # Turn management
│       │   └── sync.ts        # State synchronization
│       └── db/
│           ├── schema.ts      # Database schema
│           ├── users.ts       # User operations
│           ├── characters.ts  # Character operations
│           └── sessions.ts    # Session operations
│
└── client/              # Enhanced - Network + Auth + Lobby
    └── src/
        ├── main.ts
        ├── game.ts            # Modified for multiplayer
        ├── renderer.ts        # Mostly unchanged
        ├── ui.ts              # Extended UI
        ├── network/
        │   ├── websocket.ts   # WebSocket client
        │   ├── messages.ts    # Shared message types
        │   ├── sync.ts        # State sync handler
        │   └── reconnect.ts   # Reconnection logic
        ├── auth/
        │   ├── login.ts       # Pocket ID flow
        │   ├── session.ts     # JWT management
        │   └── guard.ts       # Route protection
        ├── character/
        │   ├── creator.ts     # Offline character creator
        │   ├── storage.ts     # IndexedDB storage
        │   └── sync.ts        # Server sync
        └── lobby/
            ├── create.ts      # Create game UI
            ├── join.ts        # Join game UI
            └── waiting.ts     # Waiting room
```

---

## Authentication

### Pocket ID Integration

Pocket ID is a self-hosted OIDC provider with passkey (WebAuthn) support. It provides passwordless authentication.

#### OIDC Flow

```
┌──────────┐                  ┌──────────┐                  ┌──────────┐
│  Client  │                  │  Server  │                  │ Pocket ID│
└────┬─────┘                  └────┬─────┘                  └────┬─────┘
     │                              │                              │
     │ 1. Click "Login"             │                              │
     │─────────────────────────────>│                              │
     │                              │                              │
     │ 2. Redirect to Pocket ID     │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
     │ 3. Authenticate (passkey)    │                              │
     │─────────────────────────────────────────────────────────────>│
     │                              │                              │
     │ 4. Redirect with auth code   │                              │
     │<─────────────────────────────────────────────────────────────│
     │                              │                              │
     │ 5. POST /auth/callback       │                              │
     │─────────────────────────────>│                              │
     │                              │ 6. Exchange code for tokens  │
     │                              │─────────────────────────────>│
     │                              │                              │
     │                              │ 7. Return tokens             │
     │                              │<─────────────────────────────│
     │                              │                              │
     │ 8. Set session JWT           │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
```

#### Configuration

```typescript
// server/src/config.ts
export const AUTH_CONFIG = {
  pocketId: {
    issuer: process.env.POCKET_ID_ISSUER,           // e.g., https://auth.poley.dev
    clientId: process.env.POCKET_ID_CLIENT_ID,
    clientSecret: process.env.POCKET_ID_CLIENT_SECRET,
    redirectUri: process.env.POCKET_ID_REDIRECT_URI, // e.g., https://runeforge.example.com/auth/callback
    scopes: ['openid', 'profile', 'email'],
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '7d',
  },
};
```

#### Session Token Structure

```typescript
interface SessionToken {
  sub: string;           // User ID from Pocket ID
  name: string;          // Display name
  email?: string;        // Optional email
  iat: number;           // Issued at timestamp
  exp: number;           // Expiration timestamp
  jti: string;           // Unique token ID (for revocation)
}
```

#### Server Endpoints

```typescript
// Auth routes
GET  /auth/login          // Redirect to Pocket ID
GET  /auth/callback       // Handle OIDC callback
POST /auth/logout         // Invalidate session
GET  /auth/me             // Get current user info
POST /auth/refresh        // Refresh JWT token
```

### Cloudflare Tunnel Setup

```yaml
# cloudflared.yml
tunnel: rune-forge
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: runeforge.example.com
    service: http://localhost:41204
  - service: http_status:404
```

---

## WebSocket Protocol

### Connection Lifecycle

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                          │
     │ 1. Connect to wss://host/ws              │
     │─────────────────────────────────────────>│
     │                                          │
     │ 2. Connection established                │
     │<─────────────────────────────────────────│
     │                                          │
     │ 3. Send auth message (JWT)               │
     │─────────────────────────────────────────>│
     │                                          │
     │ 4. auth_result (success/failure)         │
     │<─────────────────────────────────────────│
     │                                          │
     │ 5. Ready for game messages               │
     │<────────────────────────────────────────>│
     │                                          │
```

### Message Format

All messages follow a standard envelope:

```typescript
interface WSMessage<T = unknown> {
  type: string;          // Message type identifier
  payload: T;            // Type-specific payload
  seq: number;           // Sequence number (client-assigned for requests)
  ts: number;            // Timestamp (milliseconds since epoch)
}

interface WSResponse<T = unknown> extends WSMessage<T> {
  reqSeq?: number;       // Original request sequence (for responses)
  success: boolean;      // Operation success flag
  error?: string;        // Error message if !success
}
```

### Client → Server Messages

#### Authentication

```typescript
// Authenticate connection
interface AuthMessage {
  type: 'auth';
  payload: {
    token: string;       // JWT session token
  };
}
```

#### Game Session

```typescript
// Create a new game session
interface CreateGameMessage {
  type: 'create_game';
  payload: {
    characterId: string;
    config: {
      maxPlayers: number;        // 2-8
      mapSeed?: number;          // Optional, server generates if omitted
      difficulty: 'easy' | 'normal' | 'hard';
      turnTimeLimit?: number;    // Seconds, 0 = unlimited
    };
  };
}

// Join existing game
interface JoinGameMessage {
  type: 'join_game';
  payload: {
    joinCode: string;    // 6-character code
    characterId: string;
  };
}

// Leave current game
interface LeaveGameMessage {
  type: 'leave_game';
  payload: {};
}

// Mark ready in lobby
interface ReadyMessage {
  type: 'ready';
  payload: {
    ready: boolean;
  };
}
```

#### Game Actions

```typescript
// Execute a game action
interface ActionMessage {
  type: 'action';
  payload: GameAction;   // MoveAction | AttackAction | EndTurnAction | CollectLootAction
}

// Chat message
interface ChatMessage {
  type: 'chat';
  payload: {
    message: string;     // Max 500 chars
    target?: string;     // User ID for whisper, omit for broadcast
  };
}
```

#### DM Commands

```typescript
// DM-only commands
interface DMCommandMessage {
  type: 'dm_command';
  payload:
    | { command: 'start_game' }
    | { command: 'pause_game' }
    | { command: 'resume_game' }
    | { command: 'end_game' }
    | { command: 'grant_weapon'; targetUserId: string; weaponId: string }
    | { command: 'grant_gold'; targetUserId: string; amount: number }
    | { command: 'grant_xp'; targetUserId: string; amount: number }
    | { command: 'spawn_monster'; position: Position; monsterType: string }
    | { command: 'remove_monster'; unitId: string }
    | { command: 'modify_monster'; unitId: string; stats: Partial<UnitStats> }
    | { command: 'skip_turn' }
    | { command: 'kick_player'; targetUserId: string };
}
```

#### Character Sync

```typescript
// Upload character persona to server
interface CharacterSyncMessage {
  type: 'character_sync';
  payload: {
    character: CharacterPersona;
  };
}
```

#### Utility

```typescript
// Keepalive
interface PingMessage {
  type: 'ping';
  payload: {};
}
```

### Server → Client Messages

#### Authentication

```typescript
interface AuthResultMessage {
  type: 'auth_result';
  payload: {
    user: {
      id: string;
      name: string;
      email?: string;
    };
    characters: CharacterSummary[];  // User's characters
  };
}
```

#### Game Session

```typescript
// Game created successfully
interface GameCreatedMessage {
  type: 'game_created';
  payload: {
    sessionId: string;
    joinCode: string;
  };
}

// Joined game successfully
interface GameJoinedMessage {
  type: 'game_joined';
  payload: {
    session: GameSessionInfo;
  };
}

// Full game state snapshot
interface GameStateMessage {
  type: 'game_state';
  payload: {
    state: GameState;
    yourUnitId: string;      // Which unit belongs to this player
  };
}

// Incremental state update
interface StateDeltaMessage {
  type: 'state_delta';
  payload: {
    delta: StateDelta;       // Partial state changes
    version: number;         // State version for sync verification
  };
}

// Game events for animation
interface EventsMessage {
  type: 'events';
  payload: {
    events: GameEvent[];
  };
}

// Turn changed
interface TurnChangeMessage {
  type: 'turn_change';
  payload: {
    currentUnitId: string;
    currentUserId: string;   // Owner of the unit
    turnNumber: number;
    round: number;
  };
}

// Player joined lobby
interface PlayerJoinedMessage {
  type: 'player_joined';
  payload: {
    user: { id: string; name: string };
    character: CharacterSummary;
  };
}

// Player left game
interface PlayerLeftMessage {
  type: 'player_left';
  payload: {
    userId: string;
    reason: 'left' | 'kicked' | 'disconnected';
  };
}

// Player ready status changed
interface PlayerReadyMessage {
  type: 'player_ready';
  payload: {
    odId: string;
    odId: string;
    userId: string;
    ready: boolean;
  };
}

// Game ended
interface GameEndedMessage {
  type: 'game_ended';
  payload: {
    result: 'victory' | 'defeat' | 'dm_ended';
    rewards: {
      odId: string;
      odId: string;
      userId: string;
      xpGained: number;
      goldGained: number;
    }[];
  };
}
```

#### Chat

```typescript
interface ChatBroadcastMessage {
  type: 'chat';
  payload: {
    from: { id: string; name: string };
    message: string;
    isWhisper: boolean;
    timestamp: number;
  };
}
```

#### Errors

```typescript
interface ErrorMessage {
  type: 'error';
  payload: {
    code: string;        // Error code for programmatic handling
    message: string;     // Human-readable message
    reqSeq?: number;     // Original request that caused error
  };
}

// Error codes
type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'GAME_NOT_FOUND'
  | 'GAME_FULL'
  | 'GAME_ALREADY_STARTED'
  | 'NOT_YOUR_TURN'
  | 'INVALID_ACTION'
  | 'NOT_DM'
  | 'CHARACTER_NOT_FOUND'
  | 'RATE_LIMITED';
```

#### Utility

```typescript
interface PongMessage {
  type: 'pong';
  payload: {
    serverTime: number;  // Server timestamp for latency calculation
  };
}
```

---

## State Synchronization

### Sync Strategy

The server is the single source of truth. Clients receive updates but never directly modify game state.

```
┌──────────────────────────────────────────────────────────────────┐
│                        STATE FLOW                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Client A          Server              Client B                 │
│   ─────────         ──────              ─────────                │
│       │                │                    │                    │
│       │  action (move) │                    │                    │
│       │───────────────>│                    │                    │
│       │                │                    │                    │
│       │                │ validate           │                    │
│       │                │ execute            │                    │
│       │                │ update state       │                    │
│       │                │                    │                    │
│       │     events     │     events         │                    │
│       │<───────────────│───────────────────>│                    │
│       │                │                    │                    │
│       │   state_delta  │   state_delta      │                    │
│       │<───────────────│───────────────────>│                    │
│       │                │                    │                    │
│       │ apply & render │                    │ apply & render     │
│       │                │                    │                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Full State Sync

Sent on:
- Initial game join
- Reconnection after disconnect
- Every N rounds (configurable, e.g., every 10 rounds)
- On request (client detects desync)

```typescript
interface FullStateSync {
  state: GameState;
  version: number;           // Monotonic state version
  yourUnitId: string;
  players: PlayerInfo[];
}
```

### Delta State Sync

Sent after every state change. Uses JSON-like delta format:

```typescript
interface StateDelta {
  version: number;           // New version after applying delta
  previousVersion: number;   // Must match client's current version
  changes: DeltaOperation[];
}

type DeltaOperation =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'delete'; path: string }
  | { op: 'push'; path: string; value: unknown }
  | { op: 'splice'; path: string; index: number; deleteCount: number; items?: unknown[] };

// Example delta for unit movement
const moveDelta: StateDelta = {
  version: 42,
  previousVersion: 41,
  changes: [
    { op: 'set', path: 'units.0.position', value: { x: 5, y: 3 } },
    { op: 'set', path: 'combat.turnState.movementRemaining', value: 2 },
  ],
};
```

### Desync Detection

Client tracks state version. If delta's `previousVersion` doesn't match, request full sync:

```typescript
// Client-side
if (delta.previousVersion !== this.stateVersion) {
  console.warn('State desync detected, requesting full sync');
  this.ws.send({ type: 'request_full_sync', payload: {} });
}
```

### Optimistic Updates (Optional)

For better responsiveness, client can predict outcome:

```typescript
// Client-side
async function sendAction(action: GameAction) {
  // 1. Optimistically apply locally (with rollback save)
  const rollbackState = this.gameState;
  try {
    const predicted = executeAction(action, this.gameState);
    this.gameState = predicted.state;
    this.renderState();
  } catch {
    // Prediction failed, wait for server
  }

  // 2. Send to server
  const response = await this.ws.sendAndWait({ type: 'action', payload: action });

  // 3. Reconcile with server response
  if (!response.success) {
    // Rollback on failure
    this.gameState = rollbackState;
    this.renderState();
    this.showError(response.error);
  }
  // On success, server delta will arrive and overwrite prediction
}
```

---

## Game Sessions

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

### Session States

| State | Description | Transitions |
|-------|-------------|-------------|
| `lobby` | Waiting for players, configuring | → `playing` (DM starts) |
| `playing` | Active gameplay | → `paused`, `ended` |
| `paused` | Temporarily stopped | → `playing`, `ended` |
| `ended` | Game complete | Terminal |

### Session Data Model

```typescript
interface GameSession {
  id: string;                      // UUID
  joinCode: string;                // 6-char alphanumeric (e.g., "ABC123")
  dmUserId: string;                // Pocket ID of creator (DM)
  status: 'lobby' | 'playing' | 'paused' | 'ended';

  config: SessionConfig;
  players: SessionPlayer[];
  gameState: GameState | null;     // Null until started
  eventLog: GameEvent[];           // Complete history

  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

interface SessionConfig {
  maxPlayers: number;              // 2-8
  mapSeed: number;
  difficulty: 'easy' | 'normal' | 'hard';
  turnTimeLimit: number;           // 0 = unlimited
  monsterCount: number;            // Based on difficulty
  allowLateJoin: boolean;
}

interface SessionPlayer {
  odId: string;
  odId: string;
  odId: string;
  userId: string;
  characterId: string;
  unitId: string;                  // In-game unit ID
  status: 'connected' | 'disconnected' | 'spectating';
  isReady: boolean;
  joinedAt: number;
  lastSeenAt: number;
}
```

### Join Code Generation

```typescript
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 for clarity
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
```

### Turn Management

```typescript
interface TurnManager {
  sessionId: string;
  initiativeOrder: InitiativeEntry[];
  currentIndex: number;
  currentRound: number;
  turnStartedAt: number;
  turnTimeLimit: number;           // From session config

  // Methods
  startTurn(unitId: string): TurnState;
  endTurn(): { nextUnitId: string; newRound: boolean };
  skipTurn(): void;                // DM only
  handleTimeout(): void;           // Auto-end or AI takeover
  handleDisconnect(userId: string): void;
}
```

### Disconnect Handling

```typescript
// On player disconnect
function handlePlayerDisconnect(session: GameSession, odId: string): void {
  const player = session.players.find(p => p.odId === odId
  const player = session.players.find(p => p.odId === odId
  const player = session.players.find(p => p.odId === odId
  const player = session.players.find(p => p.userId === odId
  const player = session.players.find(p => p.odId === odId
  const player = session.players.find(p => p.odId === odId
  const player = session.players.find(p => p.odId === odId
  const player = session.players.find(p => p.odId === odId);
  if (!player) return;

  player.status = 'disconnected';
  player.lastSeenAt = Date.now();

  // Notify other players
  broadcastToSession(session.id, {
    type: 'player_left',
    payload: { odId
    payload: { odId
    payload: { userId, reason: 'disconnected' },
  });

  // If it's their turn, start timeout
  if (isCurrentTurn(session, odId
  if (isCurrentTurn(session, odId
  if (isCurrentTurn(session, userId)) {
    startDisconnectTimeout(session, 30000); // 30 second grace period
  }
}

// On reconnect
function handlePlayerReconnect(session: GameSession, odId: string, odId: string, ws: WebSocket): void {
  const player = session.players.find(p => p.odId === odId
  const player = session.players.find(p => p.odId === odId
  const player = session.players.find(p => p.userId === odId);
  if (!player) return;

  player.status = 'connected';
  player.lastSeenAt = Date.now();

  // Send full state sync
  ws.send({
    type: 'game_state',
    payload: {
      state: session.gameState,
      yourUnitId: player.unitId,
    },
  });

  // Notify other players
  broadcastToSession(session.id, {
    type: 'player_joined',
    payload: { odId: odId
    payload: { userId: odId, name: player.name, reconnected: true },
  });
}
```

---

## Character System

### Data Ownership Split

Characters have two parts with different ownership:

| Aspect | Owner | Editable By | Storage |
|--------|-------|-------------|---------|
| **Persona** | Player | Player anytime | Local + Server |
| **Progression** | Server | Server only | Server only |

### Character Persona (Client-Owned)

```typescript
interface CharacterPersona {
  id: string;                      // UUID, generated client-side
  name: string;                    // Character name (3-30 chars)

  class: CharacterClass;

  appearance: {
    bodyType: 'small' | 'medium' | 'large';
    skinTone: string;              // Hex color
    hairColor: string;             // Hex color
    hairStyle: 'bald' | 'short' | 'medium' | 'long' | 'ponytail';
    facialHair?: 'none' | 'stubble' | 'beard' | 'mustache';
  };

  backstory?: string;              // Optional flavor text (max 1000 chars)

  createdAt: number;
  updatedAt: number;
}

type CharacterClass = 'warrior' | 'ranger' | 'mage' | 'rogue';
```

### Character Progression (Server-Owned)

```typescript
interface CharacterProgression {
  odId: string;                     // Pocket ID user ID
  characterId: string;             // Links to persona

  // Experience & Level
  xp: number;
  level: number;                   // Derived: floor(xp / 1000) + 1

  // Currency
  gold: number;
  silver: number;

  // Derived Stats (calculated from level + class)
  stats: {
    maxHp: number;
    attack: number;
    defense: number;
    initiative: number;
    moveRange: number;
  };

  // Inventory (server-validated)
  inventory: {
    weapons: LootItem[];
    equippedWeaponId: string | null;
  };

  // Lifetime Stats
  gamesPlayed: number;
  monstersKilled: number;
  damageDealt: number;
  damageTaken: number;
  deaths: number;

  createdAt: number;
  updatedAt: number;
}
```

### Stat Calculation

```typescript
const CLASS_BASE_STATS: Record<CharacterClass, UnitStats> = {
  warrior: { maxHp: 12, attack: 4, defense: 3, initiative: 2, moveRange: 3 },
  ranger:  { maxHp: 10, attack: 3, defense: 2, initiative: 4, moveRange: 4 },
  mage:    { maxHp: 8,  attack: 5, defense: 1, initiative: 3, moveRange: 3 },
  rogue:   { maxHp: 9,  attack: 3, defense: 2, initiative: 5, moveRange: 5 },
};

const LEVEL_SCALING = {
  maxHp: 2,        // +2 HP per level
  attack: 0.5,     // +1 attack every 2 levels
  defense: 0.25,   // +1 defense every 4 levels
  initiative: 0,   // No scaling
  moveRange: 0,    // No scaling
};

function calculateStats(classType: CharacterClass, level: number): UnitStats {
  const base = CLASS_BASE_STATS[classType];
  return {
    maxHp: Math.floor(base.maxHp + (level - 1) * LEVEL_SCALING.maxHp),
    attack: Math.floor(base.attack + (level - 1) * LEVEL_SCALING.attack),
    defense: Math.floor(base.defense + (level - 1) * LEVEL_SCALING.defense),
    initiative: base.initiative,
    moveRange: base.moveRange,
  };
}
```

### Offline Character Creation

Client can create characters without server connection:

```typescript
// client/src/character/storage.ts
interface LocalCharacterStore {
  characters: CharacterPersona[];
  lastSyncedAt: number;
  pendingSync: string[];           // Character IDs not yet uploaded
}

class CharacterStorage {
  private db: IDBDatabase;

  async createCharacter(persona: Omit<CharacterPersona, 'id' | 'createdAt' | 'updatedAt'>): Promise<CharacterPersona> {
    const character: CharacterPersona = {
      ...persona,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.saveLocal(character);
    this.markPendingSync(character.id);

    return character;
  }

  async syncToServer(character: CharacterPersona): Promise<void> {
    // Upload to server when online
    await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(character),
    });

    this.removePendingSync(character.id);
  }

  async syncAllPending(): Promise<void> {
    const pending = await this.getPendingSync();
    for (const id of pending) {
      const character = await this.getLocal(id);
      if (character) {
        await this.syncToServer(character);
      }
    }
  }
}
```

### XP & Rewards

```typescript
// End of game rewards
interface GameRewards {
  odId: string;
  odId: string;
  userId: string;
  xpGained: number;
  goldGained: number;
  silverGained: number;
}

function calculateRewards(session: GameSession, odId: string, odId: string, userId: string): GameRewards {
  const player = session.players.find(p => p.odId === odId
  const player = session.players.find(p => p.userId === odId);
  const unit = session.gameState?.units.find(u => u.id === player?.unitId);

  // Base XP for participating
  let xp = 50;

  // Bonus XP for kills (from event log)
  const kills = session.eventLog.filter(
    e => e.type === 'unit_defeated' &&
         session.eventLog.some(a =>
           a.type === 'unit_attacked' &&
           a.attackerId === player?.unitId &&
           a.targetId === e.unitId
         )
  ).length;
  xp += kills * 25;

  // Victory bonus
  if (session.gameState?.combat.phase === 'victory') {
    xp += 100;
  }

  // Gold from inventory (already collected during game)
  const gold = session.gameState?.playerInventory.gold ?? 0;
  const silver = session.gameState?.playerInventory.silver ?? 0;

  return { odId
  return { userId, xpGained: xp, goldGained: gold, silverGained: silver };
}
```

---

## DM Privileges

### DM Role

The user who creates a game session is automatically the DM. DM does not play as a character but has special controls.

### DM Commands

| Command | Description | When Available |
|---------|-------------|----------------|
| `start_game` | Begin combat from lobby | Lobby only |
| `pause_game` | Pause gameplay | Playing only |
| `resume_game` | Resume from pause | Paused only |
| `end_game` | Force end game | Any state |
| `grant_weapon` | Give weapon to player | Playing |
| `grant_gold` | Give gold to player | Playing |
| `grant_xp` | Give XP to player | Playing |
| `spawn_monster` | Add monster to map | Playing |
| `remove_monster` | Remove monster | Playing |
| `modify_monster` | Change monster stats | Playing |
| `skip_turn` | Skip current turn | Playing |
| `kick_player` | Remove player | Any state |

### DM Panel (Client)

```typescript
// DM-specific UI components
interface DMPanel {
  // Session controls
  startButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  endButton: HTMLButtonElement;

  // Player management
  playerList: HTMLElement;
  kickButtons: Map<string, HTMLButtonElement>;

  // Grants
  grantWeaponSelect: HTMLSelectElement;
  grantWeaponButton: HTMLButtonElement;
  grantGoldInput: HTMLInputElement;
  grantGoldButton: HTMLButtonElement;
  grantXpInput: HTMLInputElement;
  grantXpButton: HTMLButtonElement;

  // Monster controls
  spawnMonsterButton: HTMLButtonElement;
  monsterTypeSelect: HTMLSelectElement;
  selectedMonster: string | null;
  modifyMonsterPanel: HTMLElement;

  // Turn override
  skipTurnButton: HTMLButtonElement;
}
```

### DM View

DM sees:
- All player positions (no fog of war)
- All monster HP and stats
- Turn order with timing
- Event log with full details
- Session statistics

---

## Database Schema

### SQLite Schema

```sql
-- Users (synced from Pocket ID)
CREATE TABLE users (
  id TEXT PRIMARY KEY,                    -- Pocket ID subject
  display_name TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER,

  UNIQUE(email)
);

-- Characters
CREATE TABLE characters (
  id TEXT PRIMARY KEY,                    -- UUID
  user_id TEXT NOT NULL,

  -- Persona (client-owned, synced)
  name TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('warrior', 'ranger', 'mage', 'rogue')),
  appearance TEXT NOT NULL,               -- JSON
  backstory TEXT,

  -- Progression (server-owned)
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER GENERATED ALWAYS AS (xp / 1000 + 1) STORED,
  gold INTEGER NOT NULL DEFAULT 0,
  silver INTEGER NOT NULL DEFAULT 0,
  inventory TEXT NOT NULL DEFAULT '{"weapons":[],"equippedWeaponId":null}',

  -- Lifetime stats
  games_played INTEGER NOT NULL DEFAULT 0,
  monsters_killed INTEGER NOT NULL DEFAULT 0,
  damage_dealt INTEGER NOT NULL DEFAULT 0,
  damage_taken INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_characters_user ON characters(user_id);

-- Game Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                    -- UUID
  join_code TEXT NOT NULL UNIQUE,
  dm_user_id TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'lobby'
    CHECK (status IN ('lobby', 'playing', 'paused', 'ended')),

  config TEXT NOT NULL,                   -- JSON: SessionConfig
  game_state TEXT,                        -- JSON: GameState (null until started)
  event_log TEXT NOT NULL DEFAULT '[]',   -- JSON: GameEvent[]

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  ended_at INTEGER,

  FOREIGN KEY (dm_user_id) REFERENCES users(id)
);

CREATE INDEX idx_sessions_join_code ON sessions(join_code);
CREATE INDEX idx_sessions_status ON sessions(status);

-- Session Players (junction)
CREATE TABLE session_players (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,

  unit_id TEXT,                           -- Assigned when game starts
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'spectating')),
  is_ready INTEGER NOT NULL DEFAULT 0,

  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),

  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (character_id) REFERENCES characters(id)
);

-- Session archive (for replays, optional)
CREATE TABLE session_archives (
  id TEXT PRIMARY KEY,                    -- Same as original session ID
  dm_user_id TEXT NOT NULL,
  config TEXT NOT NULL,
  final_state TEXT NOT NULL,
  event_log TEXT NOT NULL,
  player_results TEXT NOT NULL,           -- JSON: GameRewards[]

  played_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,

  FOREIGN KEY (dm_user_id) REFERENCES users(id)
);
```

### Migrations

```typescript
// server/src/db/migrations.ts
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE users (...);
      CREATE TABLE characters (...);
      CREATE TABLE sessions (...);
      CREATE TABLE session_players (...);
    `,
  },
  {
    version: 2,
    name: 'add_session_archives',
    up: `CREATE TABLE session_archives (...);`,
  },
];
```

---

## Security

### Authentication Security

| Measure | Implementation |
|---------|----------------|
| Passwordless | Pocket ID with WebAuthn passkeys |
| Token expiry | JWT expires in 7 days |
| Token refresh | Refresh endpoint before expiry |
| Secure transport | Cloudflare Tunnel (HTTPS only) |
| Token storage | httpOnly cookie or secure localStorage |

### WebSocket Security

```typescript
// server/src/ws/handler.ts
class WSHandler {
  private authenticated: Map<WebSocket, SessionToken> = new Map();
  private authTimeout = 5000; // 5 seconds to authenticate

  onConnection(ws: WebSocket) {
    // Start auth timeout
    const timeout = setTimeout(() => {
      if (!this.authenticated.has(ws)) {
        ws.close(4001, 'Authentication timeout');
      }
    }, this.authTimeout);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'auth') {
        clearTimeout(timeout);
        this.handleAuth(ws, msg.payload.token);
      } else if (!this.authenticated.has(ws)) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { code: 'AUTH_REQUIRED', message: 'Must authenticate first' }
        }));
      } else {
        this.handleMessage(ws, msg);
      }
    });
  }

  private handleAuth(ws: WebSocket, token: string) {
    try {
      const decoded = jwt.verify(token, AUTH_CONFIG.jwt.secret) as SessionToken;
      this.authenticated.set(ws, decoded);
      // ... send auth_result
    } catch {
      ws.close(4002, 'Invalid token');
    }
  }
}
```

### Game Security (Server Authority)

| Attack Vector | Prevention |
|---------------|------------|
| Fake actions | Server validates all actions |
| Modified stats | Stats calculated server-side from level |
| Gold manipulation | Gold only changes through server events |
| Inventory hacking | Inventory only modified by server |
| Speed hacking | Server tracks timestamps, rejects impossible actions |
| Position spoofing | Server validates all movement paths |

### Rate Limiting

```typescript
// server/src/ws/ratelimit.ts
class RateLimiter {
  private windows: Map<string, { count: number; resetAt: number }> = new Map();

  private limits = {
    action: { max: 30, windowMs: 60000 },     // 30 actions/minute
    chat: { max: 20, windowMs: 60000 },        // 20 messages/minute
    dm_command: { max: 60, windowMs: 60000 },  // 60 commands/minute
  };

  check(odId: string, odId: string, userId: string, type: keyof typeof this.limits): boolean {
    const limit = this.limits[type];
    const key = `${odId
    const key = `${userId}:${type}`;
    const now = Date.now();

    let window = this.windows.get(key);
    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + limit.windowMs };
      this.windows.set(key, window);
    }

    if (window.count >= limit.max) {
      return false; // Rate limited
    }

    window.count++;
    return true;
  }
}
```

### Input Validation

```typescript
// server/src/validation.ts
import { z } from 'zod';

const CharacterPersonaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(3).max(30).regex(/^[a-zA-Z0-9\s'-]+$/),
  class: z.enum(['warrior', 'ranger', 'mage', 'rogue']),
  appearance: z.object({
    bodyType: z.enum(['small', 'medium', 'large']),
    skinTone: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    hairColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    hairStyle: z.enum(['bald', 'short', 'medium', 'long', 'ponytail']),
    facialHair: z.enum(['none', 'stubble', 'beard', 'mustache']).optional(),
  }),
  backstory: z.string().max(1000).optional(),
});

const ChatMessageSchema = z.object({
  message: z.string().min(1).max(500).transform(sanitizeHtml),
  target: z.string().uuid().optional(),
});
```

---

## Implementation Phases

### Phase 1: Foundation ✅ COMPLETE

**Goal:** Authentication and basic WebSocket infrastructure

- [x] Pocket ID OIDC integration
  - [x] Authorization endpoint redirect (`/auth/login`)
  - [x] Callback handler with code exchange (`/auth/callback`)
  - [x] Session cookie management
  - [x] User info endpoint (`/auth/me`)
  - [x] Logout endpoint (`/auth/logout`)
- [x] WebSocket server
  - [x] Connection handling with Bun.serve websocket
  - [x] Authentication flow (5-second deadline)
  - [x] Message routing by type
  - [x] Connection tracking (authenticated count, total count)
  - [x] Rate limiting (30 messages/min)
- [x] Database setup
  - [x] SQLite with Bun native driver
  - [x] Users table with OIDC subject
  - [x] Sessions table for game rooms
  - [x] Saves table for single-player (legacy)

**Deliverable:** ✅ User can log in via Pocket ID and establish authenticated WebSocket connection.

### Phase 2: Game Server Core ✅ COMPLETE

**Goal:** Server-side game execution

- [x] Move simulation to server
  - [x] Import simulation package
  - [x] Server-side executeAction
  - [x] State management per session
- [x] Session management
  - [x] Create session (DM)
  - [x] Join code generation (6-char alphanumeric)
  - [x] Join session (players)
  - [x] Session state machine (lobby → playing → ended)
- [x] Message handlers
  - [x] create_game handler
  - [x] join_game handler
  - [x] action handler (move, attack, end_turn)
  - [x] leave_game handler
  - [x] ready handler
- [x] State synchronization
  - [x] Full state sync on join
  - [x] Event broadcasting to all session players

**Deliverable:** ✅ Single game session works with server-side logic.

### Phase 3: Multiplayer Logic ✅ COMPLETE

**Goal:** Full multiplayer support

- [x] Multi-player turn management
  - [x] Initiative with multiple players
  - [x] Turn tracking per player
  - [x] Current turn identification
- [x] Player lifecycle
  - [x] Disconnect detection (WebSocket close)
  - [x] 30-second grace period for reconnection
  - [x] Connection status tracking
- [x] DM commands
  - [x] Start game (all players ready)
  - [x] Basic session control
- [ ] Chat system (deferred to future version)
  - [ ] Broadcast messages
  - [ ] Whisper messages
  - [ ] DM announcements

**Deliverable:** ✅ Core multiplayer game loop works.

### Phase 4: Client Integration ✅ COMPLETE

**Goal:** Browser client with multiplayer support

- [x] MultiplayerController
  - [x] WebSocket connection management
  - [x] Exponential backoff reconnection
  - [x] State machine for connection status
  - [x] Game action dispatch
- [x] Screen State Machine
  - [x] Login screen
  - [x] Main menu with create/join options
  - [x] Lobby with player list and ready status
  - [x] Game screen integration
  - [x] Loading/connecting states
- [x] Auth Client
  - [x] Session check on page load
  - [x] Login redirect flow
  - [x] Logout handling
- [x] Mode Detection
  - [x] URL parameter-based mode selection
  - [x] Default fallback to single-player

**Deliverable:** ✅ Browser client supports both single-player and multiplayer modes.

### Phase 5: Character System (Future)

**Goal:** Persistent characters with offline creation

- [ ] Offline character creator
  - [ ] Creator UI components
  - [ ] IndexedDB storage
  - [ ] Character validation
- [ ] Server character storage
  - [ ] Character table operations
  - [ ] Persona upload/sync
  - [ ] Progression management
- [ ] XP and leveling
  - [ ] Level calculation
  - [ ] Stat scaling
  - [ ] Post-game rewards

**Status:** Planned for future version

### Phase 6: Polish & Production (Future)

**Goal:** Production readiness

- [ ] Error handling improvements
  - [ ] Graceful degradation
  - [ ] User-friendly error messages
- [ ] UI polish
  - [ ] Character creator
  - [ ] Enhanced lobby UI
  - [ ] In-game chat
- [ ] Testing
  - [ ] Integration tests for WebSocket
  - [ ] Load testing (concurrent sessions)
- [ ] Security audit
  - [ ] Penetration testing
  - [ ] Input validation review

**Status:** Planned for future version

---

## Client Changes

### New Client Architecture

```
src/
├── main.ts                    # Entry point (modified)
├── game.ts                    # GameController (heavily modified)
├── renderer.ts                # Three.js renderer (minor changes)
├── ui.ts                      # UI manager (extended)
│
├── network/
│   ├── websocket.ts           # WebSocket client wrapper
│   ├── messages.ts            # Message type definitions
│   ├── sync.ts                # State synchronization
│   └── reconnect.ts           # Reconnection logic
│
├── auth/
│   ├── login.ts               # Pocket ID login flow
│   ├── session.ts             # JWT management
│   └── guard.ts               # Route/action protection
│
├── character/
│   ├── creator.ts             # Character creator component
│   ├── storage.ts             # IndexedDB operations
│   └── sync.ts                # Server synchronization
│
└── lobby/
    ├── screens.ts             # Screen management
    ├── create.ts              # Create game UI
    ├── join.ts                # Join game UI
    └── waiting.ts             # Waiting room UI
```

### GameController Changes

```typescript
// Before (single-player)
class GameController {
  private gameState: GameState | null = null;

  private handleAction(action: GameAction) {
    const result = executeAction(action, this.gameState!);
    this.gameState = result.state;
    this.processEvents(result.events);
  }
}

// After (multiplayer)
class GameController {
  private gameState: GameState | null = null;
  private ws: WebSocketClient;
  private myUnitId: string | null = null;

  private async handleAction(action: GameAction) {
    // Don't execute locally - send to server
    this.ws.send({
      type: 'action',
      payload: action,
      seq: this.nextSeq++,
      ts: Date.now(),
    });

    // Wait for server response (state update will arrive via events)
    this.setMode('waiting');
  }

  // New: Handle server state updates
  private onStateUpdate(delta: StateDelta) {
    this.gameState = applyDelta(this.gameState!, delta);
    this.updateUI();
  }

  // New: Handle server events
  private onEvents(events: GameEvent[]) {
    for (const event of events) {
      this.processEvent(event);
    }
  }

  // New: Check if it's my turn
  private isMyTurn(): boolean {
    return this.gameState?.combat.turnState?.unitId === this.myUnitId;
  }
}
```

### New UI Screens

```typescript
// Screen flow
type Screen =
  | 'login'           // Not authenticated
  | 'main_menu'       // Authenticated, no game
  | 'character_select' // Choosing character for game
  | 'character_create' // Creating new character
  | 'lobby_create'    // DM configuring new game
  | 'lobby_join'      // Entering join code
  | 'waiting_room'    // In lobby, waiting for start
  | 'game'            // Active gameplay
  | 'game_over';      // Game ended, showing results

class ScreenManager {
  private currentScreen: Screen = 'login';

  show(screen: Screen, data?: unknown) {
    this.hideAll();
    this.currentScreen = screen;

    switch (screen) {
      case 'login':
        this.showLoginScreen();
        break;
      case 'main_menu':
        this.showMainMenu();
        break;
      // ... etc
    }
  }
}
```

### WebSocket Client

```typescript
// client/src/network/websocket.ts
class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  async connect(url: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.send({ type: 'auth', payload: { token } });
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'auth_result') {
          if (msg.success) {
            this.reconnectAttempts = 0;
            resolve();
          } else {
            reject(new Error(msg.error));
          }
        } else {
          this.emit(msg.type, msg.payload);
        }
      };

      this.ws.onclose = () => {
        this.emit('disconnected');
        this.attemptReconnect(token);
      };
    });
  }

  private attemptReconnect(token: string) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      this.emit('reconnecting', this.reconnectAttempts);
      this.connect(this.url, token).catch(() => {
        this.attemptReconnect(token);
      });
    }, delay);
  }

  send(message: WSMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
```

---

## Appendix

### Message Sequence Diagrams

#### Game Creation Flow

```
Player (DM)              Server                   Database
    │                      │                          │
    │  create_game         │                          │
    │─────────────────────>│                          │
    │                      │  INSERT session          │
    │                      │─────────────────────────>│
    │                      │                          │
    │                      │  OK                      │
    │                      │<─────────────────────────│
    │                      │                          │
    │  game_created        │                          │
    │  (joinCode: ABC123)  │                          │
    │<─────────────────────│                          │
    │                      │                          │
```

#### Player Join Flow

```
Player                Server                   DM Client
    │                    │                        │
    │  join_game         │                        │
    │  (code: ABC123)    │                        │
    │───────────────────>│                        │
    │                    │                        │
    │                    │  player_joined         │
    │                    │───────────────────────>│
    │                    │                        │
    │  game_joined       │                        │
    │  (session info)    │                        │
    │<───────────────────│                        │
    │                    │                        │
```

#### Action Execution Flow

```
Active Player        Server              All Players
    │                  │                      │
    │  action (move)   │                      │
    │─────────────────>│                      │
    │                  │                      │
    │                  │ validate             │
    │                  │ execute              │
    │                  │                      │
    │                  │  events              │
    │                  │─────────────────────>│
    │                  │                      │
    │  events          │  state_delta         │
    │<─────────────────│─────────────────────>│
    │                  │                      │
    │  state_delta     │                      │
    │<─────────────────│                      │
    │                  │                      │
```

### Configuration Reference

```typescript
// server/src/config.ts
export const CONFIG = {
  // Server
  port: Number(process.env.PORT) || 41204,
  host: process.env.HOST || '0.0.0.0',

  // Database
  dbPath: process.env.DB_PATH || './data/runeforge.db',

  // Auth
  pocketId: {
    issuer: process.env.POCKET_ID_ISSUER!,
    clientId: process.env.POCKET_ID_CLIENT_ID!,
    clientSecret: process.env.POCKET_ID_CLIENT_SECRET!,
    redirectUri: process.env.POCKET_ID_REDIRECT_URI!,
  },
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: '7d',
  },

  // WebSocket
  ws: {
    authTimeoutMs: 5000,
    pingIntervalMs: 30000,
    pongTimeoutMs: 10000,
  },

  // Game
  game: {
    maxPlayersPerSession: 8,
    defaultTurnTimeLimit: 0,  // 0 = unlimited
    disconnectGracePeriodMs: 30000,
    stateSyncIntervalRounds: 10,
  },

  // Rate limits
  rateLimit: {
    action: { max: 30, windowMs: 60000 },
    chat: { max: 20, windowMs: 60000 },
    dmCommand: { max: 60, windowMs: 60000 },
  },
};
```

### Error Codes Reference

| Code | HTTP | Description |
|------|------|-------------|
| `AUTH_REQUIRED` | 401 | No authentication provided |
| `AUTH_INVALID` | 401 | Token invalid or malformed |
| `AUTH_EXPIRED` | 401 | Token has expired |
| `FORBIDDEN` | 403 | Not authorized for action |
| `NOT_DM` | 403 | DM privileges required |
| `NOT_YOUR_TURN` | 400 | Action attempted out of turn |
| `GAME_NOT_FOUND` | 404 | Session doesn't exist |
| `GAME_FULL` | 400 | Session at max players |
| `GAME_ALREADY_STARTED` | 400 | Cannot join active game |
| `INVALID_ACTION` | 400 | Action validation failed |
| `CHARACTER_NOT_FOUND` | 404 | Character doesn't exist |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Current Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| **Server** | ✅ Complete | WebSocket, Auth, Game Sessions |
| **Client** | ✅ Complete | MultiplayerController, Screens, Auth |
| **Authentication** | ✅ Complete | Pocket ID OIDC integration |
| **Game Logic** | ✅ Complete | Server-authoritative, turn-based |
| **Character System** | 🔜 Planned | Offline creation, progression |
| **Chat** | 🔜 Planned | Broadcast and whisper |
| **DM Advanced Controls** | 🔜 Planned | Monster spawn, grants |

### What Works Now

- Single-player mode (default)
- Multiplayer mode with `?mode=multi`
- Pocket ID authentication
- Create and join games via 6-character codes
- Real-time game state synchronization
- Turn-based combat with multiple players
- Automatic reconnection on disconnect
- Ready/start game flow in lobby

### What's Coming

- Persistent character progression
- In-game chat
- Advanced DM controls (spawn monsters, grant items)
- Character customization UI
- Session archives and replays

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-12-29 | Claude | Initial draft |
| 1.1 | 2024-12-30 | Claude | Added Quick Start, Troubleshooting, Implementation Files, updated phase status |
