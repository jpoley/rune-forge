/**
 * Screen State Machine
 *
 * Manages UI transitions and screen-specific rendering for multiplayer mode.
 * Each screen has its own enter/exit handlers and UI elements.
 */

import type { MultiplayerState, MultiplayerScreen, LobbyPlayer } from "./multiplayer.js";
import type { ConnectionStatus } from "./ws.js";
import { CHARACTER_CLASSES, MONSTER_TYPES, type MonsterType } from "./characters.js";
import { selectCharacter } from "./character-creator.js";
import type { LocalCharacter } from "./db/character-db.js";

// =============================================================================
// Class Display Mapping (server classes -> display info)
// =============================================================================

/** Build CLASS_DISPLAY dynamically from CHARACTER_CLASSES */
function buildClassDisplay(): Record<string, { name: string; sprite: string; color: number; description: string }> {
  const display: Record<string, { name: string; sprite: string; color: number; description: string }> = {};
  for (const charClass of CHARACTER_CLASSES) {
    display[charClass.id] = {
      name: charClass.name,
      sprite: charClass.sprite,
      color: charClass.color,
      description: charClass.description.substring(0, 30),
    };
  }
  return display;
}
const CLASS_DISPLAY = buildClassDisplay();

// =============================================================================
// NPC Class Options (for party building)
// =============================================================================

/** Available NPC classes for party building */
export const NPC_CLASS_OPTIONS = [
  { name: "warrior", display: "Warrior", description: "High HP, good defense, melee" },
  { name: "archer", display: "Archer", description: "Ranged attacks, high initiative" },
  { name: "mage", display: "Mage", description: "High damage, long range, fragile" },
  { name: "cleric", display: "Cleric", description: "Balanced support, melee" },
  { name: "rogue", display: "Rogue", description: "Fast, high damage, melee" },
] as const;

// =============================================================================
// Types
// =============================================================================

/** Screen transition handler */
interface ScreenHandler {
  enter(state: MultiplayerState): void;
  exit(): void;
  update?(state: MultiplayerState): void;
}

/** Character info */
export interface CharacterInfo {
  id: string;
  name: string;
  class: string;
  level: number;
}

/** Game creation config */
export interface GameConfig {
  maxPlayers: number;
  difficulty: "easy" | "normal" | "hard";
  npcCount: number;
  npcClasses?: string[];
  monsterCount?: number;
  playerMoveRange?: number;
}

/** Screen manager callbacks */
export interface ScreenManagerCallbacks {
  onLogin: () => void;
  onDevLogin: (name: string) => void;
  onLogout: () => void;
  onCreateGame: (characterId: string, config?: GameConfig) => void;
  onJoinGame: (joinCode: string, characterId: string) => void;
  onLeaveGame: () => void;
  onSetReady: (ready: boolean) => void;
  onStartGame: (monsterTypes: string[]) => void;
  onNavigateToPartySetup: () => void;
  onBackToMainMenu: () => void;
  // Character management
  onFetchCharacters: () => Promise<CharacterInfo[]>;
  onCreateCharacter: (name: string, characterClass: string) => Promise<CharacterInfo>;
}

// =============================================================================
// DOM Element IDs
// =============================================================================

const ELEMENTS = {
  // Container screens
  loginScreen: "login-screen",
  mainMenuScreen: "main-menu-screen",
  lobbyScreen: "lobby-screen",
  loadingScreen: "loading-screen",
  gameContainer: "game-container",

  // Login screen
  loginBtn: "btn-login",
  loginStatus: "login-status",
  devLoginSection: "dev-login-section",
  devLoginNameInput: "dev-login-name",
  devLoginBtn: "btn-dev-login",

  // Main menu
  userInfo: "user-info",
  userName: "user-name",
  logoutBtn: "btn-logout",
  createGameBtn: "btn-create-game",
  joinGameBtn: "btn-join-game",
  joinCodeInput: "join-code-input",
  connectionStatus: "connection-status",

  // Lobby screen
  lobbyJoinCode: "lobby-join-code",
  lobbyPlayers: "lobby-players",
  readyBtn: "btn-ready",
  startGameBtn: "btn-start-game",
  leaveLobbyBtn: "btn-leave-lobby",
  lobbyMonsterSection: "lobby-monster-section",
  lobbyMonsterGrid: "lobby-monster-grid",
  lobbyMonsterCount: "lobby-monster-count",

  // Loading screen
  loadingMessage: "loading-message",

  // Character modal
  characterModal: "character-modal",
  characterList: "character-list",
  newCharacterSection: "new-character-section",
  newCharacterName: "new-character-name",
  newCharacterClass: "new-character-class",
  createCharacterBtn: "btn-create-character",
  cancelCharacterBtn: "btn-cancel-character",

  // Party setup screen
  partySetupScreen: "party-setup-screen",
  partyPlayerSlot: "party-player-slot",
  partyNpcSlots: "party-npc-slots",
  partyClassPicker: "party-class-picker",
  partyStartBtn: "btn-party-start",
  partyBackBtn: "btn-party-back",
} as const;

// =============================================================================
// DOM Helper Functions
// =============================================================================

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    id?: string;
    className?: string;
    textContent?: string;
    attributes?: Record<string, string>;
  }
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options?.id) el.id = options.id;
  if (options?.className) el.className = options.className;
  if (options?.textContent) el.textContent = options.textContent;
  if (options?.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) {
      el.setAttribute(key, value);
    }
  }
  return el;
}

function clearElement(el: HTMLElement): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

// =============================================================================
// Screen Manager
// =============================================================================

export class ScreenManager {
  private currentScreen: MultiplayerScreen | null = null;
  private handlers: Record<MultiplayerScreen, ScreenHandler>;
  private callbacks: ScreenManagerCallbacks;

  /** Pending action when selecting character */
  private pendingAction: { type: "create" | "join"; joinCode?: string } | null = null;

  /** User's characters */
  private characters: CharacterInfo[] = [];

  /** Selected monsters for lobby (DM only) */
  private selectedMonsters: string[] = [];

  /** NPC class style info */
  private readonly CLASS_STYLES: Record<string, { icon: string; color: string }> = {
    warrior: { icon: "⚔️", color: "#c0392b" },
    archer: { icon: "🏹", color: "#27ae60" },
    mage: { icon: "✨", color: "#8e44ad" },
    cleric: { icon: "✝️", color: "#f1c40f" },
    rogue: { icon: "🗡️", color: "#34495e" },
  };

  /** Party setup state */
  private partySlots: Array<{ className: string; name: string }> = [];
  private selectedCharacterId: string | null = null;
  private selectedCharacter: LocalCharacter | null = null;

  constructor(callbacks: ScreenManagerCallbacks) {
    this.callbacks = callbacks;

    // Initialize handlers for each screen
    this.handlers = {
      login: this.createLoginHandler(),
      main_menu: this.createMainMenuHandler(),
      party_setup: this.createPartySetupHandler(),
      lobby: this.createLobbyHandler(),
      game: this.createGameHandler(),
      loading: this.createLoadingHandler(),
    };

    this.createScreenElements();
    this.setupEventListeners();
  }

