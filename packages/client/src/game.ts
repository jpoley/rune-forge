/**
 * Game controller - connects simulation with UI and renderer.
 * Handles user input, game state updates, and UI synchronization.
 */

import {
  executeAction,
  findPath,
  getValidAttackTargets,
  getValidMoveTargets,
  startCombat,
  type GameAction,
  type GameEvent,
  type GameMap,
  type GameState,
  type Position,
  type Unit,
  type UnitStats,
  type LootDrop,
  generateMap,
  DEFAULT_INVENTORY,
  WEAPON_DEFINITIONS,
} from "@rune-forge/simulation";
import { IsometricRenderer } from "./renderer.js";
import { GameUI, type CharacterSelection, type GameSettings, type NpcTurnMode } from "./ui.js";
import { SaveAPI } from "./api.js";
import type { CharacterClass, MonsterType } from "./characters.js";

export type GameMode = "menu" | "move" | "attack" | "waiting";

export class GameController {
  private renderer: IsometricRenderer;
  private ui: GameUI;
  private api: SaveAPI;

  private gameState: GameState | null = null;
  private mode: GameMode = "menu";
  private validMoveTargets: Position[] = [];
  private validAttackTargets: Unit[] = [];

  // Store character info for rendering
  private characterColors: Map<string, number> = new Map();
  private characterSprites: Map<string, string> = new Map();
  private aiTurnInProgress = false;

  // Turn timer
  private turnTimeRemaining = 15;
  private turnTimerInterval: ReturnType<typeof setInterval> | null = null;
  private isPaused = false;

  // Settings
  private gameSpeed = 1.25;
  private npcTurnMode: NpcTurnMode = "parallel";
  private defend = true;

  // Shop position for proximity check
  private shopPosition: Position | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new IsometricRenderer(container);
    this.ui = new GameUI();
    this.api = new SaveAPI();

