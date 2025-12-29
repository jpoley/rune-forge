# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rune Forge is a **browser-based, turn-based, 3D isometric tactical RPG** inspired by Neverwinter Nights and Baldur's Gate. The v1 scope focuses on single-player tactical combat with a 1 player character vs 3 monsters format.

See `goal.md` for the complete specification.

## Build Commands

```bash
# Install dependencies
pnpm install

# Development (runs client + server with hot reload)
./scripts/dev.sh
# Or manually:
pnpm run dev:server  # Server at http://localhost:3000
pnpm run dev:client  # Client at http://localhost:5173 (proxies to server)

# Build for production
./scripts/build.sh
# Or:
pnpm run build

# Run tests
pnpm run test:simulation

# Docker
pnpm run docker:build   # Build Docker image
pnpm run docker:run     # Run container on port 3000

# Or with docker-compose:
cd docker && docker-compose up --build
```

## Project Structure

```
rune-forge/
├── packages/
│   ├── simulation/     # Headless, deterministic game logic (CORE)
│   │   └── src/
│   │       ├── types.ts        # All type definitions
│   │       ├── combat.ts       # Combat engine
│   │       ├── pathfinding.ts  # A* pathfinding
│   │       ├── line-of-sight.ts # LoS calculations
│   │       └── map-generator.ts # Random map/unit generation
│   ├── server/         # Bun HTTP server + SQLite saves
│   │   └── src/
│   │       ├── index.ts   # HTTP server
│   │       └── database.ts # SQLite save management
│   └── client/         # Browser client with Three.js
│       └── src/
│           ├── main.ts    # Entry point
│           ├── game.ts    # Game controller
│           ├── renderer.ts # Three.js isometric renderer
│           ├── ui.ts      # DOM UI management
│           └── api.ts     # Save/load API client
├── docker/             # Docker build files
├── scripts/            # Dev/build scripts
└── goal.md             # Full game specification
```

## Architecture

### Core Design Principle

**The simulation must be renderer-agnostic and deterministic.** This is the most critical architectural constraint:

- Core game logic runs headless (no rendering dependencies)
- UI and rendering subscribe to simulation events
- Given identical inputs, simulation produces identical results
- Designed for future server-authoritative multiplayer

### Key Systems

| System | Purpose |
|--------|---------|
| **Combat Simulation** | Initiative-based turn queue, action economy (move + action), win/lose detection |
| **Movement** | Grid-based (square), A* pathfinding, walkable/blocked tiles |
| **Line of Sight** | Ray-based LoS check required for all attacks; blocking tiles invalidate targets |
| **Targeting** | Melee (adjacent tile), Ranged (within range + clear LoS) |
| **Save System** | 10 slots with versioning for future migrations |

### Data Schemas Required

JSON schemas needed for:
- Map (grid-based, constrained size ~20x20)
- Tile (walkable: boolean, blocksLos: boolean)
- Unit (HP, Attack, Defense, Initiative, MoveRange)
- Save file (timestamp, map state, unit states, initiative order, version)

### Tile Types (v1)

| Type | Walkable | Blocks LoS |
|------|----------|------------|
| Floor | Yes | No |
| Wall/Rock | No | Yes |
| Pillar | No | Yes |

## Technology Constraints

- **Platform:** Desktop browsers only
- **Rendering:** 3D isometric, low-to-mid fidelity (WebGL/WebGPU)
- Clarity and responsiveness over visual fidelity

## Design Rule

> If a feature can't be expressed as data or as a pure simulation rule, it doesn't belong in v1.
