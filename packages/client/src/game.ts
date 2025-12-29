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
  generateMap,
} from "@rune-forge/simulation";
import { IsometricRenderer } from "./renderer.js";
import { GameUI, type CharacterSelection } from "./ui.js";
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

    // UI events
    this.ui.onLoadGame = () => this.showLoadDialog();
    this.ui.onMoveAction = () => { this.resetTurnTimer(); this.setMode("move"); };
    this.ui.onAttackAction = () => { this.resetTurnTimer(); this.setMode("attack"); };
    this.ui.onEndTurn = () => this.endTurn();
    this.ui.onStartBattle = (selection) => this.startBattle(selection);
    this.ui.onPauseGame = () => this.togglePause();
  }

  /**
   * Start a battle with selected characters.
   */
  startBattle(selection: CharacterSelection): void {
    const gameSeed = Date.now();

    // Generate map
    const map = generateMap({
      seed: gameSeed,
      width: 20,
      height: 20,
      wallDensity: 0.12,
    });

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
      position: { x: 2, y: 2 },
      stats: playerStats,
    };

    // Store colors and sprites for rendering
    this.characterColors.set("player-1", selection.playerClass.color);
    this.characterSprites.set("player-1", selection.playerClass.sprite);

    // Create monster units from selected monsters
    const monsterSpawns = [
      { x: map.size.width - 3, y: 2 },
      { x: 2, y: map.size.height - 3 },
      { x: map.size.width - 3, y: map.size.height - 3 },
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

    // Render initial state
    this.renderer.renderMap(this.gameState.map);
    this.renderer.renderUnits(this.gameState.units);
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

      // Auto-end turn if player has no movement left AND has acted
      const currentUnit = this.getCurrentUnit();
      const turnState = this.gameState.combat.turnState;
      if (
        currentUnit?.type === "player" &&
        turnState &&
        turnState.movementRemaining <= 0 &&
        turnState.hasActed &&
        action.type !== "end_turn" // Don't double-end
      ) {
        this.ui.addLogEntry("Turn complete - no actions remaining", "turn");
        this.endTurn();
        return;
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
          }
        }
        break;
      }

      case "unit_attacked": {
        const attacker = this.gameState?.units.find(u => u.id === event.attackerId);
        const target = this.gameState?.units.find(u => u.id === event.targetId);
        if (attacker && target) {
          this.ui.addLogEntry(`${attacker.name} attacks ${target.name}`, "damage");
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

    this.aiTurnInProgress = true;
    console.log(`AI turn: ${currentUnit.name} (${currentUnit.id})`);

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

  private manhattanDistance(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        this.renderer.renderMap(this.gameState.map);
        this.renderer.renderUnits(this.gameState.units);
        this.renderer.centerCamera(this.gameState.map.size);
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
