# Rune Forge Wishlist Analysis

**Generated:** December 30, 2025
**Source:** User wishlist from docs/page1.PNG and docs/page2.PNG
**Codebase Review:** Complete analysis of packages/simulation, packages/client, and packages/server

---

## Executive Summary

| Status | Count | Description |
|--------|-------|-------------|
| ✅ DONE | 2 | Fully implemented and working |
| 🟡 PARTIAL | 4 | Some foundation exists, significant work remaining |
| ❌ NOT STARTED | 5 | No code exists for this feature |

**Current State:** The game has a solid turn-based combat foundation with a working shop/currency system. The major gaps are: no dialogue/story system, no party mechanics, no difficulty modes, and limited character customization.

---

## Category 1: Combat System

### 1.1 Turn-Based Combat

**Status:** ✅ IMPLEMENTED
**Size:** N/A (Complete)

**What's Done:**
- Initiative-based turn queue with dice roll + stat modifier (`combat.ts:71-90`)
- Action economy: Move + Action + End Turn (`types.ts:156-164`)
- Turn phases: move, action, ended (`types.ts:157`)
- Round tracking and advancement (`combat.ts:202-226`)
- Win/Lose detection: all monsters defeated = victory, player defeated = defeat (`combat.ts:629-646`)
- Valid move target calculation with A* pathfinding (`combat.ts:684-706`)
- Valid attack target calculation with range and LoS checks (`combat.ts:711-746`)
- Melee (range 1, adjacent) and Ranged (range > 1, requires LoS) attacks (`combat.ts:349-364`)
- Counter-attack system when player is attacked (`game.ts:632-689`)

**What's Missing:**
- Reactions/interrupts (explicitly out of v1 scope per `goal.md:36`)
- Bonus actions (explicitly out of v1 scope)
- AoE attacks (explicitly out of v1 scope per `goal.md:69`)

**Notes:** This is the core pillar of the game and is well-implemented. The simulation is deterministic and renderer-agnostic as designed.

---

### 1.2 Abilities (Spells and Different Weapon Attacks)

**Status:** 🟡 PARTIAL
**Size:** LARGE (4-6 weeks of work)

**What's Done:**
- Basic attack action exists (`combat.ts:462-560`)
- 8 weapon types with varying damage and range (`loot.ts:28-39`):
  - Melee: Dagger (2 dmg), Short Sword (3), Longsword (4), Battleaxe (5), Greatsword (6)
  - Ranged: Shortbow (3 dmg, 5 range), Longbow (4 dmg, 8 range), Crossbow (5 dmg, 6 range)
- Weapon equipping and damage calculation (`loot.ts:164-195`)
- Attack range varies by weapon type

**What's NOT Done:**
- **Spell System:** No magic, no mana, no spell slots, no spell definitions
- **Spell Casting UI:** No targeting for AoE, no spell selection
- **Ability Cooldowns:** No tracking for limited-use abilities
- **Special Attacks:** No weapon-specific special moves (e.g., cleave, multishot)
- **Status Effects:** No buffs, debuffs, or conditions (poison, stun, etc.)
- **Casting Classes:** Mage and Cleric have no functional spells despite being selectable

**What Needs To Be Built:**
1. `Ability` type definition with: name, cost, range, effect type, cooldown, damage formula
2. `SpellSlot` system with per-class slot counts
3. Ability targeting system (single target, AoE shapes: cone, line, radius)
4. Status effect system with duration tracking
5. UI for ability bar and spell selection
6. Per-class ability lists

**Estimated Complexity:**
- Type definitions: 1 day
- Spell slot/mana system: 2-3 days
- AoE targeting: 3-5 days
- Status effects: 1 week
- UI implementation: 1 week
- Balancing and testing: 1 week

---

## Category 2: Character System

### 2.1 Character Customization

**Status:** 🟡 PARTIAL
**Size:** MEDIUM (2-3 weeks)

**What's Done:**
- Character class selection with 6 classes (`characters.ts:44-93`):
  - Fighter, Cleric, Mage, Thief, Elf, Dwarf
- Each class has: name, description, sprite, color, stats (HP, ATK, DEF, INIT, MOV, RNG)
- Class selection UI with stat display (`ui.ts:557-640`)
- Different sprites per class (SVG-based, fallback to color placeholders)

