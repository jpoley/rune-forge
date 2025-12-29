# Project Spec: Browser-Based Turn-Based Isometric RPG (v1)

## Overview
This project is a **browser-based, turn-based, 3D isometric tactical RPG**, inspired by classic games like Neverwinter Nights and Baldur’s Gate, but intentionally scoped down to be buildable, extensible, and web-native (JavaScript or WASM).  
The initial version focuses on **tight tactical combat**, clear rules, and a deterministic core simulation, while laying architectural foundations for future expansion into **multiplayer (up to 8 players)** and a **DM-controlled “campaign mode”** with god-like control.  
Visual fidelity is intentionally modest; clarity, responsiveness, and extensibility matter more than high-end graphics.

---

## Core Pillars (Locked Decisions)
- **Platform:** Desktop browsers only
- **Rendering:** 3D isometric, low-to-mid fidelity
- **Game Mode (v1):** Single-player tactical combat
- **Combat:** Turn-based, separate combat scene
- **Scale (v1):** 1 player character vs 3 monsters
- **Future Scale:** Up to 8 players + 1 DM
- **Save System:** 10 save slots, timestamped

---

## Combat System Specification

### Turn Structure
- Combat uses an **initiative-based turn queue**
- Initiative is rolled or computed once at combat start
- Units act strictly in initiative order

### Action Economy
On a unit’s turn:
- **Move:** up to `MoveRange` tiles
- **Action:** one of:
  - Basic attack
  - Ability (future)
- **End Turn**

No reactions, interrupts, or bonus actions in v1.

---

## Movement Model
- **Grid-based movement** (square grid)
- Each tile is either:
  - Walkable
  - Blocked
- Pathfinding uses A* over the grid
- Units cannot move through blocked tiles or occupied tiles

---

## Line of Sight (LoS) Rules (ON)
- **LoS is required for all attacks and targeted abilities**
- A target is valid if an unobstructed ray exists from:
  - Attacker tile center → Target tile center
- Tiles marked `blocksLos = true` block the ray
- If the ray touches a blocking tile edge or corner:
  - **Touching counts as blocked** (predictable, conservative rule)

### Cover Rules (OFF)
- No partial cover
- No hit modifiers for terrain
- If LoS is clear → full effect
- If LoS is blocked → target is invalid

---

## Targeting Rules
- **Melee:** target must be in an adjacent tile
- **Ranged:** target must be within ability range AND have clear LoS
- AoE shapes are out of scope for v1 (single-target only)

---

## Map & World Representation

### Map Format
- Grid-based combat maps
- Map size: constrained (e.g. 20x20 tiles)
- Map is generated randomly in v1

### Tile Properties
Each tile defines:
- `walkable: boolean`
- `blocksLos: boolean`

### v1 Tile Types
- Floor: walkable, does not block LoS
- Wall / Rock: not walkable, blocks LoS
- Pillar: not walkable, blocks LoS

---

## Units

### Player Character
- Single controllable hero
- Stats (v1 minimal):
  - HP
  - Attack
  - Defense
  - Initiative
  - MoveRange

### Monsters
- Exactly 3 per encounter in v1
- Simple AI:
  - Move toward player
  - Attack if in range
  - End turn

---

## Win / Lose Conditions
- **Win:** all monsters defeated
- **Lose:** player defeated
- Combat ends immediately on either condition

---

## User Interface Requirements

### Combat UI
- Initiative tracker (visible turn order)
- Selected unit panel:
  - HP
  - Statuses (future)
- Action bar:
  - Move
  - Attack
  - End Turn
- Combat log (text-based)

### LoS Feedback (Required)
- Hover target preview:
  - Green highlight = targetable
  - Red highlight = blocked
- Blocked targets visually indicate blocking tile

### Camera Controls
- Fixed isometric camera
- Zoom in / out
- Pan via mouse or keyboard
- No free rotation in v1

---

## Save System
- Exactly **10 save slots**
- Each slot stores:
  - Timestamp
  - Map seed or serialized map
  - Unit states (HP, positions)
  - Initiative order + active turn
  - Save version number
- Save versioning is mandatory for future migrations

---

## Architecture Constraints (Critical)
- **Simulation is renderer-agnostic**
- Core game logic runs headless
- UI and rendering subscribe to simulation events
- Simulation produces deterministic results given the same inputs
- Designed for future **server-authoritative multiplayer**

---

## Future-Oriented Design Hooks (Not Implemented Yet)
- Multiplayer (up to 8 players)
- Server-authoritative combat resolution
- DM “god mode”:
  - Spawn units
  - Modify map
  - Override rules
- Campaign creator:
  - Map editor
  - Encounter editor
  - Dialogue and quest scripting
- Fog of war
- Abilities, AoE, and status effects
- Exploration mode outside combat

---

## Suggested Next Steps & Tools

### Immediate Next Steps
1. Implement the **headless combat simulation**
2. Define JSON schemas for:
   - Map
   - Tile
   - Unit
   - Save file
3. Build a minimal combat renderer + UI
4. Add random map generator that outputs the same map schema used by future editors

### Helpful Tools / Resources
- WebGL / WebGPU frameworks for isometric rendering
- Grid-based A* pathfinding libraries (or simple custom implementation)
- ECS or component-based modeling (keep it simple)
- JSON Schema for validating content files
- Lightweight in-browser dev tools for debugging sim state

### Where This Goes Next
Once the vertical slice is playable:
- Expand abilities and AI depth
- Add replayability via procedural encounters
- Introduce a local “DM mode” using the same authoritative sim
- Grow toward multiplayer by running the sim server-side without rewriting core logic

---

**Rule of thumb:**  
If a feature can’t be expressed as data or as a pure simulation rule, it doesn’t belong in v1.

