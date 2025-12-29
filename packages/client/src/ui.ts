/**
 * UI management for Rune Forge.
 * Handles DOM updates for initiative tracker, action bar, unit panel, and combat log.
 */

import type { InitiativeEntry, TurnState, Unit } from "@rune-forge/simulation";
import type { GameMode } from "./game.js";
import { CHARACTER_CLASSES, MONSTER_TYPES, type CharacterClass, type MonsterType } from "./characters.js";

export interface CharacterSelection {
  playerClass: CharacterClass;
  monsters: MonsterType[];
}

export class GameUI {
  // Event callbacks
  onNewGame: (() => void) | null = null;
  onLoadGame: (() => void) | null = null;
  onMoveAction: (() => void) | null = null;
  onAttackAction: (() => void) | null = null;
  onEndTurn: (() => void) | null = null;
  onStartBattle: ((selection: CharacterSelection) => void) | null = null;
  onPauseGame: (() => void) | null = null;

  // DOM elements
  private startScreen: HTMLElement;
  private characterSelect: HTMLElement;
  private initiativeList: HTMLElement;
  private unitPanel: HTMLElement;
  private actionBar: HTMLElement;
  private combatLog: HTMLElement;
  private timerDisplay: HTMLElement;
  private pauseOverlay: HTMLElement;

  // Selection state
  private selectedClass: CharacterClass | null = null;
  private selectedMonsters: MonsterType[] = [];

  constructor() {
    this.startScreen = document.getElementById("start-screen")!;
    this.characterSelect = document.getElementById("character-select")!;
    this.initiativeList = document.getElementById("initiative-list")!;
    this.unitPanel = document.getElementById("unit-panel")!;
    this.actionBar = document.getElementById("action-bar")!;
    this.combatLog = document.getElementById("combat-log")!;
    this.timerDisplay = document.getElementById("turn-timer")!;
    this.pauseOverlay = document.getElementById("pause-overlay")!;

    this.setupEventListeners();
    this.buildCharacterSelectionUI();
  }