  /**
   * Update the screen manager with new state.
   */
  update(state: MultiplayerState): void {
    // Handle screen transition
    if (state.screen !== this.currentScreen) {
      this.transitionTo(state.screen, state);
    } else {
      // Update current screen
      this.handlers[this.currentScreen]?.update?.(state);
    }

    // Update connection status indicator
    this.updateConnectionStatus(state.connectionStatus);
  }

  /**
   * Transition to a new screen.
   */
  private transitionTo(screen: MultiplayerScreen, state: MultiplayerState): void {
    // Exit current screen
    if (this.currentScreen) {
      this.handlers[this.currentScreen].exit();
      this.hideScreen(this.currentScreen);
    }

    // Enter new screen
    this.currentScreen = screen;
    this.showScreen(screen);
    this.handlers[screen].enter(state);
  }

  /**
   * Show a screen element.
   */
  private showScreen(screen: MultiplayerScreen): void {
    const elementId = this.getScreenElementId(screen);
    const element = document.getElementById(elementId);
    if (element) {
      element.style.display = screen === "game" ? "block" : "flex";
    }
  }

  /**
   * Hide a screen element.
   */
  private hideScreen(screen: MultiplayerScreen): void {
    const elementId = this.getScreenElementId(screen);
    const element = document.getElementById(elementId);
    if (element) {
      element.style.display = "none";
    }
  }

  /**
   * Get the DOM element ID for a screen.
   */
  private getScreenElementId(screen: MultiplayerScreen): string {
    switch (screen) {
      case "login":
        return ELEMENTS.loginScreen;
      case "main_menu":
        return ELEMENTS.mainMenuScreen;
      case "party_setup":
        return ELEMENTS.partySetupScreen;
      case "lobby":
        return ELEMENTS.lobbyScreen;
      case "game":
        return ELEMENTS.gameContainer;
      case "loading":
        return ELEMENTS.loadingScreen;
    }
  }

  /**
   * Create screen DOM elements if they don't exist.
   */
  private createScreenElements(): void {
    // Only create multiplayer-specific screens if they don't exist
    this.createLoginScreen();
    this.createMainMenuScreen();
    this.createPartySetupScreen();
    this.createLobbyScreen();
    this.createLoadingScreen();
    this.createCharacterModal();
  }

  /**
   * Create character selection modal.
   */
  private createCharacterModal(): void {
    if (document.getElementById(ELEMENTS.characterModal)) return;

    const modal = createElement("div", {
      id: ELEMENTS.characterModal,
      className: "modal",
    });
    modal.style.display = "none";

    const content = createElement("div", { className: "modal-content" });

    const title = createElement("h2", { textContent: "Select Character" });

    // Character list
    const charList = createElement("div", {
      id: ELEMENTS.characterList,
      className: "character-list",
    });

    // New character section
    const newSection = createElement("div", {
      id: ELEMENTS.newCharacterSection,
      className: "new-character-section",
    });

    const divider = createElement("div", {
      className: "form-divider",
      textContent: "— or create new —",
    });

    const nameGroup = createElement("div", { className: "form-group" });
    const nameLabel = createElement("label", { textContent: "Character Name" });
    const nameInput = createElement("input", {
      id: ELEMENTS.newCharacterName,
      className: "form-input",
      attributes: { type: "text", placeholder: "Enter name" },
    });
    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(nameInput);

    const classGroup = createElement("div", { className: "form-group" });
    const classLabel = createElement("label", { textContent: "Class" });
    const classSelect = createElement("select", {
      id: ELEMENTS.newCharacterClass,
      className: "form-select",
    });
    // Use all character classes from characters.ts
    for (const charClass of CHARACTER_CLASSES) {
      const option = document.createElement("option");
      option.value = charClass.id;
      option.textContent = `${charClass.name} - ${charClass.description.substring(0, 40)}...`;
      classSelect.appendChild(option);
    }
    classGroup.appendChild(classLabel);
    classGroup.appendChild(classSelect);

    newSection.appendChild(divider);
    newSection.appendChild(nameGroup);
    newSection.appendChild(classGroup);

    // Buttons
    const buttons = createElement("div", { className: "modal-buttons" });
    const createBtn = createElement("button", {
      id: ELEMENTS.createCharacterBtn,
      className: "primary-btn",
      textContent: "Create & Continue",
    });
    const cancelBtn = createElement("button", {
      id: ELEMENTS.cancelCharacterBtn,
      className: "text-btn",
      textContent: "Cancel",
    });
    buttons.appendChild(createBtn);
    buttons.appendChild(cancelBtn);

    content.appendChild(title);
    content.appendChild(charList);
    content.appendChild(newSection);
    content.appendChild(buttons);
    modal.appendChild(content);
    document.body.appendChild(modal);
  }

  private createLoginScreen(): void {
    if (document.getElementById(ELEMENTS.loginScreen)) return;

    const screen = createElement("div", {
      id: ELEMENTS.loginScreen,
      className: "screen login-screen",
    });
    screen.style.display = "none";

    const content = createElement("div", { className: "screen-content" });

    const title = createElement("h1", { textContent: "Rune Forge" });
    const subtitle = createElement("p", {
      className: "subtitle",
      textContent: "Multiplayer Tactical RPG",
    });
    const status = createElement("div", {
      id: ELEMENTS.loginStatus,
      className: "status-message",
    });
    const loginBtn = createElement("button", {
      id: ELEMENTS.loginBtn,
      className: "primary-btn",
      textContent: "Login with Pocket ID",
    });

    // Dev login section (for development without OIDC)
    const devSection = createElement("div", {
      id: ELEMENTS.devLoginSection,
      className: "dev-login-section",
    });
    const devDivider = createElement("div", {
      className: "divider",
      textContent: "— or login for development —",
    });
    const devInput = createElement("input", {
      id: ELEMENTS.devLoginNameInput,
      className: "dev-login-input",
      attributes: {
        type: "text",
        placeholder: "Enter your name",
        maxlength: "30",
      },
    });
    const devBtn = createElement("button", {
      id: ELEMENTS.devLoginBtn,
      className: "secondary-btn",
      textContent: "Dev Login",
    });
    devSection.appendChild(devDivider);
    devSection.appendChild(devInput);
    devSection.appendChild(devBtn);

    content.appendChild(title);
    content.appendChild(subtitle);
    content.appendChild(status);
    content.appendChild(loginBtn);
    content.appendChild(devSection);
    screen.appendChild(content);
    document.body.appendChild(screen);
  }