**What's NOT Done:**
- **Pronouns:** No pronoun selection (She/her, He/Him, They/Them)
- **Name Input:** Player cannot name their character (uses class name)
- **Appearance Options:** No hair, face, or body customization
- **Portrait Selection:** No character portrait system

**What Needs To Be Built:**
1. `CharacterProfile` type: name, pronouns, appearance options
2. Character creation screen with:
   - Name text input
   - Pronoun dropdown (She/her, He/Him, They/Them, Custom)
   - Class selection (existing)
3. Pronoun integration in combat log and dialogue
4. Portrait/avatar system for UI display

**Estimated Complexity:**
- Type definitions: 2 hours
- Name input UI: 4 hours
- Pronoun system: 1 day (including all text references)
- Portrait selection: 2-3 days
- Appearance customization: 1-2 weeks (depends on depth)

---

### 2.2 Skin Tone Color Slider (Race-Based)

**Status:** ❌ NOT STARTED
**Size:** MEDIUM (1-2 weeks)

**What Exists:**
- Characters render as 2D sprites on 3D billboards (`renderer.ts:580-627`)
- Fallback texture generation creates basic humanoid shapes (`renderer.ts:475-575`)
- Each class has a hardcoded color used for sprite generation

**What's NOT Done:**
- No skin tone selection
- No race system beyond class (Elf/Dwarf are classes, not races)
- No character mesh that could be recolored
- No slider UI component
- No concept of "race affects available skin tones"

**What Needs To Be Built:**
1. Race system separate from class:
   - Human, Elf, Dwarf, Halfling, etc.
   - Each race has skin tone palette options
2. Skin tone slider component (probably a preset picker, not true slider)
3. Dynamic sprite/texture generation with skin tone parameter
4. OR: Switch to modular sprite system with layered body parts

**Technical Considerations:**
- Current sprite system uses pre-made SVGs or procedural canvas textures
- True skin tone customization requires either:
  - (A) Modular sprite parts that can be tinted
  - (B) Shader-based recoloring
  - (C) Pre-generated sprite variants per skin tone
- Option C is simplest but has combinatorial explosion with other customization

**Estimated Complexity:**
- Race system: 2-3 days
- Skin tone presets (6-8 options): 3-4 days
- UI slider/picker: 1-2 days
- Sprite integration: 3-5 days

---

### 2.3 Different Outfits/Armor/Weapons by Class

**Status:** 🟡 PARTIAL
**Size:** LARGE (3-4 weeks)

**What's Done:**
- Each class has a distinct sprite (`characters.ts:49, 57, 65, 73, 81, 89`)
- Weapon system exists with 8 weapon types (`loot.ts:28-39`)
- Weapons are collected as loot and can be equipped (`loot.ts:201-235`)
- Shop sells weapons (`game.ts:189-244`)

**What's NOT Done:**
- **Armor System:** No armor types, no armor stats, no armor slots
- **Class Starting Gear:** All classes start with no equipment
- **Visual Equipment:** Equipped weapons don't change character appearance
- **Outfit System:** No cosmetic or functional outfit options
- **Class Restrictions:** Any class can use any weapon

**What Needs To Be Built:**
1. `Armor` type: id, name, defense bonus, armor class (light/medium/heavy)
2. `Equipment` slots: weapon, armor, (maybe accessory)
3. Starting equipment per class
4. Armor definitions and drop/shop integration
5. Class-based equipment restrictions (optional)
6. Visual equipment display (requires sprite layering system)

**Estimated Complexity:**
- Armor type and slots: 2-3 days
- Starting equipment: 1 day
- Shop integration: 1-2 days
- Class restrictions: 1 day
- Visual equipment: 1-2 weeks (requires sprite system rework)

---

## Category 3: Difficulty & Game Modes

### 3.1 Game Modes (Easy, Normal, Hard)

**Status:** ❌ NOT STARTED
**Size:** MEDIUM (1-2 weeks)

**What Exists:**
- Monster stats are defined in `map-generator.ts:231-247`
- Player stats are defined in `map-generator.ts:221-229` and `characters.ts`
- No difficulty parameter in any generation function

**Wishlist Requirements:**
```
Easy:
- Enemies have less health than normal
- Players are given extra spell slots and health
- AC is boosted by 1

Normal:
- Enemy health is not changed
- Players have same amount of spell slots
- AC stays the same

Hard:
- Enemies have more health than usual
- Players have less spell slots
- AC is lower at the start of the game only, but players can buy/acquire higher AC armor
```

