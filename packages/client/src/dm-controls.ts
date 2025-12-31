/**
 * Unified DM Controls Panel
 *
 * Provides all game master controls in a single tabbed interface.
 * Only visible to the DM of the session.
 */

import type { Unit, Position } from "@rune-forge/simulation";
import type { DMCommand } from "@rune-forge/shared";

// =============================================================================
// Types
// =============================================================================

export interface DMControlsOptions {
  onCommand: (command: DMCommand) => void;
  onGrantGold?: (amount: number) => void;
  onGiveWeapon?: (weaponId: string) => void;
  onClose?: () => void;
}

export interface PlayerInfo {
  id: string;
  name: string;
  unitId?: string;
}

type TabName = "game" | "players" | "monsters" | "settings";

// =============================================================================
// DOM Helper
// =============================================================================

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "className") {
        element.className = value;
      } else {
        element.setAttribute(key, value);
      }
    }
  }
  for (const child of children) {
    if (typeof child === "string") {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  }
  return element;
}

// =============================================================================
// DM Controls Class
// =============================================================================

export class DMControls {
  private container: HTMLDivElement;
  private options: DMControlsOptions;
  private players: PlayerInfo[] = [];
  private monsters: Unit[] = [];
  private isExpanded: boolean = true;
  private isPaused: boolean = false;
  private activeTab: TabName = "game";
  private sleepHealAmount: number = 5;
  private tabContents: Map<TabName, HTMLDivElement> = new Map();

  constructor(parentContainer: HTMLElement, options: DMControlsOptions) {
    this.options = options;
    this.container = this.createContainer();
    parentContainer.appendChild(this.container);
    this.injectStyles();
  }