  private createMainMenuScreen(): void {
    if (document.getElementById(ELEMENTS.mainMenuScreen)) return;

    const screen = createElement("div", {
      id: ELEMENTS.mainMenuScreen,
      className: "screen main-menu-screen",
    });
    screen.style.display = "none";

    const content = createElement("div", { className: "screen-content" });

    // User info section
    const userInfo = createElement("div", {
      id: ELEMENTS.userInfo,
      className: "user-info",
    });
    const welcomeSpan = createElement("span", { textContent: "Welcome, " });
    const userNameSpan = createElement("span", { id: ELEMENTS.userName });
    const logoutBtn = createElement("button", {
      id: ELEMENTS.logoutBtn,
      className: "text-btn",
      textContent: "Logout",
    });
    userInfo.appendChild(welcomeSpan);
    userInfo.appendChild(userNameSpan);
    userInfo.appendChild(logoutBtn);

    // Connection status
    const connectionStatus = createElement("div", {
      id: ELEMENTS.connectionStatus,
      className: "connection-status",
    });

    // Title
    const title = createElement("h1", { textContent: "Rune Forge" });

    // Menu buttons
    const menuButtons = createElement("div", { className: "menu-buttons" });

    const createGameBtn = createElement("button", {
      id: ELEMENTS.createGameBtn,
      className: "primary-btn",
      textContent: "Create Game",
    });

    const joinSection = createElement("div", { className: "join-section" });
    const joinInput = createElement("input", {
      id: ELEMENTS.joinCodeInput,
      className: "join-input",
      attributes: {
        type: "text",
        placeholder: "Enter join code",
        maxlength: "6",
      },
    });
    const joinBtn = createElement("button", {
      id: ELEMENTS.joinGameBtn,
      className: "secondary-btn",
      textContent: "Join Game",
    });
    joinSection.appendChild(joinInput);
    joinSection.appendChild(joinBtn);

    menuButtons.appendChild(createGameBtn);
    menuButtons.appendChild(joinSection);

    content.appendChild(userInfo);
    content.appendChild(connectionStatus);
    content.appendChild(title);
    content.appendChild(menuButtons);
    screen.appendChild(content);
    document.body.appendChild(screen);
  }

  private createLobbyScreen(): void {
    if (document.getElementById(ELEMENTS.lobbyScreen)) return;

    const screen = createElement("div", {
      id: ELEMENTS.lobbyScreen,
      className: "screen lobby-screen",
    });
    screen.style.display = "none";

    const content = createElement("div", { className: "screen-content lobby-content" });

    // Title
    const title = createElement("h2", { textContent: "Game Lobby" });

    // Join code display
    const joinCodeDisplay = createElement("div", { className: "join-code-display" });
    const codeLabel = createElement("span", { textContent: "Join Code: " });
    const codeValue = createElement("span", {
      id: ELEMENTS.lobbyJoinCode,
      className: "code",
    });
    const copyBtn = createElement("button", {
      className: "copy-btn",
      textContent: "Copy",
    });
    copyBtn.addEventListener("click", () => {
      const code = document.getElementById(ELEMENTS.lobbyJoinCode)?.textContent;
      if (code) {
        navigator.clipboard.writeText(code).catch(console.error);
      }
    });
    joinCodeDisplay.appendChild(codeLabel);
    joinCodeDisplay.appendChild(codeValue);
    joinCodeDisplay.appendChild(copyBtn);

    // Players list
    const playersList = createElement("div", {
      id: ELEMENTS.lobbyPlayers,
      className: "player-list",
    });

    // Monster selection section (DM only, hidden by default)
    const monsterSection = createElement("div", {
      id: ELEMENTS.lobbyMonsterSection,
      className: "lobby-monster-section",
    });
    monsterSection.style.display = "none";

    const monsterTitle = createElement("h3", {
      className: "monster-title",
      textContent: "Select Specific Monsters (optional)",
    });

    const monsterCount = createElement("p", {
      id: ELEMENTS.lobbyMonsterCount,
      className: "selection-info",
      textContent: "Selected: 0/3",
    });

    const monsterGrid = createElement("div", {
      id: ELEMENTS.lobbyMonsterGrid,
      className: "lobby-monster-grid",
    });

    // Create monster cards
    for (const monster of MONSTER_TYPES) {
      const card = createElement("div", {
        className: "lobby-monster-card",
      });
      card.dataset.monsterId = monster.id;

      const spriteContainer = createElement("div", { className: "sprite-container" });
      const img = document.createElement("img");
      img.src = monster.sprite;
      img.alt = monster.name;
      img.style.width = "100%";
      img.style.height = "100%";
      img.onerror = () => {
        // Fallback to color placeholder if sprite fails
        while (spriteContainer.firstChild) {
          spriteContainer.removeChild(spriteContainer.firstChild);
        }
        const placeholder = createElement("div", { className: "sprite-placeholder" });
        placeholder.style.backgroundColor = `#${monster.color.toString(16).padStart(6, "0")}`;
        spriteContainer.appendChild(placeholder);
      };
      spriteContainer.appendChild(img);

      const name = createElement("div", {
        className: "name",
        textContent: monster.name,
      });

      card.appendChild(spriteContainer);
      card.appendChild(name);

      card.addEventListener("click", () => {
        this.toggleMonsterSelection(monster.id);
      });

      monsterGrid.appendChild(card);
    }

    monsterSection.appendChild(monsterTitle);
    monsterSection.appendChild(monsterCount);
    monsterSection.appendChild(monsterGrid);

    // Actions
    const lobbyActions = createElement("div", { className: "lobby-actions" });
    const readyBtn = createElement("button", {
      id: ELEMENTS.readyBtn,
      className: "secondary-btn",
      textContent: "Ready",
    });
    const startBtn = createElement("button", {
      id: ELEMENTS.startGameBtn,
      className: "primary-btn",
      textContent: "Start Game",
    });
    startBtn.style.display = "none";
    const leaveBtn = createElement("button", {
      id: ELEMENTS.leaveLobbyBtn,
      className: "text-btn",
      textContent: "Leave",
    });
    lobbyActions.appendChild(readyBtn);
    lobbyActions.appendChild(startBtn);
    lobbyActions.appendChild(leaveBtn);

    content.appendChild(title);
    content.appendChild(joinCodeDisplay);
    content.appendChild(playersList);
    content.appendChild(monsterSection);
    content.appendChild(lobbyActions);
    screen.appendChild(content);
    document.body.appendChild(screen);
  }

  /**
   * Toggle monster selection.
   */
  private toggleMonsterSelection(monsterId: string): void {
    const index = this.selectedMonsters.indexOf(monsterId);
    if (index >= 0) {
      this.selectedMonsters.splice(index, 1);
    } else if (this.selectedMonsters.length < 3) {
      this.selectedMonsters.push(monsterId);
    }

    this.updateMonsterSelectionUI();
    this.updateStartButtonState();
  }

  /**
   * Update monster selection UI.
   */
  private updateMonsterSelectionUI(): void {
    // Update count display
    const countEl = document.getElementById(ELEMENTS.lobbyMonsterCount);
    if (countEl) {
      countEl.textContent = `Selected: ${this.selectedMonsters.length}/3`;
    }

    // Update card selection states
    const grid = document.getElementById(ELEMENTS.lobbyMonsterGrid);
    if (grid) {
      for (const card of grid.querySelectorAll(".lobby-monster-card")) {
        const cardEl = card as HTMLElement;
        const monsterId = cardEl.dataset.monsterId;
        if (monsterId && this.selectedMonsters.includes(monsterId)) {
          cardEl.classList.add("selected");
        } else {
          cardEl.classList.remove("selected");
        }
      }
    }
  }

