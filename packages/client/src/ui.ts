/**
 * UI management for Rune Forge.
 * Handles DOM updates for initiative tracker, action bar, unit panel, and combat log.
 */

import type { InitiativeEntry, PlayerInventory, TurnState, Unit } from "@rune-forge/simulation";
import { WEAPON_DEFINITIONS } from "@rune-forge/simulation";
import type { GameMode } from "./game.js";
import { CHARACTER_CLASSES, MONSTER_TYPES, type CharacterClass, type MonsterType } from "./characters.js";

export interface CharacterSelection {
  playerClass: CharacterClass;
  monsters: MonsterType[];
}

export type NpcTurnMode = "sequential" | "parallel";

export interface GameSettings {
  gameSpeed: number;
  npcTurnMode: NpcTurnMode;
  defend: boolean;
  equippedWeaponId: string | null;
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
  onSettingsChange: ((settings: GameSettings) => void) | null = null;
  onGrantWeapon: ((weaponId: string) => void) | null = null;
  onGrantGold: ((amount: number) => void) | null = null;
  onBuyWeapon: ((weaponId: string) => void) | null = null;
  onSleep: (() => void) | null = null;

  // DOM elements
  private startScreen: HTMLElement;
  private characterSelect: HTMLElement;
  private initiativeList: HTMLElement;
  private unitPanel: HTMLElement;
  private actionBar: HTMLElement;
  private combatLog: HTMLElement;
  private timerDisplay: HTMLElement;
  private pauseOverlay: HTMLElement;
  private settingsPanel: HTMLElement;
  private inventoryPanel: HTMLElement;
  private dmPanel: HTMLElement;
  private shopPanel: HTMLElement;

  // Current gold for shop display
  private currentGold = 0;

  // Sleep heal amount (DM setting)
  private sleepHealAmount = 5;

  // Selection state
  private selectedClass: CharacterClass | null = null;
  private selectedMonsters: MonsterType[] = [];

  // Settings state
  private settings: GameSettings = {
    gameSpeed: 1.25,
    npcTurnMode: "parallel",
    defend: true,
    equippedWeaponId: null,
  };

  // Available weapons for selection
  private availableWeapons: Array<{ id: string; name: string; damage: number; range: number }> = [];

  constructor() {
    this.startScreen = document.getElementById("start-screen")!;
    this.characterSelect = document.getElementById("character-select")!;
    this.initiativeList = document.getElementById("initiative-list")!;
    this.unitPanel = document.getElementById("unit-panel")!;
    this.actionBar = document.getElementById("action-bar")!;
    this.combatLog = document.getElementById("combat-log")!;
    this.timerDisplay = document.getElementById("turn-timer")!;
    this.pauseOverlay = document.getElementById("pause-overlay")!;
    this.settingsPanel = document.getElementById("settings-panel")!;
    this.inventoryPanel = document.getElementById("inventory-panel")!;
    this.dmPanel = document.getElementById("dm-panel")!;
    this.shopPanel = document.getElementById("shop-panel")!;

    this.setupEventListeners();
    this.buildCharacterSelectionUI();
    this.setupSettingsListeners();
    this.setupDMListeners();
    this.setupShopListeners();
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

    document.getElementById("btn-sleep")?.addEventListener("click", () => {
      this.onSleep?.();
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

    document.getElementById("btn-dm")?.addEventListener("click", () => {
      this.toggleDMPanel();
    });

    document.getElementById("btn-shop")?.addEventListener("click", () => {
      this.toggleShopPanel();
    });

    // Keyboard shortcut for pause (Escape or P)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
        this.onPauseGame?.();
      }
    });