  private createContainer(): HTMLDivElement {
    const container = el("div", { className: "dm-controls-container" });

    // Header with collapse toggle
    const header = el("div", { className: "dm-controls-header" });
    const title = el("span", { className: "dm-controls-title" }, "DM Controls");
    const toggleBtn = el("button", { className: "dm-controls-toggle" }, "▲");
    header.appendChild(title);
    header.appendChild(toggleBtn);
    container.appendChild(header);

    // Tab bar
    const tabBar = el("div", { className: "dm-tabs" });
    const tabs: { name: TabName; icon: string; label: string }[] = [
      { name: "game", icon: "🎮", label: "Game" },
      { name: "players", icon: "👥", label: "Players" },
      { name: "monsters", icon: "👾", label: "Monsters" },
      { name: "settings", icon: "⚙️", label: "Settings" },
    ];

    for (const tab of tabs) {
      const tabBtn = el("button", {
        className: `dm-tab${tab.name === this.activeTab ? " active" : ""}`,
        "data-tab": tab.name,
      }, `${tab.icon} ${tab.label}`);
      tabBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.switchTab(tab.name);
      });
      tabBar.appendChild(tabBtn);
    }
    container.appendChild(tabBar);

    // Content area
    const content = el("div", { className: "dm-controls-content" });

    // Create tab contents
    const gameTab = this.createGameTab();
    const playersTab = this.createPlayersTab();
    const monstersTab = this.createMonstersTab();
    const settingsTab = this.createSettingsTab();

    this.tabContents.set("game", gameTab);
    this.tabContents.set("players", playersTab);
    this.tabContents.set("monsters", monstersTab);
    this.tabContents.set("settings", settingsTab);

    content.appendChild(gameTab);
    content.appendChild(playersTab);
    content.appendChild(monstersTab);
    content.appendChild(settingsTab);

    // Show initial tab
    this.showTab(this.activeTab);

    container.appendChild(content);

    // Event listeners
    header.addEventListener("click", () => this.toggle());

    return container;
  }

  private createGameTab(): HTMLDivElement {
    const tab = el("div", { className: "dm-tab-content", "data-tab-content": "game" });

    // Pause/Resume
    const pauseSection = el("div", { className: "dm-section" });
    pauseSection.appendChild(el("div", { className: "dm-section-title" }, "Game Control"));
    const pauseRow = el("div", { className: "dm-button-row" });
    pauseRow.appendChild(this.createButton("Pause", () => this.togglePause(), "primary", "dm-pause-btn"));
    pauseRow.appendChild(this.createButton("End Game", () => this.endGame(), "danger"));
    pauseSection.appendChild(pauseRow);
    tab.appendChild(pauseSection);

    // Quick Actions
    const quickSection = el("div", { className: "dm-section" });
    quickSection.appendChild(el("div", { className: "dm-section-title" }, "Quick Actions"));
    const quickRow = el("div", { className: "dm-button-row" });
    quickRow.appendChild(this.createButton("Skip Turn", () => this.skipTurn()));
    quickRow.appendChild(this.createButton("Heal All", () => this.healAllPlayers()));
    quickSection.appendChild(quickRow);
    tab.appendChild(quickSection);

    return tab;
  }

  private createPlayersTab(): HTMLDivElement {
    const tab = el("div", { className: "dm-tab-content", "data-tab-content": "players" });

    // Player select
    const selectSection = el("div", { className: "dm-section" });
    selectSection.appendChild(el("div", { className: "dm-section-title" }, "Target Player"));
    const selectRow = el("div", { className: "dm-input-row" });
    const playerSelect = el("select", { className: "dm-select", id: "dm-player-select" }) as HTMLSelectElement;
    playerSelect.appendChild(el("option", { value: "" }, "Select player..."));
    selectRow.appendChild(playerSelect);
    selectSection.appendChild(selectRow);
    tab.appendChild(selectSection);

    // Grant Gold
    const goldSection = el("div", { className: "dm-section" });
    goldSection.appendChild(el("div", { className: "dm-section-title" }, "Grant Gold"));
    const goldBtnRow = el("div", { className: "dm-button-row" });
    goldBtnRow.appendChild(this.createButton("+10", () => this.grantGoldAmount(10), "gold"));
    goldBtnRow.appendChild(this.createButton("+50", () => this.grantGoldAmount(50), "gold"));
    goldBtnRow.appendChild(this.createButton("+100", () => this.grantGoldAmount(100), "gold"));
    goldSection.appendChild(goldBtnRow);

    const goldCustomRow = el("div", { className: "dm-input-row" });
    const goldInput = el("input", {
      type: "number",
      className: "dm-input",
      id: "dm-gold-amount",
      value: "100",
      min: "1",
      max: "10000",
      placeholder: "Amount"
    }) as HTMLInputElement;
    goldCustomRow.appendChild(goldInput);
    goldCustomRow.appendChild(this.createButton("Grant", () => this.grantGold()));
    goldSection.appendChild(goldCustomRow);
    tab.appendChild(goldSection);

    // Grant XP
    const xpSection = el("div", { className: "dm-section" });
    xpSection.appendChild(el("div", { className: "dm-section-title" }, "Grant XP"));
    const xpRow = el("div", { className: "dm-input-row" });
    const xpInput = el("input", {
      type: "number",
      className: "dm-input",
      id: "dm-xp-amount",
      value: "50",
      min: "1",
      max: "10000",
      placeholder: "Amount"
    }) as HTMLInputElement;
    xpRow.appendChild(xpInput);
    xpRow.appendChild(this.createButton("Grant XP", () => this.grantXP()));
    xpSection.appendChild(xpRow);
    tab.appendChild(xpSection);

    // Kick Player
    const kickSection = el("div", { className: "dm-section" });
    kickSection.appendChild(el("div", { className: "dm-section-title" }, "Manage"));
    const kickRow = el("div", { className: "dm-button-row" });
    kickRow.appendChild(this.createButton("Kick Player", () => this.kickPlayer(), "danger"));
    kickRow.appendChild(this.createButton("Heal Player", () => this.healSelectedPlayer()));
    kickSection.appendChild(kickRow);
    tab.appendChild(kickSection);

    return tab;
  }

  private createMonstersTab(): HTMLDivElement {
    const tab = el("div", { className: "dm-tab-content", "data-tab-content": "monsters" });

    // Spawn Monster
    const spawnSection = el("div", { className: "dm-section" });
    spawnSection.appendChild(el("div", { className: "dm-section-title" }, "Spawn Monster"));

    const typeRow = el("div", { className: "dm-input-row" });
    typeRow.appendChild(el("label", {}, "Type:"));
    const monsterTypeSelect = el("select", { className: "dm-select", id: "dm-monster-type" }) as HTMLSelectElement;
    monsterTypeSelect.appendChild(el("option", { value: "goblin" }, "Goblin"));
    monsterTypeSelect.appendChild(el("option", { value: "skeleton" }, "Skeleton"));
    monsterTypeSelect.appendChild(el("option", { value: "orc" }, "Orc"));
    monsterTypeSelect.appendChild(el("option", { value: "troll" }, "Troll"));
    monsterTypeSelect.appendChild(el("option", { value: "imp" }, "Imp"));
    typeRow.appendChild(monsterTypeSelect);
    spawnSection.appendChild(typeRow);

    const posRow = el("div", { className: "dm-input-row" });
    posRow.appendChild(el("label", {}, "Position:"));
    const xInput = el("input", {
      type: "number",
      className: "dm-input dm-input-small",
      id: "dm-spawn-x",
      value: "5",
      min: "-50",
      max: "50"
    }) as HTMLInputElement;
    const yInput = el("input", {
      type: "number",
      className: "dm-input dm-input-small",
      id: "dm-spawn-y",
      value: "5",
      min: "-50",
      max: "50"
    }) as HTMLInputElement;
    posRow.appendChild(xInput);
    posRow.appendChild(el("span", { className: "dm-separator" }, ","));
    posRow.appendChild(yInput);
    posRow.appendChild(this.createButton("Spawn", () => this.spawnMonster(), "primary"));
    spawnSection.appendChild(posRow);
    tab.appendChild(spawnSection);

    // Manage Monsters
    const manageSection = el("div", { className: "dm-section" });
    manageSection.appendChild(el("div", { className: "dm-section-title" }, "Manage Monster"));

    const monsterRow = el("div", { className: "dm-input-row" });
    const monsterSelect = el("select", { className: "dm-select", id: "dm-monster-select" }) as HTMLSelectElement;
    monsterSelect.appendChild(el("option", { value: "" }, "Select monster..."));
    monsterRow.appendChild(monsterSelect);
    manageSection.appendChild(monsterRow);

    const actionRow = el("div", { className: "dm-button-row" });
    actionRow.appendChild(this.createButton("Remove", () => this.removeMonster(), "danger"));
    actionRow.appendChild(this.createButton("Heal Full", () => this.healMonster()));
    actionRow.appendChild(this.createButton("Damage", () => this.damageMonster()));
    manageSection.appendChild(actionRow);
    tab.appendChild(manageSection);

    return tab;
  }

  private createSettingsTab(): HTMLDivElement {
    const tab = el("div", { className: "dm-tab-content", "data-tab-content": "settings" });

    // Combat Settings
    const combatSection = el("div", { className: "dm-section" });
    combatSection.appendChild(el("div", { className: "dm-section-title" }, "Combat Settings"));

    const sleepRow = el("div", { className: "dm-input-row" });
    sleepRow.appendChild(el("label", {}, "Sleep Heal:"));
    const sleepInput = el("input", {
      type: "number",
      className: "dm-input",
      id: "dm-sleep-heal",
      value: String(this.sleepHealAmount),
      min: "0",
      max: "100"
    }) as HTMLInputElement;
    sleepInput.addEventListener("change", () => {
      this.sleepHealAmount = parseInt(sleepInput.value, 10) || 5;
    });
    sleepRow.appendChild(sleepInput);
    sleepRow.appendChild(el("span", { className: "dm-hint" }, "HP"));
    combatSection.appendChild(sleepRow);

    tab.appendChild(combatSection);

    // Difficulty
    const diffSection = el("div", { className: "dm-section" });
    diffSection.appendChild(el("div", { className: "dm-section-title" }, "Difficulty Modifiers"));

    const dmgRow = el("div", { className: "dm-input-row" });
    dmgRow.appendChild(el("label", {}, "Monster Dmg:"));
    const dmgSelect = el("select", { className: "dm-select", id: "dm-monster-damage-mod" }) as HTMLSelectElement;
    dmgSelect.appendChild(el("option", { value: "0.5" }, "Half (Easy)"));
    dmgSelect.appendChild(el("option", { value: "1", selected: "selected" }, "Normal"));
    dmgSelect.appendChild(el("option", { value: "1.5" }, "1.5x (Hard)"));
    dmgSelect.appendChild(el("option", { value: "2" }, "2x (Brutal)"));
    dmgRow.appendChild(dmgSelect);
    diffSection.appendChild(dmgRow);

    tab.appendChild(diffSection);

    return tab;
  }

  private switchTab(tabName: TabName): void {
    this.activeTab = tabName;

    // Update tab buttons
    this.container.querySelectorAll(".dm-tab").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
    });

    // Show/hide tab contents
    this.showTab(tabName);
  }

  private showTab(tabName: TabName): void {
    this.tabContents.forEach((content, name) => {
      content.style.display = name === tabName ? "block" : "none";
    });
  }

  private createButton(label: string, onClick: () => void, variant?: string, id?: string): HTMLButtonElement {
    const attrs: Record<string, string> = {
      className: `dm-btn${variant ? ` dm-btn-${variant}` : ""}`
    };
    if (id) attrs.id = id;

    const btn = el("button", attrs, label) as HTMLButtonElement;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private injectStyles(): void {
    if (document.getElementById("dm-controls-styles")) return;

    const style = document.createElement("style");
    style.id = "dm-controls-styles";
    style.textContent = `
      .dm-controls-container {
        position: fixed;
        top: 0;
        right: 16px;
        width: 340px;
        background: rgba(26, 26, 46, 0.98);
        border: 2px solid #ffd700;
        border-top: none;
        border-radius: 0 0 12px 12px;
        z-index: 100;
        display: flex;
        flex-direction: column;
        transition: transform 0.3s ease;
        max-height: 90vh;
      }

      .dm-controls-container.collapsed {
        transform: translateY(calc(-100% + 44px));
      }

      .dm-controls-header {
        display: flex;
        align-items: center;
        padding: 10px 16px;
        background: linear-gradient(135deg, #3a3a5e, #2a2a4e);
        cursor: pointer;
        user-select: none;
        border-bottom: 1px solid #ffd700;
      }

      .dm-controls-title {
        flex: 1;
        color: #ffd700;
        font-weight: bold;
        font-size: 15px;
      }

      .dm-controls-toggle {
        background: none;
        border: none;
        color: #ffd700;
        font-size: 14px;
        cursor: pointer;
        padding: 4px 8px;
        transition: transform 0.3s ease;
      }

      .dm-controls-container.collapsed .dm-controls-toggle {
        transform: rotate(180deg);
      }

      .dm-tabs {
        display: flex;
        background: #1a1a2e;
        border-bottom: 1px solid #3a3a5e;
      }

      .dm-tab {
        flex: 1;
        padding: 10px 8px;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: #888;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .dm-tab:hover {
        background: rgba(255, 215, 0, 0.1);
        color: #ccc;
      }

      .dm-tab.active {
        background: rgba(255, 215, 0, 0.15);
        color: #ffd700;
        border-bottom-color: #ffd700;
      }

      .dm-controls-content {
        padding: 12px;
        overflow-y: auto;
        max-height: calc(90vh - 100px);
      }

      .dm-tab-content {
        display: none;
      }

      .dm-section {
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid #3a3a5e;
      }

      .dm-section:last-child {
        margin-bottom: 0;
        border-bottom: none;
      }

      .dm-section-title {
        color: #a0a0c0;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 10px;
      }

      .dm-button-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .dm-input-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }

      .dm-input-row:last-child {
        margin-bottom: 0;
      }

      .dm-input-row label {
        color: #a0a0c0;
        font-size: 12px;
        min-width: 70px;
      }

      .dm-btn {
        padding: 8px 14px;
        background: #3a3a5e;
        border: 1px solid #5a5a8e;
        border-radius: 6px;
        color: #e0e0e0;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .dm-btn:hover {
        background: #4a4a6e;
        transform: translateY(-1px);
      }

      .dm-btn:active {
        transform: translateY(0);
      }

      .dm-btn-primary {
        background: #2a5a8e;
        border-color: #3a7abe;
      }

      .dm-btn-primary:hover {
        background: #3a6a9e;
      }

      .dm-btn-danger {
        background: #5e3a3a;
        border-color: #8e5a5a;
      }

      .dm-btn-danger:hover {
        background: #6e4a4a;
      }

      .dm-btn-gold {
        background: linear-gradient(135deg, #8b6914, #a67c00);
        border-color: #d4a017;
        color: #fff;
      }

      .dm-btn-gold:hover {
        background: linear-gradient(135deg, #a67c00, #c9960c);
      }

      .dm-select {
        flex: 1;
        padding: 8px 10px;
        background: #2a2a4e;
        border: 1px solid #3a3a5e;
        border-radius: 6px;
        color: #e0e0e0;
        font-size: 12px;
      }

      .dm-input {
        width: 70px;
        padding: 8px 10px;
        background: #2a2a4e;
        border: 1px solid #3a3a5e;
        border-radius: 6px;
        color: #e0e0e0;
        font-size: 12px;
      }

      .dm-input-small {
        width: 50px;
      }

      .dm-input:focus, .dm-select:focus {
        outline: none;
        border-color: #ffd700;
      }

      .dm-separator {
        color: #666;
      }

      .dm-hint {
        color: #666;
        font-size: 11px;
        margin-left: 4px;
      }

      /* Hide when collapsed */
      .dm-controls-container.collapsed .dm-tabs,
      .dm-controls-container.collapsed .dm-controls-content {
        opacity: 0;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  toggle(): void {
    this.isExpanded = !this.isExpanded;
    this.container.classList.toggle("collapsed", !this.isExpanded);
  }

  expand(): void {
    this.isExpanded = true;
    this.container.classList.remove("collapsed");
  }

  collapse(): void {
    this.isExpanded = false;
    this.container.classList.add("collapsed");
  }

  updatePlayers(players: PlayerInfo[]): void {
    this.players = players;
    const select = this.container.querySelector("#dm-player-select") as HTMLSelectElement;
    if (select) {
      const currentValue = select.value;

      while (select.firstChild) {
        select.removeChild(select.firstChild);
      }
      select.appendChild(el("option", { value: "" }, "Select player..."));

      for (const player of players) {
        select.appendChild(el("option", { value: player.id }, player.name));
      }

      if (players.some(p => p.id === currentValue)) {
        select.value = currentValue;
      }
    }
  }

  updateMonsters(monsters: ReadonlyArray<Unit>): void {
    this.monsters = monsters.filter(u => u.type === "monster" && u.stats.hp > 0);
    const select = this.container.querySelector("#dm-monster-select") as HTMLSelectElement;
    if (select) {
      const currentValue = select.value;

      while (select.firstChild) {
        select.removeChild(select.firstChild);
      }
      select.appendChild(el("option", { value: "" }, "Select monster..."));

      for (const monster of this.monsters) {
        const label = `${monster.name} (${monster.stats.hp}/${monster.stats.maxHp} HP)`;
        select.appendChild(el("option", { value: monster.id }, label));
      }

      if (this.monsters.some(m => m.id === currentValue)) {
        select.value = currentValue;
      }
    }
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
    const pauseBtn = this.container.querySelector("#dm-pause-btn");
    if (pauseBtn) {
      pauseBtn.textContent = paused ? "Resume" : "Pause";
    }
  }

  getSleepHealAmount(): number {
    return this.sleepHealAmount;
  }

  destroy(): void {
    this.container.remove();
  }

  // ===========================================================================
  // Command Methods
  // ===========================================================================

  private getSelectedPlayer(): string | null {
    const select = this.container.querySelector("#dm-player-select") as HTMLSelectElement;
    return select?.value || null;
  }

  private getSelectedMonster(): string | null {
    const select = this.container.querySelector("#dm-monster-select") as HTMLSelectElement;
    return select?.value || null;
  }

  private togglePause(): void {
    if (this.isPaused) {
      this.options.onCommand({ command: "resume_game" });
    } else {
      this.options.onCommand({ command: "pause_game" });
    }
  }

  private endGame(): void {
    if (confirm("Are you sure you want to end the game?")) {
      this.options.onCommand({ command: "end_game" });
    }
  }

  private skipTurn(): void {
    this.options.onCommand({ command: "skip_turn" });
  }

  private healAllPlayers(): void {
    this.options.onCommand({ command: "heal_all_players" });
  }

  private grantGoldAmount(amount: number): void {
    const playerId = this.getSelectedPlayer();
    if (!playerId) {
      alert("Please select a player first");
      return;
    }

    this.options.onCommand({
      command: "grant_gold",
      targetUserId: playerId,
      amount,
    });
  }

  private grantGold(): void {
    const playerId = this.getSelectedPlayer();
    if (!playerId) {
      alert("Please select a player");
      return;
    }

    const input = this.container.querySelector("#dm-gold-amount") as HTMLInputElement;
    const amount = parseInt(input?.value || "100", 10);

    if (amount <= 0) {
      alert("Amount must be positive");
      return;
    }

    this.options.onCommand({
      command: "grant_gold",
      targetUserId: playerId,
      amount,
    });
  }

  private grantXP(): void {
    const playerId = this.getSelectedPlayer();
    if (!playerId) {
      alert("Please select a player");
      return;
    }

    const input = this.container.querySelector("#dm-xp-amount") as HTMLInputElement;
    const amount = parseInt(input?.value || "50", 10);

    if (amount <= 0) {
      alert("Amount must be positive");
      return;
    }

    this.options.onCommand({
      command: "grant_xp",
      targetUserId: playerId,
      amount,
    });
  }

  private kickPlayer(): void {
    const playerId = this.getSelectedPlayer();
    if (!playerId) {
      alert("Please select a player");
      return;
    }

    const player = this.players.find(p => p.id === playerId);
    if (confirm(`Kick ${player?.name ?? "this player"} from the game?`)) {
      this.options.onCommand({
        command: "kick_player",
        targetUserId: playerId,
      });
    }
  }

  private healSelectedPlayer(): void {
    const playerId = this.getSelectedPlayer();
    if (!playerId) {
      alert("Please select a player");
      return;
    }

    this.options.onCommand({
      command: "heal_player",
      targetUserId: playerId,
    });
  }

  private spawnMonster(): void {
    const typeSelect = this.container.querySelector("#dm-monster-type") as HTMLSelectElement;
    const xInput = this.container.querySelector("#dm-spawn-x") as HTMLInputElement;
    const yInput = this.container.querySelector("#dm-spawn-y") as HTMLInputElement;

    const monsterType = typeSelect?.value || "goblin";
    const x = parseInt(xInput?.value || "5", 10);
    const y = parseInt(yInput?.value || "5", 10);

    this.options.onCommand({
      command: "spawn_monster",
      monsterType,
      position: { x, y },
    });
  }

  private removeMonster(): void {
    const unitId = this.getSelectedMonster();
    if (!unitId) {
      alert("Please select a monster");
      return;
    }

    this.options.onCommand({
      command: "remove_monster",
      unitId,
    });
  }

  private healMonster(): void {
    const unitId = this.getSelectedMonster();
    if (!unitId) {
      alert("Please select a monster");
      return;
    }

    const monster = this.monsters.find(m => m.id === unitId);
    if (monster) {
      this.options.onCommand({
        command: "modify_monster",
        unitId,
        stats: { hp: monster.stats.maxHp },
      });
    }
  }

  private damageMonster(): void {
    const unitId = this.getSelectedMonster();
    if (!unitId) {
      alert("Please select a monster");
      return;
    }

    const amount = prompt("Damage amount:", "10");
    if (amount) {
      const damage = parseInt(amount, 10);
      if (damage > 0) {
        const monster = this.monsters.find(m => m.id === unitId);
        if (monster) {
          const newHp = Math.max(0, monster.stats.hp - damage);
          this.options.onCommand({
            command: "modify_monster",
            unitId,
            stats: { hp: newHp },
          });
        }
      }
    }
  }
}