**What's NOT Done:**
- No difficulty selection UI
- No difficulty parameter in game state
- No stat modification based on difficulty
- **No AC (Armor Class) system exists** - only attack/defense
- **No spell slot system exists**

**What Needs To Be Built:**
1. `Difficulty` enum: easy, normal, hard
2. Difficulty selection in start screen
3. Difficulty modifiers object:
   ```typescript
   interface DifficultyModifiers {
     enemyHpMultiplier: number;      // 0.75, 1.0, 1.25
     playerHpBonus: number;          // +10, 0, 0
     playerAcBonus: number;          // +1, 0, -1
     spellSlotMultiplier: number;    // 1.5, 1.0, 0.75
   }
   ```
4. Apply modifiers at combat start
5. **Prerequisite:** Spell slot system must exist for spell slot modifiers
6. **Prerequisite:** AC system must exist for AC modifiers

**Dependency Note:** This feature requires the Spell System (2.2) and an Armor Class system to be fully implemented. Without those, only the HP modifier portion is possible.

**Estimated Complexity:**
- Difficulty enum and selection: 4 hours
- HP modifiers: 1 day
- AC system (new): 3-4 days
- Spell slot modifiers: Depends on spell system existing
- Full implementation: 1-2 weeks

---

## Category 4: NPC & Party System

### 4.1 Default NPC Party Members

**Status:** ❌ NOT STARTED
**Size:** X-LARGE (6-8 weeks)

**What Exists:**
- Current design is **1 player vs 3 monsters** (`goal.md:15`)
- AI for monsters: move toward player, attack if in range (`game.ts:903-994`)
- Unit type is binary: "player" or "monster" (`types.ts:81`)

**What's NOT Done:**
- No party system
- No allied NPCs
- No AI for friendly units
- No party formation or positioning
- No party member selection
- No party-based initiative handling

**What Needs To Be Built:**
1. Expand `UnitType` to include "ally" or add `faction` property
2. Party data structure:
   ```typescript
   interface Party {
     members: Unit[];
     leader: string; // unit ID
     formation?: FormationType;
   }
   ```
3. NPC ally definitions (similar to CHARACTER_CLASSES)
4. Friendly AI system (different behaviors than enemy AI):
   - Follow player
   - Attack nearby enemies
   - Protect low-HP allies
   - Use abilities intelligently
5. Party selection screen
6. Initiative handling for multiple friendly units
7. Party-based win/lose conditions

**Technical Considerations:**
- The combat simulation needs major refactoring to support multiple player-controlled or AI-controlled allies
- Turn order becomes more complex with larger parties
- UI needs to show all party member stats, not just the player

**Estimated Complexity:**
- Unit type refactoring: 2-3 days
- Party data structure: 2 days
- NPC ally definitions: 2-3 days
- Friendly AI: 2-3 weeks
- Party UI: 1 week
- Testing and balancing: 1 week

---

### 4.2 Multiplayer Replacement of NPCs

**Status:** ❌ NOT STARTED
**Size:** X-LARGE (3-6 months)

**What Exists:**
- Architecture is designed for future multiplayer (`goal.md:163-164`):
  > "Simulation produces deterministic results given the same inputs"
  > "Designed for future server-authoritative multiplayer"
- Deterministic seeded RNG in combat and map generation
- Event-based state updates (good for networking)

**What's NOT Done:**
- No networking layer
- No player authentication
- No lobby system
- No real-time synchronization
- No server-authoritative validation
- No player session management
- No reconnection handling

**What Needs To Be Built:**
1. WebSocket server for real-time communication
2. Player authentication and session management
3. Lobby system for party formation
4. State synchronization protocol
5. Server-side action validation
6. Client prediction and reconciliation
7. Latency compensation
8. Reconnection and state recovery
9. Chat system

**Notes:** The v1 goal explicitly states multiplayer is future scope. The current architecture is correctly designed for this, but implementation is a major project.

---

## Category 5: Story & Relationships

### 5.1 Cutscenes with Dialogue Choices

**Status:** ❌ NOT STARTED
**Size:** LARGE (4-6 weeks for system, content is additional)

**What Exists:**
- Combat log displays text messages (`ui.ts:835-850`)
- No dialogue system of any kind