    this.setupEventHandlers();
    this.renderer.startRenderLoop();
  }

  private setupEventHandlers(): void {
    // Renderer events
    this.renderer.onTileClick = (pos) => this.handleTileClick(pos);
    this.renderer.onTileHover = (pos) => this.handleTileHover(pos);
    this.renderer.onUnitClick = (unitId) => this.handleUnitClick(unitId);
    this.renderer.onLootClick = (lootId) => this.handleLootClick(lootId);
    this.renderer.onShopClick = () => this.handleShopClick();

    // UI events
    this.ui.onLoadGame = () => this.showLoadDialog();
    this.ui.onMoveAction = () => { this.resetTurnTimer(); this.setMode("move"); };
    this.ui.onAttackAction = () => { this.resetTurnTimer(); this.setMode("attack"); };
    this.ui.onEndTurn = () => this.endTurn();
    this.ui.onStartBattle = (selection) => this.startBattle(selection);
    this.ui.onPauseGame = () => this.togglePause();
    this.ui.onSettingsChange = (settings) => this.handleSettingsChange(settings);
    this.ui.onGrantWeapon = (weaponId) => this.handleGrantWeapon(weaponId);
    this.ui.onGrantGold = (amount) => this.handleGrantGold(amount);
    this.ui.onBuyWeapon = (weaponId) => this.handleBuyWeapon(weaponId);
    this.ui.onSleep = () => this.handleSleep();
  }

  /**
   * Handle settings changes from UI.
   */
  private handleSettingsChange(settings: GameSettings): void {
    this.gameSpeed = settings.gameSpeed;
    this.npcTurnMode = settings.npcTurnMode;
    this.defend = settings.defend;

    // Update equipped weapon in game state
    if (this.gameState && settings.equippedWeaponId !== this.gameState.playerInventory.equippedWeaponId) {
      this.gameState = {
        ...this.gameState,
        playerInventory: {
          ...this.gameState.playerInventory,
          equippedWeaponId: settings.equippedWeaponId,
        },
      };
      // Update inventory display to show new weapon
      this.ui.updateInventory(this.gameState.playerInventory);
    }

    console.log(`Settings changed: speed=${this.gameSpeed}x, npcMode=${this.npcTurnMode}, defend=${this.defend}, weapon=${settings.equippedWeaponId}`);
  }

  /**
   * Handle granting a weapon to the player (DM option).
   */
  private handleGrantWeapon(weaponId: string): void {
    if (!this.gameState) return;

    // Find the weapon definition
    const weaponDef = WEAPON_DEFINITIONS.find(w => w.id === weaponId);
    if (!weaponDef) {
      console.error(`Unknown weapon: ${weaponId}`);
      return;
    }

    // Check if player already has this weapon type
    const alreadyOwns = this.gameState.playerInventory.weapons.some(w => w.name === weaponDef.name);
    if (alreadyOwns) {
      this.ui.addLogEntry(`Already have ${weaponDef.name}`, "system");
      return;
    }

    // Create the weapon item
    const newWeapon = {
      id: `dm_${weaponId}_${Date.now()}`,
      type: "weapon" as const,
      name: weaponDef.name,
      attackBonus: weaponDef.attackBonus,
    };

    // Add to inventory
    const newWeapons = [...this.gameState.playerInventory.weapons, newWeapon];
    this.gameState = {
      ...this.gameState,
      playerInventory: {
        ...this.gameState.playerInventory,
        weapons: newWeapons,
        // Auto-equip if better than current
        equippedWeaponId: !this.gameState.playerInventory.equippedWeaponId ||
          weaponDef.attackBonus > (this.gameState.playerInventory.weapons.find(
            w => w.id === this.gameState!.playerInventory.equippedWeaponId
          )?.attackBonus ?? 0)
          ? newWeapon.id
          : this.gameState.playerInventory.equippedWeaponId,
      },
    };

    this.ui.addLogEntry(`🎲 DM grants: ${weaponDef.name} (+${weaponDef.attackBonus})`, "victory");
    this.ui.updateInventory(this.gameState.playerInventory);
    this.updateUI();
  }

  /**
   * Handle granting gold to the player (DM option).
   */
  private handleGrantGold(amount: number): void {
    if (!this.gameState) return;

    this.gameState = {
      ...this.gameState,
      playerInventory: {
        ...this.gameState.playerInventory,
        gold: this.gameState.playerInventory.gold + amount,
      },
    };

    this.ui.addLogEntry(`🎲 DM grants: ${amount} gold`, "victory");
    this.ui.updateInventory(this.gameState.playerInventory);
    this.ui.updateShopGold(this.gameState.playerInventory.gold);
    this.ui.renderShopItems();
  }

  /**
   * Handle buying a weapon from the shop.
   */
  private handleBuyWeapon(weaponId: string): void {
    if (!this.gameState) return;

    // Find the weapon definition
    const weaponDef = WEAPON_DEFINITIONS.find(w => w.id === weaponId);
    if (!weaponDef) {
      console.error(`Unknown weapon: ${weaponId}`);
      return;
    }

    // Check if player can afford it
    if (this.gameState.playerInventory.gold < weaponDef.price) {
      this.ui.addLogEntry(`Not enough gold for ${weaponDef.name}!`, "damage");
      return;
    }

    // Check if player already has this weapon type
    const alreadyOwns = this.gameState.playerInventory.weapons.some(w => w.name === weaponDef.name);
    if (alreadyOwns) {
      this.ui.addLogEntry(`Already have ${weaponDef.name}`, "system");
      return;
    }

    // Create the weapon item
    const newWeapon = {
      id: `shop_${weaponId}_${Date.now()}`,
      type: "weapon" as const,
      name: weaponDef.name,
      attackBonus: weaponDef.attackBonus,
    };

    // Deduct gold and add weapon
    const newWeapons = [...this.gameState.playerInventory.weapons, newWeapon];
    this.gameState = {
      ...this.gameState,
      playerInventory: {
        ...this.gameState.playerInventory,
        gold: this.gameState.playerInventory.gold - weaponDef.price,
        weapons: newWeapons,
        // Auto-equip if better than current
        equippedWeaponId: !this.gameState.playerInventory.equippedWeaponId ||
          weaponDef.attackBonus > (this.gameState.playerInventory.weapons.find(
            w => w.id === this.gameState!.playerInventory.equippedWeaponId
          )?.attackBonus ?? 0)
          ? newWeapon.id
          : this.gameState.playerInventory.equippedWeaponId,
      },
    };

    this.ui.addLogEntry(`🏪 Bought: ${weaponDef.name} for ${weaponDef.price}g`, "move");
    this.ui.updateInventory(this.gameState.playerInventory);
    this.ui.updateShopGold(this.gameState.playerInventory.gold);
    this.ui.renderShopItems();
    this.updateUI();
  }

  /**
   * Handle sleep action - heal the player and end their turn.
   */
  private handleSleep(): void {
    if (!this.gameState || this.isPaused) return;

    // Only player can sleep during their turn
    const currentUnit = this.getCurrentUnit();
    if (!currentUnit || currentUnit.type !== "player") {
      this.ui.addLogEntry("Can only sleep during your turn!", "system");
      return;
    }

    // Get heal amount from DM settings
    const healAmount = this.ui.getSleepHealAmount();
    const player = this.gameState.units.find(u => u.id === currentUnit.id);
    if (!player) return;

    // Calculate actual healing (can't exceed max HP)
    const actualHeal = Math.min(healAmount, player.stats.maxHp - player.stats.hp);

    if (actualHeal <= 0) {
      this.ui.addLogEntry("Already at full health!", "system");
      return;
    }

    // Update player HP
    const updatedUnits = this.gameState.units.map(u =>
      u.id === player.id
        ? { ...u, stats: { ...u.stats, hp: u.stats.hp + actualHeal } }
        : u
    );

    this.gameState = {
      ...this.gameState,
      units: updatedUnits,
    };

    this.ui.addLogEntry(`💤 ${player.name} sleeps and heals ${actualHeal} HP!`, "victory");
    this.renderer.renderUnits(this.gameState.units);
    this.ui.showUnitPanel(this.gameState.units.find(u => u.id === player.id)!);

    // End turn after sleeping
    this.endTurn();
  }

  /**
   * Start a battle with selected characters.
   */
  startBattle(selection: CharacterSelection): void {
    const gameSeed = Date.now();

    // Generate infinite map
    const map = generateMap({
      seed: gameSeed,
      wallDensity: 0.12,
    });

    // Player starts at origin
    const playerStart = { x: 0, y: 0 };

    // Create player unit from selected class
    const playerStats: UnitStats = {
      hp: selection.playerClass.stats.hp,
      maxHp: selection.playerClass.stats.hp,
      attack: selection.playerClass.stats.attack,
      defense: selection.playerClass.stats.defense,
      initiative: selection.playerClass.stats.initiative,
      moveRange: selection.playerClass.stats.moveRange,
      attackRange: selection.playerClass.stats.attackRange,
    };

    const player: Unit = {
      id: "player-1",
      type: "player",
      name: selection.playerClass.name,
      position: playerStart,
      stats: playerStats,
    };

    // Store colors and sprites for rendering
    this.characterColors.set("player-1", selection.playerClass.color);
    this.characterSprites.set("player-1", selection.playerClass.sprite);

    // Create monster units from selected monsters
    // Monsters spawn at fixed offsets from player (for infinite world)
    const monsterSpawns = [
      { x: playerStart.x + 15, y: playerStart.y },       // East
      { x: playerStart.x - 15, y: playerStart.y },       // West
      { x: playerStart.x, y: playerStart.y + 15 },       // South
    ];

    const monsters: Unit[] = selection.monsters.map((monster, i) => {
      const id = `monster-${i + 1}`;
      this.characterColors.set(id, monster.color);
      this.characterSprites.set(id, monster.sprite);

      return {
        id,
        type: "monster" as const,
        name: monster.name,
        position: monsterSpawns[i]!,
        stats: {
          hp: monster.stats.hp,
          maxHp: monster.stats.hp,
          attack: monster.stats.attack,
          defense: monster.stats.defense,
          initiative: monster.stats.initiative,
          moveRange: monster.stats.moveRange,
          attackRange: monster.stats.attackRange,
        },
      };
    });

    // Create test loot bag near player (adjacent to player at origin)
    const testLoot: LootDrop = {
      id: "test-loot-1",
      position: { x: playerStart.x + 1, y: playerStart.y + 1 },
      items: [
        { id: "gold_test", type: "gold", name: "5 Gold", value: 5 },
        { id: "silver_test", type: "silver", name: "10 Silver", value: 10 },
      ],
    };

    // Create initial game state
    this.gameState = {
      map,
      units: [player, ...monsters],
      combat: {
        phase: "not_started",
        round: 0,
        initiativeOrder: [],
        currentTurnIndex: 0,
        turnState: null,
      },
      turnHistory: [],
      lootDrops: [testLoot],
      playerInventory: DEFAULT_INVENTORY,
    };

    // Pass colors and sprites to renderer
    this.renderer.setUnitColors(this.characterColors);
    this.renderer.setUnitSprites(this.characterSprites);

    // Start combat
    const result = startCombat(this.gameState, gameSeed);
    this.gameState = result.state;

    // Process events
    for (const event of result.events) {
      this.handleEvent(event);
    }

    // Render initial state (centered on player for infinite map)
    this.renderer.renderMap(this.gameState.map, player.position);
    this.renderer.renderUnits(this.gameState.units);

    // Render initial loot bags
    for (const loot of this.gameState.lootDrops) {
      this.renderer.addLootBag(loot);
    }

    // Create merchant shop near player start
    this.shopPosition = { x: playerStart.x + 3, y: playerStart.y };
    this.renderer.createShop(this.shopPosition);

    // Set initial shop button state based on player proximity
    this.ui.setShopEnabled(this.isNearShop(playerStart));

    // Center on player
    this.renderer.centerOnPosition(player.position, false);

    // Update UI
    this.ui.hideStartScreen();
    this.ui.hideCharacterSelect();
    this.ui.showActionBar();
    this.updateUI();

    // Check if first turn is AI (monster has higher initiative)
    const firstUnit = this.getCurrentUnit();
    if (firstUnit?.type === "monster") {
      this.mode = "waiting";
      this.checkAITurn();
    } else {
      this.setMode("move");
    }
  }

  /**
   * Set the current interaction mode.
   */
  private setMode(mode: GameMode): void {
    this.mode = mode;
    this.renderer.clearHighlights();
    this.validMoveTargets = [];
    this.validAttackTargets = [];

    if (!this.gameState) return;

    const currentUnit = this.getCurrentUnit();
    if (!currentUnit || currentUnit.type !== "player") {
      this.mode = "waiting";
      return;
    }

    switch (mode) {
      case "move":
        this.validMoveTargets = getValidMoveTargets(this.gameState);
        this.renderer.highlightTiles(this.validMoveTargets, "move");
        break;

      case "attack":
        this.validAttackTargets = getValidAttackTargets(this.gameState);
        const attackPositions = this.validAttackTargets.map(u => u.position);
        this.renderer.highlightTiles(attackPositions, "attack");
        break;
    }

    // Check if there are valid attack targets for button state
    const hasValidTargets = getValidAttackTargets(this.gameState).length > 0;
    this.ui.updateActionButtons(mode, this.gameState.combat.turnState, hasValidTargets);
  }

  /**
   * Handle tile click based on current mode.
   */
  private handleTileClick(pos: Position): void {
    if (!this.gameState || this.mode === "menu" || this.mode === "waiting" || this.isPaused) return;

    this.resetTurnTimer();

    if (this.mode === "move") {
      this.handleMoveClick(pos);
    }
  }

  /**
   * Handle unit click based on current mode.
   */
  private handleUnitClick(unitId: string): void {
    if (!this.gameState || this.isPaused) return;

    const unit = this.gameState.units.find(u => u.id === unitId);
    if (!unit) return;

    this.resetTurnTimer();

    if (this.mode === "attack") {
      if (this.validAttackTargets.some(u => u.id === unitId)) {
        this.executeAttack(unitId);
      }
    } else {
      // Select unit for info display
      this.renderer.selectUnit(unitId);
      this.ui.showUnitPanel(unit);
    }
  }

  /**
   * Handle loot click - collect loot if player is adjacent.
   */
  private handleLootClick(lootId: string): void {
    if (!this.gameState || this.isPaused) return;

    // Only player can collect loot during their turn
    const currentUnit = this.getCurrentUnit();
    if (!currentUnit || currentUnit.type !== "player") {
      this.ui.addLogEntry("Can only collect loot during your turn!", "system");
      return;
    }

    // Find the loot drop
    const lootDrop = this.gameState.lootDrops.find(l => l.id === lootId);
    if (!lootDrop) return;

    // Execute collect loot action
    const action: GameAction = {
      type: "collect_loot",
      unitId: currentUnit.id,
      lootDropId: lootId,
    };

    try {
      const result = executeAction(action, this.gameState);
      this.gameState = result.state;

      // Process events
      for (const event of result.events) {
        this.handleEvent(event);
      }

      // Update visuals
      this.renderer.renderUnits(this.gameState.units);
      this.updateUI();
      this.resetTurnTimer();
    } catch (error) {
      this.ui.addLogEntry((error as Error).message || "Cannot collect loot!", "system");
    }
  }

  /**
   * Handle shop click - open the shop panel if player is nearby.
   */
  private handleShopClick(): void {
    if (!this.gameState || this.isPaused) return;

    // Only allow shop interaction if player is adjacent
    const player = this.gameState.units.find(u => u.type === "player");
    if (!player || !this.isNearShop(player.position)) {
      this.ui.addLogEntry("Too far from the shop!", "system");
      return;
    }

    this.ui.addLogEntry("🏪 Welcome to the Warez Merchant!", "turn");
    this.ui.updateShopGold(this.gameState.playerInventory.gold);
    this.ui.toggleShopPanel();
  }

  /**
   * Handle tile hover.
   */
  private handleTileHover(pos: Position | null): void {
    // Could add hover effects or LoS preview here
  }

  /**
   * Handle movement click.
   */
  private handleMoveClick(pos: Position): void {
    if (!this.gameState) return;

    // Check if position is valid
    const isValid = this.validMoveTargets.some(
      p => p.x === pos.x && p.y === pos.y
    );

    if (!isValid) return;

    const currentUnit = this.getCurrentUnit();
    if (!currentUnit) return;

    // Find path
    const path = findPath(
      currentUnit.position,
      pos,
      this.gameState.map,
      this.gameState.units,
      currentUnit.id
    );

    if (!path) return;

    // Execute move
    const action: GameAction = {
      type: "move",
      unitId: currentUnit.id,
      path,
    };

    this.executeAction(action);
  }

  /**
   * Execute an attack on a target.
   */
  private executeAttack(targetId: string): void {
    if (!this.gameState) return;

    const currentUnit = this.getCurrentUnit();
    if (!currentUnit) return;

    const action: GameAction = {
      type: "attack",
      unitId: currentUnit.id,
      targetId,
    };

    this.executeAction(action);
  }

  /**
   * Execute a counter-attack from the player against an attacker.
   * This happens automatically when defend is enabled and player is attacked.
   * Counter-attacks don't consume the player's action for their turn.
   */
  private executeCounterAttack(playerId: string, attackerId: string): void {
    if (!this.gameState) return;

    // Verify both units are still alive
    const player = this.gameState.units.find(u => u.id === playerId);
    const attacker = this.gameState.units.find(u => u.id === attackerId);

    if (!player || !attacker || player.stats.hp <= 0 || attacker.stats.hp <= 0) {
      return;
    }

    this.ui.addLogEntry(`⚔️ ${player.name} counter-attacks!`, "damage");

    const action: GameAction = {
      type: "attack",
      unitId: playerId,
      targetId: attackerId,
    };

    // Save the current turn state - counter-attacks shouldn't consume the player's action
    const savedTurnState = this.gameState.combat.turnState;

    // Execute counter-attack directly (bypasses turn checks)
    try {
      const result = executeAction(action, this.gameState);
      this.gameState = result.state;

      // Restore the turn state so counter-attack doesn't consume player's action
      if (savedTurnState) {
        this.gameState = {
          ...this.gameState,
          combat: {
            ...this.gameState.combat,
            turnState: savedTurnState,
          },
        };
      }

      // Process events (but don't trigger another counter-attack)
      for (const event of result.events) {
        if (event.type !== "unit_attacked") {
          this.handleEvent(event);
        } else {
          // Log the counter-attack hit without triggering recursion
          const target = this.gameState?.units.find(u => u.id === (event as { targetId: string }).targetId);
          if (target) {
            this.ui.addLogEntry(`Counter-attack hits ${target.name}!`, "damage");
          }
        }
      }

      // Update visuals
      this.renderer.renderUnits(this.gameState.units);
      this.updateUI();
    } catch (error) {
      console.error("Counter-attack failed:", error);
    }
  }

  /**
   * End the current turn.
   */
  private endTurn(): void {
    if (!this.gameState) return;

    const currentUnit = this.getCurrentUnit();
    if (!currentUnit) return;

    const action: GameAction = {
      type: "end_turn",
      unitId: currentUnit.id,
    };

    this.executeAction(action);
  }

  /**
   * Execute an action and update state.
   */
  private executeAction(action: GameAction): void {
    if (!this.gameState) return;

    try {
      const result = executeAction(action, this.gameState);
      this.gameState = result.state;

      // Process events
      for (const event of result.events) {
        this.handleEvent(event);
      }

      // Update visuals
      this.renderer.renderUnits(this.gameState.units);
      this.updateUI();

      // Refresh movement highlights after moving (to show reduced range)
      if (action.type === "move" && this.mode === "move") {
        this.validMoveTargets = getValidMoveTargets(this.gameState);
        this.renderer.clearHighlights();
        this.renderer.highlightTiles(this.validMoveTargets, "move");
      }

      // Auto-end turn after attack OR when movement is exhausted
      const currentUnit = this.getCurrentUnit();
      const turnState = this.gameState.combat.turnState;
      if (
        currentUnit?.type === "player" &&
        turnState &&
        action.type !== "end_turn" // Don't double-end
      ) {
        // End turn immediately after attacking
        if (action.type === "attack") {
          this.ui.addLogEntry("Turn complete - attack finished", "turn");
          this.endTurn();
          return;
        }
        // End turn when movement is exhausted
        if (turnState.movementRemaining <= 0) {
          this.ui.addLogEntry("Turn complete - no movement remaining", "turn");
          this.endTurn();
          return;
        }
      }

      // Check if it's AI's turn
      this.checkAITurn();
    } catch (error) {
      console.error("Action failed:", error);
      this.ui.addLogEntry(`Error: ${(error as Error).message}`, "damage");
    }
  }

  /**
   * Handle game events for logging and effects.
   */
  private handleEvent(event: GameEvent): void {
    switch (event.type) {
      case "combat_started":
        this.ui.addLogEntry("⚔️ Combat begins!", "turn");
        break;

      case "turn_started": {
        const unit = this.gameState?.units.find(u => u.id === event.unitId);
        if (unit) {
          this.ui.addLogEntry(`${unit.name}'s turn`, "turn");
          this.renderer.selectUnit(unit.id);
          this.ui.showUnitPanel(unit);

          // Start timer for player turns, stop for AI
          if (unit.type === "player") {
            // Center camera on player when their turn starts
            this.renderer.centerOnPosition(unit.position, true);
            this.startTurnTimer();
          } else {
            this.stopTurnTimer();
            this.ui.updateTimer(-1); // Hide timer
          }
        }
        break;
      }

      case "unit_moved": {
        const unit = this.gameState?.units.find(u => u.id === event.unitId);
        if (unit) {
          this.ui.addLogEntry(`${unit.name} moved`, "move");
          // Only center camera on player movement
          if (unit.type === "player") {
            this.renderer.centerOnPosition(unit.position, true);
            // Update infinite world - regenerate tiles around new position
            this.renderer.updateRenderCenter(unit.position);
            // Update shop button and panel based on proximity
            const nearShop = this.isNearShop(unit.position);
            this.ui.setShopEnabled(nearShop);
            if (!nearShop) {
              this.ui.hideShopPanel();
            }
          }
        }
        break;
      }

      case "unit_attacked": {
        const attacker = this.gameState?.units.find(u => u.id === event.attackerId);
        const target = this.gameState?.units.find(u => u.id === event.targetId);
        if (attacker && target) {
          this.ui.addLogEntry(`${attacker.name} attacks ${target.name}`, "damage");

          // Counter-attack: if player was attacked, defend is on, and both are alive
          if (
            this.defend &&
            target.type === "player" &&
            target.stats.hp > 0 &&
            attacker.stats.hp > 0 &&
            attacker.type === "monster"
          ) {
            // Queue counter-attack after a brief delay
            setTimeout(() => this.executeCounterAttack(target.id, attacker.id), 200 / this.gameSpeed);
          }
        }
        break;
      }

      case "unit_damaged": {
        const unit = this.gameState?.units.find(u => u.id === event.unitId);
        if (unit) {
          this.ui.addLogEntry(
            `${unit.name} takes ${event.damage} damage (${event.remainingHp} HP left)`,
            "damage"
          );
        }
        break;
      }

      case "unit_defeated": {
        const unit = this.gameState?.units.find(u => u.id === event.unitId);
        if (unit) {
          this.ui.addLogEntry(`${unit.name} is defeated!`, "damage");
        }
        break;
      }

      case "combat_ended":
        this.stopTurnTimer();
        this.ui.updateTimer(-1);
        if (event.result === "victory") {
          this.ui.addLogEntry("🎉 VICTORY!", "victory");
        } else {
          this.ui.addLogEntry("💀 DEFEAT!", "defeat");
        }
        this.mode = "menu";
        this.ui.hideActionBar();
        break;

      case "loot_dropped":
        this.ui.addLogEntry("💰 Loot dropped!", "turn");
        this.renderer.addLootBag(event.lootDrop);
        break;

      case "loot_collected": {
        this.ui.addLogEntry(`📦 Collected loot!`, "victory");
        this.renderer.removeLootBag(event.lootDropId);
        this.playCoinSound();
        // Update inventory display
        if (this.gameState) {
          this.ui.updateInventory(this.gameState.playerInventory);
        }
        break;
      }
    }
  }

  /**
   * Check if it's the AI's turn and execute AI logic.
   */
  private async checkAITurn(): Promise<void> {
    if (!this.gameState) return;
    if (this.aiTurnInProgress) return; // Prevent overlapping AI turns

    const currentUnit = this.getCurrentUnit();
    if (!currentUnit || currentUnit.type !== "monster") return;

    if (this.npcTurnMode === "parallel") {
      await this.executeParallelAITurns();
    } else {
      await this.executeSequentialAITurn(currentUnit);
    }
  }

  /**
   * Execute a single monster's turn sequentially (original behavior).
   */
  private async executeSequentialAITurn(currentUnit: Unit): Promise<void> {
    if (!this.gameState) return;

    this.aiTurnInProgress = true;
    console.log(`AI turn (sequential): ${currentUnit.name} (${currentUnit.id})`);

    try {
      // Simple delay for visual feedback
      await this.delay(500);

      // Simple AI: move toward player and attack if possible
      const player = this.gameState.units.find(
        u => u.type === "player" && u.stats.hp > 0
      );

      if (!player) {
        this.aiTurnInProgress = false;
        return;
      }

      // Try to attack first
      const attackTargets = getValidAttackTargets(this.gameState);
      if (attackTargets.length > 0) {
        this.aiTurnInProgress = false; // Reset before action so next AI can run
        this.executeAction({
          type: "attack",
          unitId: currentUnit.id,
          targetId: attackTargets[0]!.id,
        });
        return;
      }

      // Try to move toward player
      const moveTargets = getValidMoveTargets(this.gameState);
      if (moveTargets.length > 0) {
        // Find closest position to player
        let bestPos = moveTargets[0]!;
        let bestDist = this.manhattanDistance(bestPos, player.position);

        for (const pos of moveTargets) {
          const dist = this.manhattanDistance(pos, player.position);
          if (dist < bestDist) {
            bestDist = dist;
            bestPos = pos;
          }
        }

        const path = findPath(
          currentUnit.position,
          bestPos,
          this.gameState.map,
          this.gameState.units,
          currentUnit.id
        );

        if (path) {
          this.executeAction({
            type: "move",
            unitId: currentUnit.id,
            path,
          });

          // Check if can attack after moving
          await this.delay(300);
          if (this.gameState) {
            const newAttackTargets = getValidAttackTargets(this.gameState);
            if (newAttackTargets.length > 0) {
              this.aiTurnInProgress = false; // Reset before action
              this.executeAction({
                type: "attack",
                unitId: currentUnit.id,
                targetId: newAttackTargets[0]!.id,
              });
              return;
            }
          }
        }
      }

      // End AI turn
      await this.delay(300);
      this.aiTurnInProgress = false; // Reset before action so next AI can run
      if (this.gameState && this.gameState.combat.phase === "in_progress") {
        this.executeAction({
          type: "end_turn",
          unitId: currentUnit.id,
        });
      }
    } catch (error) {
      console.error("AI turn error:", error);
      this.aiTurnInProgress = false;
    }
  }

  /**
   * Execute all pending monster turns in parallel (simultaneously).
   * Monsters act at the same time with rapid visual feedback.
   */
  private async executeParallelAITurns(): Promise<void> {
    if (!this.gameState) return;

    this.aiTurnInProgress = true;
    console.log("AI turns (parallel mode)");

    try {
      // Initial delay for visual feedback
      await this.delay(300);

      // Process all consecutive monster turns rapidly
      while (this.gameState && this.gameState.combat.phase === "in_progress") {
        const currentUnit = this.getCurrentUnit();
        if (!currentUnit || currentUnit.type !== "monster") break;

        console.log(`Parallel AI: ${currentUnit.name}`);

        const player = this.gameState.units.find(
          u => u.type === "player" && u.stats.hp > 0
        );

        if (!player) break;

        // Execute AI decision for this unit
        let acted = false;

        // Try to attack first
        const attackTargets = getValidAttackTargets(this.gameState);
        if (attackTargets.length > 0) {
          this.executeActionSilent({
            type: "attack",
            unitId: currentUnit.id,
            targetId: attackTargets[0]!.id,
          });
          acted = true;
        }

        // If didn't attack, try to move toward player
        if (!acted) {
          const moveTargets = getValidMoveTargets(this.gameState);
          if (moveTargets.length > 0) {
            // Find closest position to player
            let bestPos = moveTargets[0]!;
            let bestDist = this.manhattanDistance(bestPos, player.position);

            for (const pos of moveTargets) {
              const dist = this.manhattanDistance(pos, player.position);
              if (dist < bestDist) {
                bestDist = dist;
                bestPos = pos;
              }
            }

            const path = findPath(
              currentUnit.position,
              bestPos,
              this.gameState.map,
              this.gameState.units,
              currentUnit.id
            );

            if (path) {
              this.executeActionSilent({
                type: "move",
                unitId: currentUnit.id,
                path,
              });

              // Check if can attack after moving
              if (this.gameState) {
                const newAttackTargets = getValidAttackTargets(this.gameState);
                if (newAttackTargets.length > 0) {
                  await this.delay(100); // Brief delay between move and attack
                  this.executeActionSilent({
                    type: "attack",
                    unitId: currentUnit.id,
                    targetId: newAttackTargets[0]!.id,
                  });
                }
              }
            }
          }
        }

        // End this monster's turn
        if (this.gameState && this.gameState.combat.phase === "in_progress") {
          this.executeActionSilent({
            type: "end_turn",
            unitId: currentUnit.id,
          });
        }

        // Brief delay between monsters in parallel mode for visual clarity
        await this.delay(150);
      }

      this.aiTurnInProgress = false;

      // Update UI after all parallel turns complete
      if (this.gameState) {
        this.renderer.renderUnits(this.gameState.units);
        this.updateUI();
      }
    } catch (error) {
      console.error("Parallel AI turn error:", error);
      this.aiTurnInProgress = false;
    }
  }

  /**
   * Execute an action without triggering checkAITurn (for parallel mode).
   */
  private executeActionSilent(action: GameAction): void {
    if (!this.gameState) return;

    try {
      const result = executeAction(action, this.gameState);
      this.gameState = result.state;

      // Process events
      for (const event of result.events) {
        this.handleEvent(event);
      }

      // Update visuals
      this.renderer.renderUnits(this.gameState.units);
    } catch (error) {
      console.error("Silent action failed:", error);
    }
  }

  private manhattanDistance(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * Check if player is adjacent to the shop (within 1 tile).
   */
  private isNearShop(playerPos: Position): boolean {
    if (!this.shopPosition) return false;
    return this.manhattanDistance(playerPos, this.shopPosition) <= 1;
  }

  private delay(ms: number): Promise<void> {
    // Apply game speed: higher speed = shorter delays
    const adjustedMs = Math.round(ms / this.gameSpeed);
    return new Promise(resolve => setTimeout(resolve, adjustedMs));
  }

  /**
   * Play coin collection sound effect.
   * TODO: Add sound file when audio is implemented
   */
  private playCoinSound(): void {
    // Sound disabled for now
  }

  /**
   * Start or reset the turn timer for player turns.
   */
  private startTurnTimer(): void {
    this.stopTurnTimer();
    this.turnTimeRemaining = 15;
    this.ui.updateTimer(this.turnTimeRemaining);

    this.turnTimerInterval = setInterval(() => {
      if (this.isPaused) return;

      this.turnTimeRemaining--;
      this.ui.updateTimer(this.turnTimeRemaining);

      if (this.turnTimeRemaining <= 0) {
        this.stopTurnTimer();
        // Auto-end turn
        const currentUnit = this.getCurrentUnit();
        if (currentUnit && currentUnit.type === "player") {
          this.ui.addLogEntry("Time's up! Turn ended automatically.", "turn");
          this.endTurn();
        }
      }
    }, 1000);
  }

  /**
   * Stop the turn timer.
   */
  private stopTurnTimer(): void {
    if (this.turnTimerInterval) {
      clearInterval(this.turnTimerInterval);
      this.turnTimerInterval = null;
    }
  }

  /**
   * Reset the turn timer (on player action).
   */
  private resetTurnTimer(): void {
    if (this.turnTimerInterval && !this.isPaused) {
      this.turnTimeRemaining = 15;
      this.ui.updateTimer(this.turnTimeRemaining);
    }
  }

  /**
   * Toggle pause state.
   */
  private togglePause(): void {
    if (!this.gameState || this.gameState.combat.phase !== "in_progress") return;

    this.isPaused = !this.isPaused;
    this.ui.showPauseOverlay(this.isPaused);

    if (this.isPaused) {
      this.ui.addLogEntry("Game paused", "turn");
    } else {
      this.ui.addLogEntry("Game resumed", "turn");
    }
  }

  /**
   * Get the current unit whose turn it is.
   */
  private getCurrentUnit(): Unit | null {
    if (!this.gameState?.combat.turnState) return null;
    return this.gameState.units.find(
      u => u.id === this.gameState!.combat.turnState!.unitId
    ) ?? null;
  }

  /**
   * Update the UI to reflect current game state.
   */
  private updateUI(): void {
    if (!this.gameState) return;

    this.ui.updateInitiativeTracker(
      this.gameState.combat.initiativeOrder,
      this.gameState.units,
      this.gameState.combat.currentTurnIndex
    );

    // Update weapon options in settings
    const weapons = this.gameState.playerInventory.weapons.map(w => ({
      id: w.id,
      name: w.name,
      attackBonus: w.attackBonus ?? 0,
    }));
    this.ui.updateWeaponOptions(weapons, this.gameState.playerInventory.equippedWeaponId);

    // Update shop gold display
    this.ui.updateShopGold(this.gameState.playerInventory.gold);

    const currentUnit = this.getCurrentUnit();
    if (currentUnit) {
      this.ui.showUnitPanel(currentUnit);
      const hasValidTargets = getValidAttackTargets(this.gameState).length > 0;
      this.ui.updateActionButtons(this.mode, this.gameState.combat.turnState, hasValidTargets);

      // Update mode based on current unit
      if (currentUnit.type === "player" && this.mode === "waiting") {
        this.setMode("move");
      } else if (currentUnit.type === "monster") {
        this.mode = "waiting";
        this.renderer.clearHighlights();
      }
    }
  }

  /**
   * Show load game dialog (placeholder).
   */
  private async showLoadDialog(): Promise<void> {
    try {
      const saves = await this.api.listSaves();
      console.log("Available saves:", saves);
      // TODO: Show save selection UI
      alert("Load game UI coming soon!");
    } catch (error) {
      console.error("Failed to load saves:", error);
    }
  }

  /**
   * Save the current game.
   */
  async saveGame(slot: number, name: string): Promise<void> {
    if (!this.gameState) return;

    try {
      await this.api.saveGame(slot, name, this.gameState);
      this.ui.addLogEntry(`Game saved to slot ${slot}`, "turn");
    } catch (error) {
      console.error("Failed to save:", error);
      this.ui.addLogEntry("Failed to save game", "damage");
    }
  }

  /**
   * Load a saved game.
   */
  async loadGame(slot: number): Promise<void> {
    try {
      const saveData = await this.api.loadGame(slot);
      if (saveData) {
        this.gameState = saveData.gameState;
        // Center on player position for infinite maps
        const player = this.gameState.units.find(u => u.type === "player");
        const playerPos = player?.position ?? { x: 0, y: 0 };
        this.renderer.renderMap(this.gameState.map, playerPos);
        this.renderer.renderUnits(this.gameState.units);
        this.renderer.centerCamera(playerPos);
        this.ui.hideStartScreen();
        this.ui.showActionBar();
        this.updateUI();
        this.setMode("move");
        this.ui.addLogEntry(`Loaded: ${saveData.name}`, "turn");
      }
    } catch (error) {
      console.error("Failed to load:", error);
    }
  }
}