  /**
   * Update start button enabled state.
   * Monster selection is now optional - monsters are auto-generated based on DM config.
   */
  private updateStartButtonState(): void {
    const startBtn = document.getElementById(ELEMENTS.startGameBtn) as HTMLButtonElement;
    if (startBtn) {
      // Monster selection is now optional - can start without selecting specific monsters
      // (monsters will be randomly generated based on DM options)
      startBtn.disabled = false;
    }
  }

  private createLoadingScreen(): void {
    if (document.getElementById(ELEMENTS.loadingScreen)) return;

    const screen = createElement("div", {
      id: ELEMENTS.loadingScreen,
      className: "screen loading-screen",
    });
    screen.style.display = "none";

    const content = createElement("div", { className: "screen-content" });

    const spinner = createElement("div", { className: "spinner" });
    const message = createElement("p", {
      id: ELEMENTS.loadingMessage,
      textContent: "Loading...",
    });

    content.appendChild(spinner);
    content.appendChild(message);
    screen.appendChild(content);
    document.body.appendChild(screen);
  }

  // ===========================================================================
  // Party Setup Screen
  // ===========================================================================

  private createPartySetupScreen(): void {
    if (document.getElementById(ELEMENTS.partySetupScreen)) return;

    const screen = createElement("div", {
      id: ELEMENTS.partySetupScreen,
      className: "screen party-setup-screen",
    });
    screen.style.display = "none";
    screen.style.background = "linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)";
    screen.style.minHeight = "100vh";
    screen.style.padding = "40px";
    screen.style.boxSizing = "border-box";

    // Title
    const title = createElement("h1", { textContent: "Build Your Party" });
    title.style.textAlign = "center";
    title.style.color = "#e94560";
    title.style.marginBottom = "40px";
    title.style.fontSize = "32px";
    title.style.textTransform = "uppercase";
    title.style.letterSpacing = "4px";
    screen.appendChild(title);

    // Main layout - horizontal
    const mainLayout = createElement("div", {});
    mainLayout.style.display = "flex";
    mainLayout.style.gap = "40px";
    mainLayout.style.maxWidth = "1200px";
    mainLayout.style.margin = "0 auto";

    // Left side - Class picker (draggable sources)
    const classPicker = createElement("div", { id: ELEMENTS.partyClassPicker });
    classPicker.style.width = "200px";
    classPicker.style.flexShrink = "0";

    const classTitle = createElement("div", { textContent: "DRAG TO ADD" });
    classTitle.style.color = "#666";
    classTitle.style.fontSize = "11px";
    classTitle.style.letterSpacing = "2px";
    classTitle.style.marginBottom = "16px";
    classTitle.style.textAlign = "center";
    classPicker.appendChild(classTitle);

    // Create draggable class cards
    for (const classInfo of NPC_CLASS_OPTIONS) {
      const style = this.CLASS_STYLES[classInfo.name] ?? { icon: "?", color: "#333" };

      const card = createElement("div", {
        className: "class-source-card",
        attributes: { draggable: "true", "data-class": classInfo.name },
      });
      card.style.display = "flex";
      card.style.alignItems = "center";
      card.style.gap = "12px";
      card.style.padding = "12px 16px";
      card.style.marginBottom = "8px";
      card.style.backgroundColor = "#252540";
      card.style.borderRadius = "8px";
      card.style.cursor = "grab";
      card.style.borderLeft = `4px solid ${style.color}`;
      card.style.transition = "transform 0.15s, box-shadow 0.15s";

      const icon = createElement("span", { textContent: style.icon });
      icon.style.fontSize = "24px";

      const info = createElement("div", {});
      info.style.flex = "1";
      const name = createElement("div", { textContent: classInfo.display });
      name.style.fontWeight = "bold";
      name.style.fontSize = "14px";
      name.style.color = "#fff";
      const desc = createElement("div", { textContent: classInfo.description });
      desc.style.fontSize = "10px";
      desc.style.color = "#888";
      desc.style.marginTop = "2px";

      info.appendChild(name);
      info.appendChild(desc);
      card.appendChild(icon);
      card.appendChild(info);

      // Drag events
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer!.setData("text/plain", classInfo.name);
        card.style.opacity = "0.5";
      });
      card.addEventListener("dragend", () => {
        card.style.opacity = "1";
      });
      card.addEventListener("mouseenter", () => {
        card.style.transform = "translateX(4px)";
        card.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "none";
        card.style.boxShadow = "none";
      });