    // Settings button
    document.getElementById("btn-settings")?.addEventListener("click", () => {
      this.toggleSettingsPanel();
    });
  }

  private setupSettingsListeners(): void {
    // Speed selector buttons
    const speedSelector = document.getElementById("speed-selector");
    speedSelector?.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("speed-btn")) {
        const speed = parseFloat(target.dataset.speed || "1");
        this.setGameSpeed(speed);
      }
    });

    // NPC mode toggle
    const npcToggle = document.getElementById("npc-mode-toggle");
    npcToggle?.addEventListener("click", () => {
      this.toggleNpcMode();
    });

    // Defend toggle
    const defendToggle = document.getElementById("defend-toggle");
    defendToggle?.addEventListener("click", () => {
      this.toggleDefend();
    });

    // Close settings when clicking outside
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (
        this.settingsPanel.style.display === "block" &&
        !this.settingsPanel.contains(target) &&
        target.id !== "btn-settings"
      ) {
        this.hideSettingsPanel();
      }
    });
  }

  private setGameSpeed(speed: number): void {
    this.settings.gameSpeed = speed;

    // Update UI
    const buttons = document.querySelectorAll(".speed-btn");
    buttons.forEach(btn => {
      const btnSpeed = parseFloat((btn as HTMLElement).dataset.speed || "0");
      btn.classList.toggle("active", btnSpeed === speed);
    });

    this.onSettingsChange?.(this.settings);
  }

  private toggleNpcMode(): void {
    this.settings.npcTurnMode = this.settings.npcTurnMode === "sequential" ? "parallel" : "sequential";

    // Update UI
    const toggle = document.getElementById("npc-mode-toggle");
    const currentLabel = document.getElementById("npc-mode-current");
    const otherLabel = document.getElementById("npc-mode-other");

    if (this.settings.npcTurnMode === "parallel") {
      toggle?.classList.add("active");
      if (currentLabel) currentLabel.textContent = "Parallel";
      if (otherLabel) otherLabel.textContent = "Click for Sequential";
    } else {
      toggle?.classList.remove("active");
      if (currentLabel) currentLabel.textContent = "Sequential";
      if (otherLabel) otherLabel.textContent = "Click for Parallel";
    }

    this.onSettingsChange?.(this.settings);
  }

  private toggleDefend(): void {
    this.settings.defend = !this.settings.defend;

    // Update UI
    const toggle = document.getElementById("defend-toggle");
    const currentLabel = document.getElementById("defend-current");
    const otherLabel = document.getElementById("defend-other");

    if (this.settings.defend) {
      toggle?.classList.add("active");
      if (currentLabel) currentLabel.textContent = "On";
      if (otherLabel) otherLabel.textContent = "Click to disable";
    } else {
      toggle?.classList.remove("active");
      if (currentLabel) currentLabel.textContent = "Off";
      if (otherLabel) otherLabel.textContent = "Click to enable";
    }

    this.onSettingsChange?.(this.settings);
  }

  /**
   * Update the available weapons for selection.
   */
  updateWeaponOptions(weapons: Array<{ id: string; name: string; damage?: number; range?: number }>, equippedId: string | null): void {
    this.availableWeapons = weapons.map(w => ({
      id: w.id,
      name: w.name,
      damage: w.damage ?? 0,
      range: w.range ?? 1,
    }));
    this.settings.equippedWeaponId = equippedId;
    this.renderWeaponSelector();
    this.renderDMWeaponButtons();
  }

  /**
   * Render the weapon selector dropdown.
   */
  private renderWeaponSelector(): void {
    const container = document.getElementById("weapon-selector");
    if (!container) return;

    // Clear existing content safely
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    if (this.availableWeapons.length === 0) {
      const noWeapons = document.createElement("span");
      noWeapons.className = "no-weapons";
      noWeapons.textContent = "No weapons";
      container.appendChild(noWeapons);
      return;
    }

    // Create dropdown
    const select = document.createElement("select");
    select.id = "weapon-select";
    select.className = "weapon-select";

    // Add "None" option
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "Unarmed";
    select.appendChild(noneOption);

    // Add weapon options
    for (const weapon of this.availableWeapons) {
      const option = document.createElement("option");
      option.value = weapon.id;
      const rangeText = weapon.range > 1 ? `, R${weapon.range}` : "";
      option.textContent = `${weapon.name} (${weapon.damage}${rangeText})`;
      if (weapon.id === this.settings.equippedWeaponId) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      this.settings.equippedWeaponId = select.value || null;
      this.onSettingsChange?.(this.settings);
    });

    container.appendChild(select);
  }

  /**
   * Render the DM weapon grant buttons.
   */
  renderDMWeaponButtons(): void {
    const container = document.getElementById("dm-weapon-buttons");
    if (!container) return;

    // Clear existing buttons
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Create button for each weapon definition
    for (const weapon of WEAPON_DEFINITIONS) {
      const btn = document.createElement("button");
      btn.className = "dm-weapon-btn";

      // Check if player already owns this weapon
      const isOwned = this.availableWeapons.some(w => w.name === weapon.name);
      if (isOwned) {
        btn.classList.add("owned");
      }

      const nameSpan = document.createElement("span");
      nameSpan.textContent = weapon.name;
      btn.appendChild(nameSpan);

      const statsSpan = document.createElement("span");
      statsSpan.className = "bonus";
      statsSpan.textContent = `${weapon.damage} dmg${weapon.range > 1 ? `, ${weapon.range} rng` : ""}`;
      btn.appendChild(statsSpan);

      if (!isOwned) {
        btn.addEventListener("click", () => {
          this.onGrantWeapon?.(weapon.id);
        });
      }

      container.appendChild(btn);
    }
  }

  /**
   * Toggle the settings panel visibility.
   */
  toggleSettingsPanel(): void {
    this.hideDMPanel();
    this.hideShopPanel();
    if (this.settingsPanel.style.display === "block") {
      this.hideSettingsPanel();
    } else {
      this.showSettingsPanel();
    }
  }

  /**
   * Show the settings panel.
   */
  showSettingsPanel(): void {
    this.settingsPanel.style.display = "block";
  }

  /**
   * Hide the settings panel.
   */
  hideSettingsPanel(): void {
    this.settingsPanel.style.display = "none";
  }

  /**
   * Toggle the DM panel visibility.
   */
  toggleDMPanel(): void {
    this.hideSettingsPanel();
    this.hideShopPanel();
    if (this.dmPanel.style.display === "block") {
      this.hideDMPanel();
    } else {
      this.showDMPanel();
    }
  }

  showDMPanel(): void {
    this.dmPanel.style.display = "block";
  }

  hideDMPanel(): void {
    this.dmPanel.style.display = "none";
  }

  /**
   * Toggle the shop panel visibility.
   */
  toggleShopPanel(): void {
    this.hideSettingsPanel();
    this.hideDMPanel();
    if (this.shopPanel.style.display === "block") {
      this.hideShopPanel();
    } else {
      this.showShopPanel();
    }
  }

  showShopPanel(): void {
    this.shopPanel.style.display = "block";
    this.renderShopItems();
  }

  hideShopPanel(): void {
    this.shopPanel.style.display = "none";
  }

  /**
   * Enable or disable the shop button based on player proximity.
   */
  setShopEnabled(enabled: boolean): void {
    const btn = document.getElementById("btn-shop") as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = !enabled;
      btn.style.opacity = enabled ? "1" : "0.4";
    }
  }

  /**
   * Get the sleep heal amount (DM setting).
   */
  getSleepHealAmount(): number {
    return this.sleepHealAmount;
  }

  /**
   * Setup DM panel listeners.
   */
  private setupDMListeners(): void {
    // Gold grant buttons
    document.querySelectorAll(".dm-gold-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const amount = parseInt((btn as HTMLElement).dataset.amount || "0", 10);
        this.onGrantGold?.(amount);
      });
    });

    // Sleep heal input
    const sleepHealInput = document.getElementById("dm-sleep-heal") as HTMLInputElement | null;
    if (sleepHealInput) {
      sleepHealInput.addEventListener("change", () => {
        this.sleepHealAmount = parseInt(sleepHealInput.value, 10) || 5;
      });
    }
  }

  /**
   * Setup shop panel listeners.
   */
  private setupShopListeners(): void {
    // Shop items are rendered dynamically
  }

  /**
   * Update the shop gold display.
   */
  updateShopGold(gold: number): void {
    this.currentGold = gold;
    const goldDisplay = document.getElementById("shop-gold-display");
    if (goldDisplay) {
      goldDisplay.textContent = gold.toString();
    }
  }

  /**
   * Render shop items with buy buttons.
   */
  renderShopItems(): void {
    const container = document.getElementById("shop-weapon-list");
    if (!container) return;

    // Clear existing items
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Update gold display
    const goldDisplay = document.getElementById("shop-gold-display");
    if (goldDisplay) {
      goldDisplay.textContent = this.currentGold.toString();
    }

    // Create item for each weapon
    for (const weapon of WEAPON_DEFINITIONS) {
      const item = document.createElement("div");
      item.className = "shop-item";

      const info = document.createElement("div");
      info.className = "shop-item-info";

      const name = document.createElement("span");
      name.className = "shop-item-name";
      name.textContent = weapon.name;
      info.appendChild(name);

      const stats = document.createElement("span");
      stats.className = "shop-item-bonus";
      const rangeText = weapon.range > 1 ? ` | Range ${weapon.range}` : "";
      stats.textContent = `${weapon.damage} Dmg${rangeText}`;
      info.appendChild(stats);

      item.appendChild(info);

      const btn = document.createElement("button");
      btn.className = "shop-buy-btn";

      // Check if player already owns this weapon
      const isOwned = this.availableWeapons.some(w => w.name === weapon.name);
      const canAfford = this.currentGold >= weapon.price;

      if (isOwned) {
        btn.textContent = "Owned";
        btn.classList.add("owned");
        btn.disabled = true;
      } else if (!canAfford) {
        btn.textContent = `${weapon.price}g`;
        btn.disabled = true;
      } else {
        btn.textContent = `${weapon.price}g`;
        btn.addEventListener("click", () => {
          this.onBuyWeapon?.(weapon.id);
        });
      }

      item.appendChild(btn);
      container.appendChild(item);
    }
  }

  /**
   * Get current settings.
   */
  getSettings(): GameSettings {
    return { ...this.settings };
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
   * Groups monsters to avoid long lists, shows current turn + players + monster summary.
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

    // Get alive units in initiative order
    const aliveUnits: Array<{ unit: Unit; index: number }> = [];
    for (let i = 0; i < order.length; i++) {
      const entry = order[i]!;
      const unit = units.find(u => u.id === entry.unitId);
      if (unit && unit.stats.hp > 0) {
        aliveUnits.push({ unit, index: i });
      }
    }

    // Separate players and monsters
    const players = aliveUnits.filter(e => e.unit.type === "player");
    const monsters = aliveUnits.filter(e => e.unit.type === "monster");

    // Always show the current turn unit first (highlighted)
    const currentEntry = aliveUnits.find(e => e.index === currentIndex);
    if (currentEntry) {
      const div = this.createInitiativeEntry(currentEntry.unit, true);
      this.initiativeList.appendChild(div);
    }

    // Show all players (except if already shown as current)
    for (const entry of players) {
      if (entry.index === currentIndex) continue;
      const div = this.createInitiativeEntry(entry.unit, false);
      this.initiativeList.appendChild(div);
    }

    // Group monsters by type and show summary
    if (monsters.length > 0) {
      const monsterCounts = new Map<string, { count: number; totalHp: number; maxHp: number }>();
      for (const entry of monsters) {
        if (entry.index === currentIndex) continue; // Already shown
        const name = entry.unit.name;
        const existing = monsterCounts.get(name);
        if (existing) {
          existing.count++;
          existing.totalHp += entry.unit.stats.hp;
          existing.maxHp += entry.unit.stats.maxHp;
        } else {
          monsterCounts.set(name, {
            count: 1,
            totalHp: entry.unit.stats.hp,
            maxHp: entry.unit.stats.maxHp,
          });
        }
      }

      // Show grouped monster entries
      for (const [name, data] of monsterCounts) {
        const div = document.createElement("div");
        div.className = "initiative-entry monster grouped";

        const nameSpan = document.createElement("span");
        nameSpan.className = "init-name";
        nameSpan.textContent = data.count > 1 ? `${name} ×${data.count}` : name;

        const hpSpan = document.createElement("span");
        hpSpan.className = "init-hp";
        hpSpan.textContent = ` ${data.totalHp}/${data.maxHp}`; // Added space prefix

        div.appendChild(nameSpan);
        div.appendChild(hpSpan);
        this.initiativeList.appendChild(div);
      }
    }
  }

  /**
   * Create a single initiative entry div.
   */
  private createInitiativeEntry(unit: Unit, isActive: boolean): HTMLDivElement {
    const div = document.createElement("div");
    div.className = `initiative-entry ${unit.type}`;
    if (isActive) {
      div.classList.add("active");
    }

    const nameSpan = document.createElement("span");
    nameSpan.textContent = unit.name;

    const hpSpan = document.createElement("span");
    hpSpan.textContent = `${unit.stats.hp}/${unit.stats.maxHp}`;

    div.appendChild(nameSpan);
    div.appendChild(hpSpan);

    return div;
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
    type: "damage" | "move" | "turn" | "victory" | "defeat" | "system" = "turn"
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

  /**
   * Update the inventory display.
   */
  updateInventory(inventory: PlayerInventory): void {
    if (!this.inventoryPanel) return;

    // Show the panel
    this.inventoryPanel.style.display = "block";

    // Update gold display
    const goldEl = document.getElementById("inventory-gold");
    if (goldEl) goldEl.textContent = String(inventory.gold);

    // Update silver display
    const silverEl = document.getElementById("inventory-silver");
    if (silverEl) silverEl.textContent = String(inventory.silver);

    // Update equipped weapon display
    const weaponEl = document.getElementById("inventory-weapon");
    if (weaponEl) {
      if (inventory.equippedWeaponId) {
        const weapon = inventory.weapons.find(w => w.id === inventory.equippedWeaponId);
        if (weapon) {
          const rangeText = weapon.range && weapon.range > 1 ? `, ${weapon.range} range` : "";
          weaponEl.textContent = `${weapon.name} (${weapon.damage || 0} dmg${rangeText})`;
        } else {
          weaponEl.textContent = "None";
        }
      } else {
        weaponEl.textContent = "None";
      }
    }
  }

  /**
   * Hide the inventory panel.
   */
  hideInventory(): void {
    if (this.inventoryPanel) {
      this.inventoryPanel.style.display = "none";
    }
  }
}