**What's NOT Done:**
- No dialogue data format
- No dialogue rendering UI
- No branching conversation logic
- No choice selection
- No cutscene triggering
- No NPC interaction system
- No story state tracking

**What Needs To Be Built:**
1. Dialogue data schema:
   ```typescript
   interface DialogueNode {
     id: string;
     speaker: string;
     text: string;
     portrait?: string;
     choices?: DialogueChoice[];
     next?: string; // next node ID if no choices
     effects?: DialogueEffect[]; // relationship changes, items, flags
   }

   interface DialogueChoice {
     text: string;
     nextNodeId: string;
     conditions?: Condition[];
     effects?: DialogueEffect[];
   }
   ```
2. Dialogue UI:
   - Text box with speaker name and portrait
   - Typewriter text effect (optional)
   - Choice buttons
   - Skip/auto-advance options
3. Cutscene system:
   - Trigger conditions (map location, combat end, item pickup)
   - Camera control during cutscenes
   - Character positioning
4. Story state manager:
   - Flags/variables for branching
   - Quest tracking (optional)
5. Dialogue editor (optional but highly recommended)

**Estimated Complexity:**
- Data schema and parsing: 2-3 days
- Dialogue UI: 1 week
- Choice handling: 2-3 days
- Cutscene triggers: 3-4 days
- Story state: 2-3 days
- Content creation: Unlimited (depends on story scope)

---

### 5.2 Relationship Hearts Bar with NPCs

**Status:** ❌ NOT STARTED
**Size:** MEDIUM (2-3 weeks)

**What Exists:**
- No NPC relationship system
- No disposition tracking
- Combat log shows unit interactions

**Wishlist Requirement:**
> "Relationship hearts bar with NPCs (Hearts turn black for negative relationships)"

**What's NOT Done:**
- No NPC roster or profiles
- No relationship value storage
- No hearts UI component
- No actions that affect relationships
- No consequences for relationship levels

**What Needs To Be Built:**
1. NPC profile system:
   ```typescript
   interface NpcProfile {
     id: string;
     name: string;
     portrait: string;
     faction?: string;
   }

   interface Relationship {
     npcId: string;
     value: number; // -100 to +100 or 0-10 hearts
     history: RelationshipEvent[];
   }
   ```
2. Relationship storage in game state
3. Hearts UI component:
   - Max hearts display (e.g., 10 hearts)
   - Filled hearts for positive relationship
   - Black/broken hearts for negative relationship
   - Visual transitions when relationship changes
4. Events that modify relationships:
   - Dialogue choices
   - Quest completion
   - Combat actions (attacking allies, etc.)
   - Gift giving (optional)
5. Relationship consequences:
   - Dialogue options locked/unlocked
   - NPC joins/leaves party
   - Shop price modifiers
   - Quest availability

**Estimated Complexity:**
- Data structures: 1 day
- Hearts UI: 2-3 days
- Relationship modifiers: 3-4 days
- Consequence integration: 1 week
- Content creation: Additional

---

## Category 6: Economy & Progression

### 6.1 Currency and Shops

**Status:** ✅ IMPLEMENTED
**Size:** N/A (Complete for weapons)

**What's Done:**
- Gold and Silver currency (`types.ts:123-128`)
- Inventory tracks gold, silver, weapons (`types.ts:123-128`)
- Loot drop system with 80% coin chance, 25% weapon chance (`loot.ts:45-46`)
- Loot collection action (`combat.ts:369-389`, `combat.ts:590-623`)
- Shop building rendered in world (`renderer.ts:854-912`)
- Shop UI with buy functionality (`ui.ts:488-548`)
- Weapon purchasing with gold (`game.ts:189-244`)
- DM grant weapons/gold debug feature (`game.ts:117-184`)