      classPicker.appendChild(card);
    }

    // Right side - Party formation
    const partyArea = createElement("div", {});
    partyArea.style.flex = "1";

    // Player slot at top
    const playerSection = createElement("div", {});
    playerSection.style.marginBottom = "32px";
    const playerLabel = createElement("div", { textContent: "YOUR CHARACTER" });
    playerLabel.style.color = "#666";
    playerLabel.style.fontSize = "11px";
    playerLabel.style.letterSpacing = "2px";
    playerLabel.style.marginBottom = "12px";

    const playerSlot = createElement("div", { id: ELEMENTS.partyPlayerSlot });
    playerSlot.style.display = "flex";
    playerSlot.style.alignItems = "center";
    playerSlot.style.gap = "16px";
    playerSlot.style.padding = "20px";
    playerSlot.style.backgroundColor = "#2a2a4a";
    playerSlot.style.borderRadius = "12px";
    playerSlot.style.border = "2px solid #e94560";

    const playerIcon = createElement("div", { textContent: "👤" });
    playerIcon.style.fontSize = "40px";
    const playerInfo = createElement("div", {});
    playerInfo.style.flex = "1";
    const playerName = createElement("div", {
      className: "player-name",
      textContent: "Select a character...",
    });
    playerName.style.fontSize = "18px";
    playerName.style.fontWeight = "bold";
    playerName.style.color = "#fff";
    const playerClass = createElement("div", { className: "player-class" });
    playerClass.style.fontSize = "12px";
    playerClass.style.color = "#888";
    playerClass.style.marginTop = "4px";
    playerInfo.appendChild(playerName);
    playerInfo.appendChild(playerClass);
    playerSlot.appendChild(playerIcon);
    playerSlot.appendChild(playerInfo);
    playerSection.appendChild(playerLabel);
    playerSection.appendChild(playerSlot);
    partyArea.appendChild(playerSection);

    // NPC Slots label
    const npcLabel = createElement("div", {
      textContent: "NPC COMPANIONS (0/7)",
      id: "npc-count-display",
    });
    npcLabel.style.color = "#666";
    npcLabel.style.fontSize = "11px";
    npcLabel.style.letterSpacing = "2px";
    npcLabel.style.marginBottom = "12px";
    partyArea.appendChild(npcLabel);

    // NPC slots grid - 7 slots
    const slotsGrid = createElement("div", { id: ELEMENTS.partyNpcSlots });
    slotsGrid.style.display = "grid";
    slotsGrid.style.gridTemplateColumns = "repeat(4, 1fr)";
    slotsGrid.style.gap = "12px";

    // Create 7 empty slots
    for (let i = 0; i < 7; i++) {
      const slot = this.createEmptySlot(i);
      slotsGrid.appendChild(slot);
    }

    partyArea.appendChild(slotsGrid);

    // DM Options Section
    const dmOptionsSection = createElement("div", { id: "dm-options-section" });
    dmOptionsSection.style.marginTop = "32px";
    dmOptionsSection.style.padding = "20px";
    dmOptionsSection.style.backgroundColor = "#252540";
    dmOptionsSection.style.borderRadius = "12px";
    dmOptionsSection.style.border = "2px solid #ffd700";

    const dmOptionsTitle = createElement("div", { textContent: "⚙️ DM OPTIONS" });
    dmOptionsTitle.style.color = "#ffd700";
    dmOptionsTitle.style.fontSize = "12px";
    dmOptionsTitle.style.letterSpacing = "2px";
    dmOptionsTitle.style.marginBottom = "16px";
    dmOptionsTitle.style.fontWeight = "bold";
    dmOptionsSection.appendChild(dmOptionsTitle);

    const dmOptionsGrid = createElement("div", {});
    dmOptionsGrid.style.display = "grid";
    dmOptionsGrid.style.gridTemplateColumns = "1fr 1fr";
    dmOptionsGrid.style.gap = "16px";

    // Monster Count
    const monsterCountGroup = createElement("div", {});
    monsterCountGroup.style.display = "flex";
    monsterCountGroup.style.flexDirection = "column";
    monsterCountGroup.style.gap = "6px";
    const monsterCountLabel = createElement("label", { textContent: "Monster Count" });
    monsterCountLabel.style.color = "#888";
    monsterCountLabel.style.fontSize = "12px";
    const monsterCountInput = createElement("input", {
      id: "dm-monster-count",
      attributes: { type: "number", min: "1", max: "20", value: "10" },
    });
    monsterCountInput.style.padding = "10px 12px";
    monsterCountInput.style.backgroundColor = "#1a1a2e";
    monsterCountInput.style.border = "1px solid #3a3a5e";
    monsterCountInput.style.borderRadius = "6px";
    monsterCountInput.style.color = "#fff";
    monsterCountInput.style.fontSize = "14px";
    monsterCountGroup.appendChild(monsterCountLabel);
    monsterCountGroup.appendChild(monsterCountInput);
    dmOptionsGrid.appendChild(monsterCountGroup);

    // Player Move Range
    const moveRangeGroup = createElement("div", {});
    moveRangeGroup.style.display = "flex";
    moveRangeGroup.style.flexDirection = "column";
    moveRangeGroup.style.gap = "6px";
    const moveRangeLabel = createElement("label", { textContent: "Player Move Range" });
    moveRangeLabel.style.color = "#888";
    moveRangeLabel.style.fontSize = "12px";
    const moveRangeInput = createElement("input", {
      id: "dm-move-range",
      attributes: { type: "number", min: "1", max: "10", value: "3" },
    });
    moveRangeInput.style.padding = "10px 12px";
    moveRangeInput.style.backgroundColor = "#1a1a2e";
    moveRangeInput.style.border = "1px solid #3a3a5e";
    moveRangeInput.style.borderRadius = "6px";
    moveRangeInput.style.color = "#fff";
    moveRangeInput.style.fontSize = "14px";
    moveRangeGroup.appendChild(moveRangeLabel);
    moveRangeGroup.appendChild(moveRangeInput);
    dmOptionsGrid.appendChild(moveRangeGroup);

    dmOptionsSection.appendChild(dmOptionsGrid);
    partyArea.appendChild(dmOptionsSection);

    // Buttons at bottom
    const buttonArea = createElement("div", {});
    buttonArea.style.display = "flex";
    buttonArea.style.justifyContent = "center";
    buttonArea.style.gap = "16px";
    buttonArea.style.marginTop = "40px";

    const backBtn = createElement("button", {
      id: ELEMENTS.partyBackBtn,
      textContent: "← Back",
      className: "secondary-btn",
    });
    backBtn.style.padding = "12px 32px";
    backBtn.style.fontSize = "16px";
    backBtn.style.borderRadius = "8px";
    backBtn.style.cursor = "pointer";

    const startBtn = createElement("button", {
      id: ELEMENTS.partyStartBtn,
      textContent: "Start Game →",
      className: "primary-btn",
    });
    startBtn.style.padding = "12px 32px";
    startBtn.style.fontSize = "16px";
    startBtn.style.borderRadius = "8px";
    startBtn.style.cursor = "pointer";

    buttonArea.appendChild(backBtn);
    buttonArea.appendChild(startBtn);
    partyArea.appendChild(buttonArea);

    mainLayout.appendChild(classPicker);
    mainLayout.appendChild(partyArea);
    screen.appendChild(mainLayout);
    document.body.appendChild(screen);
  }

  private createEmptySlot(index: number): HTMLElement {
    const slot = createElement("div", {
      className: "npc-slot empty",
      attributes: { "data-slot-index": String(index) },
    });
    slot.style.aspectRatio = "1";
    slot.style.backgroundColor = "#1a1a2e";
    slot.style.borderRadius = "12px";
    slot.style.border = "2px dashed #333";
    slot.style.display = "flex";
    slot.style.flexDirection = "column";
    slot.style.alignItems = "center";
    slot.style.justifyContent = "center";
    slot.style.cursor = "pointer";
    slot.style.transition = "border-color 0.2s, background-color 0.2s";

    const plus = createElement("div", { textContent: "+" });
    plus.style.fontSize = "32px";
    plus.style.color = "#444";
    plus.style.lineHeight = "1";
    slot.appendChild(plus);

    // Drop zone handling
    slot.addEventListener("dragover", (e) => {
      e.preventDefault();
      slot.style.borderColor = "#e94560";
      slot.style.backgroundColor = "#252540";
    });
    slot.addEventListener("dragleave", () => {
      slot.style.borderColor = "#333";
      slot.style.backgroundColor = "#1a1a2e";
    });
    slot.addEventListener("drop", (e) => {
      e.preventDefault();
      slot.style.borderColor = "#333";
      slot.style.backgroundColor = "#1a1a2e";
      const className = e.dataTransfer!.getData("text/plain");
      if (className && this.partySlots.length < 7) {
        this.addNpcToSlot(className);
      }
    });

    return slot;
  }

  private createFilledSlot(npc: { className: string; name: string }, index: number): HTMLElement {
    const style = this.CLASS_STYLES[npc.className] ?? { icon: "?", color: "#333" };

    const slot = createElement("div", {
      className: "npc-slot filled",
      attributes: { "data-slot-index": String(index) },
    });
    slot.style.aspectRatio = "1";
    slot.style.backgroundColor = style.color;
    slot.style.borderRadius = "12px";
    slot.style.padding = "12px";
    slot.style.display = "flex";
    slot.style.flexDirection = "column";
    slot.style.position = "relative";

    // Remove button
    const removeBtn = createElement("div", { textContent: "×" });
    removeBtn.style.position = "absolute";
    removeBtn.style.top = "8px";
    removeBtn.style.right = "8px";
    removeBtn.style.width = "24px";
    removeBtn.style.height = "24px";
    removeBtn.style.borderRadius = "50%";
    removeBtn.style.backgroundColor = "rgba(0,0,0,0.4)";
    removeBtn.style.display = "flex";
    removeBtn.style.alignItems = "center";
    removeBtn.style.justifyContent = "center";
    removeBtn.style.cursor = "pointer";
    removeBtn.style.fontSize = "16px";
    removeBtn.style.color = "#fff";
    removeBtn.addEventListener("click", () => {
      this.removeNpcFromSlot(index);
    });
    slot.appendChild(removeBtn);

    // Icon
    const icon = createElement("div", { textContent: style.icon });
    icon.style.fontSize = "36px";
    icon.style.textAlign = "center";
    icon.style.marginTop = "8px";
    slot.appendChild(icon);

    // Class name
    const classLabel = createElement("div", {
      textContent: NPC_CLASS_OPTIONS.find((c) => c.name === npc.className)?.display ?? npc.className,
    });
    classLabel.style.fontSize = "12px";
    classLabel.style.fontWeight = "bold";
    classLabel.style.textAlign = "center";
    classLabel.style.color = "#fff";
    classLabel.style.marginTop = "8px";
    slot.appendChild(classLabel);

    // Name input
    const nameInput = createElement("input", {
      attributes: {
        type: "text",
        value: npc.name,
        placeholder: "Name...",
      },
    }) as HTMLInputElement;
    nameInput.style.marginTop = "auto";
    nameInput.style.width = "100%";
    nameInput.style.padding = "6px";
    nameInput.style.border = "none";
    nameInput.style.borderRadius = "4px";
    nameInput.style.backgroundColor = "rgba(0,0,0,0.3)";
    nameInput.style.color = "#fff";
    nameInput.style.fontSize = "11px";
    nameInput.style.textAlign = "center";
    nameInput.style.boxSizing = "border-box";
    nameInput.addEventListener("input", () => {
      npc.name = nameInput.value;
    });
    slot.appendChild(nameInput);

    return slot;
  }

  private addNpcToSlot(className: string): void {
    if (this.partySlots.length >= 7) return;
    this.partySlots.push({ className, name: "" });
    this.updatePartyDisplay();
  }

  private removeNpcFromSlot(index: number): void {
    this.partySlots.splice(index, 1);
    this.updatePartyDisplay();
  }

  private updatePartyDisplay(): void {
    const slotsGrid = document.getElementById(ELEMENTS.partyNpcSlots);
    const countDisplay = document.getElementById("npc-count-display");
    if (!slotsGrid) return;

    slotsGrid.innerHTML = "";

    // Add filled slots
    this.partySlots.forEach((npc, i) => {
      slotsGrid.appendChild(this.createFilledSlot(npc, i));
    });

    // Add empty slots to fill up to 7
    for (let i = this.partySlots.length; i < 7; i++) {
      slotsGrid.appendChild(this.createEmptySlot(i));
    }

    // Update count
    if (countDisplay) {
      countDisplay.textContent = `NPC COMPANIONS (${this.partySlots.length}/7)`;
    }
  }

  private updatePlayerSlot(): void {
    const playerSlot = document.getElementById(ELEMENTS.partyPlayerSlot);
    if (!playerSlot || !this.selectedCharacter) return;

    const nameEl = playerSlot.querySelector(".player-name");
    const classEl = playerSlot.querySelector(".player-class");
    if (nameEl) nameEl.textContent = this.selectedCharacter.name;
    if (classEl) classEl.textContent = `Level ${this.selectedCharacter.serverData?.level ?? 1} ${this.selectedCharacter.class}`;
  }

  setSelectedCharacter(characterId: string, character: LocalCharacter): void {
    this.selectedCharacterId = characterId;
    this.selectedCharacter = character;
  }

  getPartyConfig(): GameConfig {
    // Read DM options from UI inputs
    const monsterCountInput = document.getElementById("dm-monster-count") as HTMLInputElement;
    const moveRangeInput = document.getElementById("dm-move-range") as HTMLInputElement;

    const monsterCount = monsterCountInput ? parseInt(monsterCountInput.value, 10) || 10 : 10;
    const playerMoveRange = moveRangeInput ? parseInt(moveRangeInput.value, 10) || 3 : 3;

    return {
      maxPlayers: 4,
      difficulty: "normal",
      npcCount: this.partySlots.length,
      npcClasses: this.partySlots.map((s) => s.className),
      monsterCount,
      playerMoveRange,
    };
  }

  /**
   * Setup event listeners for all screens.
   */
  private setupEventListeners(): void {
    // Login button (Pocket ID)
    document.getElementById(ELEMENTS.loginBtn)?.addEventListener("click", () => {
      this.callbacks.onLogin();
    });

    // Dev login button
    document.getElementById(ELEMENTS.devLoginBtn)?.addEventListener("click", () => {
      const input = document.getElementById(ELEMENTS.devLoginNameInput) as HTMLInputElement;
      const name = input?.value?.trim();
      if (name) {
        this.callbacks.onDevLogin(name);
      } else {
        // Default name if empty
        this.callbacks.onDevLogin("Player");
      }
    });

    // Dev login input - Enter key
    document.getElementById(ELEMENTS.devLoginNameInput)?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        document.getElementById(ELEMENTS.devLoginBtn)?.click();
      }
    });

    // Logout button
    document.getElementById(ELEMENTS.logoutBtn)?.addEventListener("click", () => {
      this.callbacks.onLogout();
    });

    // Create game button - opens character selector, then party setup screen
    document.getElementById(ELEMENTS.createGameBtn)?.addEventListener("click", async () => {
      const character = await selectCharacter();
      if (character) {
        this.setSelectedCharacter(character.id, character);
        this.callbacks.onNavigateToPartySetup();
      }
    });

    // Join game button - opens character selection modal
    document.getElementById(ELEMENTS.joinGameBtn)?.addEventListener("click", () => {
      const input = document.getElementById(ELEMENTS.joinCodeInput) as HTMLInputElement;
      const joinCode = input?.value?.trim().toUpperCase();
      if (joinCode && joinCode.length === 6) {
        this.pendingAction = { type: "join", joinCode };
        this.showCharacterModal();
      }
    });

    // Character modal - create character button
    document.getElementById(ELEMENTS.createCharacterBtn)?.addEventListener("click", async () => {
      const nameInput = document.getElementById(ELEMENTS.newCharacterName) as HTMLInputElement;
      const classSelect = document.getElementById(ELEMENTS.newCharacterClass) as HTMLSelectElement;
      const name = nameInput?.value?.trim();
      const characterClass = classSelect?.value;

      if (!name) {
        alert("Please enter a character name");
        return;
      }

      try {
        const character = await this.callbacks.onCreateCharacter(name, characterClass);
        this.characters.push(character);
        this.selectCharacterAndProceed(character.id);
      } catch (error) {
        console.error("Failed to create character:", error);
        alert("Failed to create character");
      }
    });

    // Character modal - cancel button
    document.getElementById(ELEMENTS.cancelCharacterBtn)?.addEventListener("click", () => {
      this.hideCharacterModal();
    });

    // Ready button
    document.getElementById(ELEMENTS.readyBtn)?.addEventListener("click", () => {
      const btn = document.getElementById(ELEMENTS.readyBtn);
      const isReady = btn?.classList.contains("ready");
      this.callbacks.onSetReady(!isReady);
    });

    // Start game button (DM only)
    document.getElementById(ELEMENTS.startGameBtn)?.addEventListener("click", () => {
      this.callbacks.onStartGame(this.selectedMonsters);
    });

    // Leave lobby button
    document.getElementById(ELEMENTS.leaveLobbyBtn)?.addEventListener("click", () => {
      this.callbacks.onLeaveGame();
    });

    // Join code input - uppercase and filter
    document.getElementById(ELEMENTS.joinCodeInput)?.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });

    // Enter key on join code input
    document.getElementById(ELEMENTS.joinCodeInput)?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        document.getElementById(ELEMENTS.joinGameBtn)?.click();
      }
    });

    // Party setup - Back button
    document.getElementById(ELEMENTS.partyBackBtn)?.addEventListener("click", () => {
      this.callbacks.onBackToMainMenu();
    });

    // Party setup - Start game button
    document.getElementById(ELEMENTS.partyStartBtn)?.addEventListener("click", async () => {
      if (this.selectedCharacter) {
        const config = this.getPartyConfig();
        try {
          // Sync local character to server (creates if not exists)
          const serverChar = await this.callbacks.onCreateCharacter(
            this.selectedCharacter.name,
            this.selectedCharacter.class
          );
          // Use server character ID for game creation
          this.callbacks.onCreateGame(serverChar.id, config);
        } catch (error) {
          console.error("[screens] Failed to sync character to server:", error);
          alert("Failed to create game. Please try again.");
        }
      } else if (this.selectedCharacterId) {
        // Fallback: use ID directly if no full character data
        const config = this.getPartyConfig();
        this.callbacks.onCreateGame(this.selectedCharacterId, config);
      }
    });
  }

  /**
   * Update the connection status indicator.
   */
  private updateConnectionStatus(status: ConnectionStatus): void {
    const element = document.getElementById(ELEMENTS.connectionStatus);
    if (!element) return;

    const statusMap: Record<ConnectionStatus, { text: string; class: string }> = {
      disconnected: { text: "Disconnected", class: "status-disconnected" },
      connecting: { text: "Connecting...", class: "status-connecting" },
      authenticating: { text: "Authenticating...", class: "status-connecting" },
      connected: { text: "Connected", class: "status-connected" },
      reconnecting: { text: "Reconnecting...", class: "status-reconnecting" },
    };

    const info = statusMap[status];
    element.textContent = info.text;
    element.className = `connection-status ${info.class}`;
  }

  // ===========================================================================
  // Character Modal
  // ===========================================================================

  /**
   * Show the character selection modal.
   */
  private async showCharacterModal(): Promise<void> {
    const modal = document.getElementById(ELEMENTS.characterModal);
    if (!modal) return;

    // Fetch characters
    try {
      this.characters = await this.callbacks.onFetchCharacters();
    } catch (error) {
      console.error("Failed to fetch characters:", error);
      this.characters = [];
    }

    // Populate the character list
    this.renderCharacterList();

    // Clear the new character form
    const nameInput = document.getElementById(ELEMENTS.newCharacterName) as HTMLInputElement;
    const classSelect = document.getElementById(ELEMENTS.newCharacterClass) as HTMLSelectElement;
    if (nameInput) nameInput.value = "";
    if (classSelect) classSelect.selectedIndex = 0;

    // Show modal
    modal.style.display = "flex";
  }

  /**
   * Hide the character selection modal.
   */
  private hideCharacterModal(): void {
    const modal = document.getElementById(ELEMENTS.characterModal);
    if (modal) {
      modal.style.display = "none";
    }
    this.pendingAction = null;
  }

  /**
   * Render the character list in the modal.
   */
  private renderCharacterList(): void {
    const container = document.getElementById(ELEMENTS.characterList);
    if (!container) return;

    clearElement(container);

    if (this.characters.length === 0) {
      const emptyMsg = createElement("p", {
        className: "empty-message",
        textContent: "No characters yet. Create one below!",
      });
      container.appendChild(emptyMsg);
      return;
    }

    for (const char of this.characters) {
      const charEl = createElement("div", {
        className: "character-item with-sprite",
      });
      charEl.dataset.characterId = char.id;

      // Get class display info
      const classInfo = CLASS_DISPLAY[char.class] ?? {
        name: char.class,
        sprite: "",
        color: 0x888888,
        description: "",
      };

      // Sprite container
      const spriteContainer = createElement("div", { className: "character-sprite" });
      if (classInfo.sprite) {
        const img = document.createElement("img");
        img.src = classInfo.sprite;
        img.alt = classInfo.name;
        img.onerror = () => {
          while (spriteContainer.firstChild) {
            spriteContainer.removeChild(spriteContainer.firstChild);
          }
          const placeholder = createElement("div", { className: "sprite-placeholder" });
          placeholder.style.backgroundColor = `#${classInfo.color.toString(16).padStart(6, "0")}`;
          spriteContainer.appendChild(placeholder);
        };
        spriteContainer.appendChild(img);
      } else {
        const placeholder = createElement("div", { className: "sprite-placeholder" });
        placeholder.style.backgroundColor = `#${classInfo.color.toString(16).padStart(6, "0")}`;
        spriteContainer.appendChild(placeholder);
      }

      const info = createElement("div", { className: "character-info" });
      const name = createElement("span", {
        className: "character-name",
        textContent: char.name,
      });
      const details = createElement("span", {
        className: "character-details",
        textContent: `Level ${char.level} ${classInfo.name}`,
      });
      const desc = createElement("span", {
        className: "character-class-desc",
        textContent: classInfo.description,
      });
      info.appendChild(name);
      info.appendChild(details);
      info.appendChild(desc);

      const selectBtn = createElement("button", {
        className: "select-btn",
        textContent: "Select",
      });
      selectBtn.addEventListener("click", () => {
        this.selectCharacterAndProceed(char.id);
      });

      charEl.appendChild(spriteContainer);
      charEl.appendChild(info);
      charEl.appendChild(selectBtn);
      container.appendChild(charEl);
    }
  }

  /**
   * Select a character and proceed with the pending action.
   */
  private selectCharacterAndProceed(characterId: string): void {
    if (!this.pendingAction) return;

    if (this.pendingAction.type === "create") {
      this.callbacks.onCreateGame(characterId);
    } else if (this.pendingAction.type === "join" && this.pendingAction.joinCode) {
      this.callbacks.onJoinGame(this.pendingAction.joinCode, characterId);
    }

    this.hideCharacterModal();
  }

  // ===========================================================================
  // Screen Handlers
  // ===========================================================================

  private createLoginHandler(): ScreenHandler {
    return {
      enter: () => {
        const statusEl = document.getElementById(ELEMENTS.loginStatus);
        if (statusEl) {
          statusEl.textContent = "";
        }
      },
      exit: () => {},
      update: (state) => {
        const statusEl = document.getElementById(ELEMENTS.loginStatus);
        if (statusEl && state.connectionStatus === "connecting") {
          statusEl.textContent = "Connecting...";
        }
      },
    };
  }

  private createMainMenuHandler(): ScreenHandler {
    return {
      enter: (state) => {
        // Update user name
        const nameEl = document.getElementById(ELEMENTS.userName);
        if (nameEl && state.user) {
          nameEl.textContent = state.user.name;
        }

        // Enable/disable buttons based on connection
        this.updateMainMenuButtons(state.connectionStatus === "connected");
      },
      exit: () => {},
      update: (state) => {
        this.updateMainMenuButtons(state.connectionStatus === "connected");
      },
    };
  }

  private updateMainMenuButtons(connected: boolean): void {
    const createBtn = document.getElementById(ELEMENTS.createGameBtn) as HTMLButtonElement;
    const joinBtn = document.getElementById(ELEMENTS.joinGameBtn) as HTMLButtonElement;
    const joinInput = document.getElementById(ELEMENTS.joinCodeInput) as HTMLInputElement;

    if (createBtn) createBtn.disabled = !connected;
    if (joinBtn) joinBtn.disabled = !connected;
    if (joinInput) joinInput.disabled = !connected;
  }

  private createPartySetupHandler(): ScreenHandler {
    return {
      enter: () => {
        // Initialize with default party if empty
        if (this.partySlots.length === 0) {
          this.partySlots = [
            { className: "warrior", name: "" },
            { className: "archer", name: "" },
          ];
        }
        this.updatePartyDisplay();
        this.updatePlayerSlot();
      },
      exit: () => {
        // Nothing to clean up
      },
    };
  }

  private createLobbyHandler(): ScreenHandler {
    return {
      enter: (state) => {
        // Set join code
        const codeEl = document.getElementById(ELEMENTS.lobbyJoinCode);
        if (codeEl && state.joinCode) {
          codeEl.textContent = state.joinCode;
        }

        // Render players
        this.renderLobbyPlayers(state.players);

        // Show/hide start button and monster section based on DM status
        const startBtn = document.getElementById(ELEMENTS.startGameBtn);
        const monsterSection = document.getElementById(ELEMENTS.lobbyMonsterSection);
        if (startBtn) {
          startBtn.style.display = state.isDM ? "block" : "none";
        }
        if (monsterSection) {
          monsterSection.style.display = state.isDM ? "block" : "none";
        }

        // Reset monster selection when entering lobby
        this.selectedMonsters = [];
        this.updateMonsterSelectionUI();
        this.updateStartButtonState();
      },
      exit: () => {
        // Reset ready button
        const readyBtn = document.getElementById(ELEMENTS.readyBtn);
        if (readyBtn) {
          readyBtn.classList.remove("ready");
          readyBtn.textContent = "Ready";
        }

        // Reset monster selection
        this.selectedMonsters = [];
      },
      update: (state) => {
        this.renderLobbyPlayers(state.players);

        // Update start button state - enabled when all players ready
        // Monster selection is now optional (will be auto-generated from DM config)
        const startBtn = document.getElementById(ELEMENTS.startGameBtn) as HTMLButtonElement;
        if (startBtn && state.isDM) {
          const allReady = state.players.every((p) => p.ready || p.isDM);
          startBtn.disabled = !allReady || state.players.length < 1;
        }
      },
    };
  }

  private renderLobbyPlayers(players: LobbyPlayer[]): void {
    const container = document.getElementById(ELEMENTS.lobbyPlayers);
    if (!container) return;

    // Clear existing
    clearElement(container);

    for (const player of players) {
      const playerEl = createElement("div", {
        className: `lobby-player ${player.connected ? "" : "disconnected"} ${player.ready ? "ready" : ""}`.trim(),
      });

      const nameSpan = createElement("span", {
        className: "player-name",
        textContent: player.name,
      });

      const charSpan = createElement("span", {
        className: "player-character",
        textContent: player.characterName,
      });

      const statusSpan = createElement("span", { className: "player-status" });
      if (player.isDM) {
        statusSpan.textContent = "DM";
        statusSpan.classList.add("dm");
      } else if (!player.connected) {
        statusSpan.textContent = "Disconnected";
      } else if (player.ready) {
        statusSpan.textContent = "Ready";
      } else {
        statusSpan.textContent = "Not Ready";
      }

      playerEl.appendChild(nameSpan);
      playerEl.appendChild(charSpan);
      playerEl.appendChild(statusSpan);
      container.appendChild(playerEl);
    }
  }

  private createGameHandler(): ScreenHandler {
    return {
      enter: () => {
        // Hide ALL UI elements that might interfere with the game view
        const startScreen = document.getElementById("start-screen");
        if (startScreen) startScreen.style.display = "none";

        const charSelect = document.getElementById("character-select");
        if (charSelect) charSelect.style.display = "none";

        // Hide all multiplayer screens
        const loginScreen = document.getElementById(ELEMENTS.loginScreen);
        if (loginScreen) loginScreen.style.display = "none";

        const mainMenuScreen = document.getElementById(ELEMENTS.mainMenuScreen);
        if (mainMenuScreen) mainMenuScreen.style.display = "none";

        const lobbyScreen = document.getElementById(ELEMENTS.lobbyScreen);
        if (lobbyScreen) lobbyScreen.style.display = "none";

        const loadingScreen = document.getElementById(ELEMENTS.loadingScreen);
        if (loadingScreen) loadingScreen.style.display = "none";

        // Show the game container
        const gameContainer = document.getElementById(ELEMENTS.gameContainer);
        if (gameContainer) gameContainer.style.display = "block";
      },
      exit: () => {},
    };
  }

  private createLoadingHandler(): ScreenHandler {
    return {
      enter: (state) => {
        const messageEl = document.getElementById(ELEMENTS.loadingMessage);
        if (messageEl) {
          messageEl.textContent = this.getLoadingMessage(state);
        }
      },
      exit: () => {},
      update: (state) => {
        const messageEl = document.getElementById(ELEMENTS.loadingMessage);
        if (messageEl) {
          messageEl.textContent = this.getLoadingMessage(state);
        }
      },
    };
  }

  private getLoadingMessage(state: MultiplayerState): string {
    switch (state.connectionStatus) {
      case "connecting":
        return "Connecting to server...";
      case "authenticating":
        return "Authenticating...";
      case "reconnecting":
        return "Reconnecting...";
      default:
        return "Loading...";
    }
  }

  /**
   * Update the ready button state.
   */
  updateReadyState(isReady: boolean): void {
    const readyBtn = document.getElementById(ELEMENTS.readyBtn);
    if (readyBtn) {
      readyBtn.classList.toggle("ready", isReady);
      readyBtn.textContent = isReady ? "Not Ready" : "Ready";
    }
  }
}