  private setupEventListeners(): void {
    document.getElementById("btn-new-game")?.addEventListener("click", () => {
      this.showCharacterSelect();
    });

    document.getElementById("btn-load-game")?.addEventListener("click", () => {
      this.onLoadGame?.();
    });

    document.getElementById("btn-move")?.addEventListener("click", () => {
      this.onMoveAction?.();
    });

    document.getElementById("btn-attack")?.addEventListener("click", () => {
      this.onAttackAction?.();
    });

    document.getElementById("btn-end-turn")?.addEventListener("click", () => {
      this.onEndTurn?.();
    });

    document.getElementById("start-battle-btn")?.addEventListener("click", () => {
      if (this.selectedClass && this.selectedMonsters.length === 3) {
        this.onStartBattle?.({
          playerClass: this.selectedClass,
          monsters: this.selectedMonsters,
        });
      }
    });

    document.getElementById("btn-pause")?.addEventListener("click", () => {
      this.onPauseGame?.();
    });

    document.getElementById("btn-resume")?.addEventListener("click", () => {
      this.onPauseGame?.();
    });

    // Keyboard shortcut for pause (Escape or P)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
        this.onPauseGame?.();
      }
    });
  }

  private buildCharacterSelectionUI(): void {
    const characterGrid = document.getElementById("character-grid")!;
    const monsterGrid = document.getElementById("monster-grid")!;

    // Build character class cards
    for (const charClass of CHARACTER_CLASSES) {
      const card = document.createElement("div");
      card.className = "character-card";
      card.dataset.classId = charClass.id;

      const spriteContainer = document.createElement("div");
      spriteContainer.className = "sprite-container";

      // Try to load sprite, fallback to color placeholder
      const img = document.createElement("img");
      img.src = charClass.sprite;
      img.alt = charClass.name;
      img.onerror = () => {
        spriteContainer.removeChild(img);
        const placeholder = document.createElement("div");
        placeholder.className = "sprite-placeholder";
        placeholder.style.backgroundColor = `#${charClass.color.toString(16).padStart(6, "0")}`;
        spriteContainer.appendChild(placeholder);
      };
      spriteContainer.appendChild(img);

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = charClass.name;

      const desc = document.createElement("div");
      desc.className = "description";
      desc.textContent = charClass.description;

      const stats = document.createElement("div");
      stats.className = "stats";
      stats.appendChild(this.createStatElement("HP", charClass.stats.hp));
      stats.appendChild(this.createStatElement("ATK", charClass.stats.attack));
      stats.appendChild(this.createStatElement("DEF", charClass.stats.defense));
      stats.appendChild(this.createStatElement("INIT", charClass.stats.initiative));
      stats.appendChild(this.createStatElement("MOV", charClass.stats.moveRange));
      stats.appendChild(this.createStatElement("RNG", charClass.stats.attackRange));

      card.appendChild(spriteContainer);
      card.appendChild(name);
      card.appendChild(desc);
      card.appendChild(stats);

      card.addEventListener("click", () => this.selectClass(charClass));
      characterGrid.appendChild(card);
    }

    // Build monster cards
    for (const monster of MONSTER_TYPES) {
      const card = document.createElement("div");
      card.className = "monster-card";
      card.dataset.monsterId = monster.id;

      const spriteContainer = document.createElement("div");
      spriteContainer.className = "sprite-container";

      const img = document.createElement("img");
      img.src = monster.sprite;
      img.alt = monster.name;
      img.onerror = () => {
        spriteContainer.removeChild(img);
        const placeholder = document.createElement("div");
        placeholder.className = "sprite-placeholder";
        placeholder.style.backgroundColor = `#${monster.color.toString(16).padStart(6, "0")}`;
        spriteContainer.appendChild(placeholder);
      };
      spriteContainer.appendChild(img);

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = monster.name;

      card.appendChild(spriteContainer);
      card.appendChild(name);

      card.addEventListener("click", () => this.toggleMonster(monster));
      monsterGrid.appendChild(card);
    }
  }

  private createStatElement(label: string, value: number): HTMLElement {
    const stat = document.createElement("div");
    stat.className = "stat";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    const valueSpan = document.createElement("span");
    valueSpan.textContent = String(value);
    stat.appendChild(labelSpan);
    stat.appendChild(valueSpan);
    return stat;
  }

  private selectClass(charClass: CharacterClass): void {
    this.selectedClass = charClass;

    // Update UI
    const cards = document.querySelectorAll(".character-card");
    cards.forEach(card => {
      card.classList.toggle("selected", (card as HTMLElement).dataset.classId === charClass.id);
    });

    this.updateStartButton();
  }

  private toggleMonster(monster: MonsterType): void {
    const index = this.selectedMonsters.findIndex(m => m.id === monster.id);

    if (index >= 0) {
      this.selectedMonsters.splice(index, 1);
    } else if (this.selectedMonsters.length < 3) {
      this.selectedMonsters.push(monster);
    }

    // Update UI
    const cards = document.querySelectorAll(".monster-card");
    cards.forEach(card => {
      const monsterId = (card as HTMLElement).dataset.monsterId;
      const isSelected = this.selectedMonsters.some(m => m.id === monsterId);
      card.classList.toggle("selected", isSelected);
    });

    document.getElementById("monster-count")!.textContent = String(this.selectedMonsters.length);
    this.updateStartButton();
  }

  private updateStartButton(): void {
    const btn = document.getElementById("start-battle-btn") as HTMLButtonElement;
    btn.disabled = !this.selectedClass || this.selectedMonsters.length !== 3;
  }

  /**
   * Show character selection screen.
   */
  showCharacterSelect(): void {
    this.startScreen.style.display = "none";
    this.characterSelect.style.display = "flex";
  }

  /**
   * Hide character selection screen.
   */
  hideCharacterSelect(): void {
    this.characterSelect.style.display = "none";
  }

  /**
   * Hide the start screen.
   */
  hideStartScreen(): void {
    this.startScreen.style.display = "none";
  }

  /**
   * Show the start screen.
   */
  showStartScreen(): void {
    this.startScreen.style.display = "flex";
  }

  /**
   * Show the action bar.
   */
  showActionBar(): void {
    this.actionBar.style.display = "flex";
  }

  /**
   * Hide the action bar.
   */
  hideActionBar(): void {
    this.actionBar.style.display = "none";
  }

  /**
   * Update the initiative tracker display.
   */
  updateInitiativeTracker(
    order: ReadonlyArray<InitiativeEntry>,
    units: ReadonlyArray<Unit>,
    currentIndex: number
  ): void {
    // Clear existing entries safely
    while (this.initiativeList.firstChild) {
      this.initiativeList.removeChild(this.initiativeList.firstChild);
    }

    for (let i = 0; i < order.length; i++) {
      const entry = order[i]!;
      const unit = units.find(u => u.id === entry.unitId);

      if (!unit || unit.stats.hp <= 0) continue;

      const div = document.createElement("div");
      div.className = `initiative-entry ${unit.type}`;
      if (i === currentIndex) {
        div.classList.add("active");
      }

      // Create child elements safely
      const nameSpan = document.createElement("span");
      nameSpan.textContent = unit.name;

      const hpSpan = document.createElement("span");
      hpSpan.textContent = `${unit.stats.hp}/${unit.stats.maxHp}`;

      div.appendChild(nameSpan);
      div.appendChild(hpSpan);

      this.initiativeList.appendChild(div);
    }
  }

  /**
   * Show the unit panel with unit info.
   */
  showUnitPanel(unit: Unit): void {
    this.unitPanel.style.display = "block";

    document.getElementById("unit-name")!.textContent = unit.name;
    document.getElementById("unit-hp")!.textContent = `${unit.stats.hp}/${unit.stats.maxHp}`;
    document.getElementById("unit-attack")!.textContent = String(unit.stats.attack);
    document.getElementById("unit-defense")!.textContent = String(unit.stats.defense);

    const hpPercent = (unit.stats.hp / unit.stats.maxHp) * 100;
    (document.getElementById("unit-hp-bar") as HTMLElement).style.width = `${hpPercent}%`;

    // Color based on unit type
    this.unitPanel.style.borderColor = unit.type === "player" ? "#48f" : "#f44";
  }

  /**
   * Hide the unit panel.
   */
  hideUnitPanel(): void {
    this.unitPanel.style.display = "none";
  }

  /**
   * Update action button states.
   */
  updateActionButtons(mode: GameMode, turnState: TurnState | null, hasValidAttackTargets = true): void {
    const moveBtn = document.getElementById("btn-move") as HTMLButtonElement;
    const attackBtn = document.getElementById("btn-attack") as HTMLButtonElement;
    const endBtn = document.getElementById("btn-end-turn") as HTMLButtonElement;

    // Remove active state from all
    moveBtn.classList.remove("active");
    attackBtn.classList.remove("active");

    if (!turnState || mode === "menu" || mode === "waiting") {
      moveBtn.disabled = true;
      attackBtn.disabled = true;
      endBtn.disabled = true;
      return;
    }

    // Enable/disable based on turn state
    moveBtn.disabled = turnState.movementRemaining <= 0;
    // Disable attack if already acted OR no valid targets in range
    attackBtn.disabled = turnState.hasActed || !hasValidAttackTargets;
    endBtn.disabled = false;

    // Set active state
    if (mode === "move") {
      moveBtn.classList.add("active");
    } else if (mode === "attack") {
      attackBtn.classList.add("active");
    }
  }

  /**
   * Add an entry to the combat log.
   */
  addLogEntry(
    message: string,
    type: "damage" | "move" | "turn" | "victory" | "defeat" = "turn"
  ): void {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    entry.textContent = message;

    this.combatLog.appendChild(entry);
    this.combatLog.scrollTop = this.combatLog.scrollHeight;

    // Limit log entries
    while (this.combatLog.children.length > 50) {
      this.combatLog.removeChild(this.combatLog.firstChild!);
    }
  }

  /**
   * Clear the combat log.
   */
  clearLog(): void {
    while (this.combatLog.firstChild) {
      this.combatLog.removeChild(this.combatLog.firstChild);
    }
  }

  /**
   * Update the turn timer display.
   * Pass -1 to hide the timer.
   */
  updateTimer(seconds: number): void {
    if (seconds < 0) {
      this.timerDisplay.style.display = "none";
      return;
    }

    this.timerDisplay.style.display = "flex";
    const timerValue = document.getElementById("timer-value");
    if (timerValue) {
      timerValue.textContent = String(seconds);

      // Change color based on time remaining
      if (seconds <= 5) {
        timerValue.style.color = "#f44";
      } else if (seconds <= 10) {
        timerValue.style.color = "#fa0";
      } else {
        timerValue.style.color = "#4f4";
      }
    }
  }

  /**
   * Show or hide the pause overlay.
   */
  showPauseOverlay(show: boolean): void {
    this.pauseOverlay.style.display = show ? "flex" : "none";
  }
}