**What's NOT Done:**
- **Potions:** No potion items, no healing items
- **Armor:** No armor purchasing (armor system doesn't exist)
- **Consumables:** No single-use items
- **Sell functionality:** Cannot sell items back to shop
- **Shop inventory:** Shop has all weapons always, no scarcity

**What Needs To Be Built (for full wishlist):**
1. Potion system:
   - Potion type definitions (health, mana, buff)
   - Consumable item type
   - Use action in combat
   - Potion loot drops
   - Shop potion inventory
2. Armor purchasing (requires armor system from 2.3)
3. Sell functionality and pricing
4. Dynamic shop inventory

**Estimated Complexity:**
- Potion system: 1 week
- Armor shop: 2-3 days (after armor system exists)
- Sell functionality: 2-3 days
- Dynamic inventory: 2-3 days

---

## Category 7: Save System

### 7.1 Auto-Save Before Boss Fights / Manual Save

**Status:** 🟡 PARTIAL
**Size:** SMALL-MEDIUM (1 week)

**What's Done:**
- 10 save slots with SQLite storage (`database.ts:21-35`)
- Save/Load API endpoints (`index.ts:61-122`)
- Save metadata: slot, name, timestamp, version (`types.ts:320-325`)
- Version migration support for future compatibility (`database.ts:140-152`)
- Client-side save API wrapper (`api.ts`)

**What's NOT Done:**
- **Manual Save UI:** Button exists concept but UI is incomplete ("coming soon" alert in `game.ts:1279`)
- **Auto-Save:** No automatic saving at any point
- **Boss Detection:** No boss flag or boss fight concept
- **Save Confirmation:** No "are you sure" dialogs
- **Load Game UI:** No slot selection interface

**Wishlist Requirement:**
> "Auto saving before boss fights only, otherwise players can save manually"

**What Needs To Be Built:**
1. Manual save UI:
   - Save button in action bar
   - Slot selection modal
   - Save name input
   - Overwrite confirmation
2. Load game UI:
   - Slot list with timestamps and names
   - Delete save option
   - Load confirmation
3. Boss system:
   - Boss flag on monster definitions
   - Boss encounter detection
4. Auto-save trigger:
   - Before boss combat starts
   - Auto-slot selection (dedicated auto-save slot?)

**Estimated Complexity:**
- Manual save UI: 2-3 days
- Load game UI: 2-3 days
- Boss detection: 1 day
- Auto-save logic: 1 day

---

## Implementation Priority Recommendation

### Tier 1: Quick Wins (< 1 week each)
1. **Game Modes (HP modifier only)** - Can do enemy HP scaling without spell/AC systems
2. **Manual Save UI** - Backend exists, just needs UI
3. **Character Name Input** - Simple text field addition

### Tier 2: Foundation Features (1-2 weeks each)
4. **Armor System** - Enables difficulty AC modifiers and outfit variety
5. **Potion System** - Completes shop functionality
6. **Pronoun System** - Small scope, high user value

### Tier 3: Major Features (3-6 weeks each)
7. **Spell/Ability System** - Major combat depth increase
8. **Dialogue System** - Enables story content
9. **Relationship System** - Requires dialogue system first

### Tier 4: Architectural Changes (6+ weeks)
10. **Party System** - Requires combat refactoring
11. **Multiplayer** - Entire networking stack

### Tier 5: Art-Heavy Features
12. **Skin Tone Customization** - Requires sprite system rework
13. **Visual Equipment** - Requires modular sprite system
14. **Cutscene System** - Requires dialogue system + content

---

## Dependencies Graph

```
Game Modes (Full) ─────┬─── Spell System
                       └─── AC/Armor System

Relationship System ───── Dialogue System ───── NPC Profiles

Party System ──────────┬─── Friendly AI
                       └─── Unit Type Refactoring

Visual Equipment ──────── Modular Sprite System ───── Skin Tone

Multiplayer ───────────┬─── Party System
                       └─── WebSocket Infrastructure
```

---

## Summary by Feature

| # | Feature | Status | Size | Dependencies |
|---|---------|--------|------|--------------|
| 1 | Turn-Based Combat | ✅ Done | - | None |
| 2 | Cutscenes/Dialogue | ❌ None | Large | NPC Profiles |
| 3 | Character Customization | 🟡 Partial | Medium | None |
| 4 | Relationship Hearts | ❌ None | Medium | Dialogue System |
| 5 | Skin Tone Slider | ❌ None | Medium | Sprite System Rework |
| 6 | Class Outfits/Armor | 🟡 Partial | Large | Armor System |
| 7 | Game Modes | ❌ None | Medium | Spell System, AC System |
| 8 | NPC Party Members | ❌ None | X-Large | Party System, AI |
| 9 | Spells/Abilities | 🟡 Partial | Large | None |
| 10 | Currency/Shops | ✅ Done | - | (Potions, Armor for full) |
| 11 | Save System | 🟡 Partial | Small | None |
