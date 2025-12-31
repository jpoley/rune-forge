/**
 * Screen State Machine
 *
 * Manages UI transitions and screen-specific rendering for multiplayer mode.
 * Each screen has its own enter/exit handlers and UI elements.
 */

import type { MultiplayerState, MultiplayerScreen, LobbyPlayer } from "./multiplayer.js";
import type { ConnectionStatus } from "./ws.js";
import { selectCharacter } from "./character-creator.js";
import type { LocalCharacter } from "./db/character-db.js";

// =============================================================================
// Types
// =============================================================================

/** Screen transition handler */
interface ScreenHandler {
  enter(state: MultiplayerState): void;
  exit(): void;
  update?(state: MultiplayerState): void;
}

/** Available NPC classes */
export const NPC_CLASS_OPTIONS = [
  { name: "warrior", display: "Warrior", description: "High HP, good defense, melee" },
  { name: "archer", display: "Archer", description: "Ranged attacks, high initiative" },
  { name: "mage", display: "Mage", description: "High damage, long range, fragile" },
  { name: "cleric", display: "Cleric", description: "Balanced support, melee" },
  { name: "rogue", display: "Rogue", description: "Fast, high damage, melee" },
] as const;

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
  onLoginWithName: (name: string) => void;
  onLogout: () => void;
  onCreateGame: (characterId: string, config: GameConfig) => void;
  onJoinGame: (joinCode: string, characterId: string) => void;
  onLeaveGame: () => void;
  onSetReady: (ready: boolean) => void;
  onStartGame: () => void;
  onNavigateToPartySetup: () => void;
  onBackToMainMenu: () => void;
  /** Check if auth is enabled on server */
  isAuthEnabled: () => boolean;
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
  loginNameInput: "login-name-input",
  loginStatus: "login-status",

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

  // Loading screen
  loadingMessage: "loading-message",

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
    styles?: Partial<CSSStyleDeclaration>;
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
  if (options?.styles) {
    for (const [key, value] of Object.entries(options.styles)) {
      if (value !== undefined) {
        (el.style as unknown as Record<string, unknown>)[key] = value;
      }
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

    // Name input for dev mode (hidden by default, shown when auth disabled)
    const nameInputSection = createElement("div", {
      id: "login-name-section",
      className: "name-input-section",
    });
    nameInputSection.style.display = "none";

    const nameLabel = createElement("label", {
      textContent: "Enter your name to join:",
      attributes: { for: ELEMENTS.loginNameInput },
    });
    const nameInput = createElement("input", {
      id: ELEMENTS.loginNameInput,
      className: "name-input",
      attributes: {
        type: "text",
        placeholder: "Your display name",
        maxlength: "20",
      },
    });
    nameInputSection.appendChild(nameLabel);
    nameInputSection.appendChild(nameInput);

    const loginBtn = createElement("button", {
      id: ELEMENTS.loginBtn,
      className: "primary-btn",
      textContent: "Login with Pocket ID",
    });

    content.appendChild(title);
    content.appendChild(subtitle);
    content.appendChild(status);
    content.appendChild(nameInputSection);
    content.appendChild(loginBtn);
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

    // Connection status indicator in lobby
    const lobbyStatus = createElement("div", {
      id: "lobby-connection-status",
      className: "connection-status status-connected",
    });
    lobbyStatus.textContent = "Connected";
    screen.appendChild(lobbyStatus);

    const content = createElement("div", { className: "screen-content" });

    // Title with player count
    const title = createElement("h2", { id: "lobby-title", textContent: "Game Lobby" });

    // Game status message
    const gameStatus = createElement("div", {
      id: "lobby-game-status",
      className: "lobby-game-status",
    });
    gameStatus.textContent = "Waiting for players...";

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
    content.appendChild(gameStatus);
    content.appendChild(joinCodeDisplay);
    content.appendChild(playersList);
    content.appendChild(lobbyActions);
    screen.appendChild(content);
    document.body.appendChild(screen);
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

  // Class icons/colors for party setup
  private readonly CLASS_STYLES: Record<string, { icon: string; color: string }> = {
    warrior: { icon: "⚔️", color: "#c0392b" },
    archer: { icon: "🏹", color: "#27ae60" },
    mage: { icon: "✨", color: "#8e44ad" },
    cleric: { icon: "✝️", color: "#f1c40f" },
    rogue: { icon: "🗡️", color: "#34495e" },
  };

  // Party setup state
  private partySlots: Array<{ className: string; name: string }> = [];
  private selectedCharacterId: string | null = null;
  private selectedCharacter: LocalCharacter | null = null;

  private createPartySetupScreen(): void {
    if (document.getElementById(ELEMENTS.partySetupScreen)) return;

    const screen = createElement("div", {
      id: ELEMENTS.partySetupScreen,
      className: "screen party-setup-screen",
      styles: {
        background: "linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)",
        minHeight: "100vh",
        padding: "40px",
        boxSizing: "border-box",
      },
    });
    screen.style.display = "none";

    // Title
    const title = createElement("h1", {
      textContent: "Build Your Party",
      styles: {
        textAlign: "center",
        color: "#e94560",
        marginBottom: "40px",
        fontSize: "32px",
        textTransform: "uppercase",
        letterSpacing: "4px",
      },
    });
    screen.appendChild(title);

    // Main layout - horizontal
    const mainLayout = createElement("div", {
      styles: {
        display: "flex",
        gap: "40px",
        maxWidth: "1200px",
        margin: "0 auto",
      },
    });

    // Left side - Class picker (draggable sources)
    const classPicker = createElement("div", {
      id: ELEMENTS.partyClassPicker,
      styles: {
        width: "200px",
        flexShrink: "0",
      },
    });

    const classTitle = createElement("div", {
      textContent: "DRAG TO ADD",
      styles: {
        color: "#666",
        fontSize: "11px",
        letterSpacing: "2px",
        marginBottom: "16px",
        textAlign: "center",
      },
    });
    classPicker.appendChild(classTitle);

    // Create draggable class cards
    for (const classInfo of NPC_CLASS_OPTIONS) {
      const style = this.CLASS_STYLES[classInfo.name] ?? { icon: "?", color: "#333" };

      const card = createElement("div", {
        className: "class-source-card",
        attributes: { draggable: "true", "data-class": classInfo.name },
        styles: {
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "12px 16px",
          marginBottom: "8px",
          backgroundColor: "#252540",
          borderRadius: "8px",
          cursor: "grab",
          borderLeft: `4px solid ${style.color}`,
          transition: "transform 0.15s, box-shadow 0.15s",
        },
      });

      const icon = createElement("span", {
        textContent: style.icon,
        styles: { fontSize: "24px" },
      });

      const info = createElement("div", { styles: { flex: "1" } });
      const name = createElement("div", {
        textContent: classInfo.display,
        styles: { fontWeight: "bold", fontSize: "14px", color: "#fff" },
      });
      const desc = createElement("div", {
        textContent: classInfo.description,
        styles: { fontSize: "10px", color: "#888", marginTop: "2px" },
      });

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
    const partyArea = createElement("div", {
      styles: { flex: "1" },
    });

    // Player slot at top
    const playerSection = createElement("div", {
      styles: { marginBottom: "32px" },
    });
    const playerLabel = createElement("div", {
      textContent: "YOUR CHARACTER",
      styles: {
        color: "#666",
        fontSize: "11px",
        letterSpacing: "2px",
        marginBottom: "12px",
      },
    });
    const playerSlot = createElement("div", {
      id: ELEMENTS.partyPlayerSlot,
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "20px",
        backgroundColor: "#2a2a4a",
        borderRadius: "12px",
        border: "2px solid #e94560",
      },
    });
    const playerIcon = createElement("div", {
      textContent: "👤",
      styles: { fontSize: "40px" },
    });
    const playerInfo = createElement("div", { styles: { flex: "1" } });
    const playerName = createElement("div", {
      className: "player-name",
      textContent: "Select a character...",
      styles: { fontSize: "18px", fontWeight: "bold", color: "#fff" },
    });
    const playerClass = createElement("div", {
      className: "player-class",
      textContent: "",
      styles: { fontSize: "12px", color: "#888", marginTop: "4px" },
    });
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
      styles: {
        color: "#666",
        fontSize: "11px",
        letterSpacing: "2px",
        marginBottom: "12px",
      },
    });
    partyArea.appendChild(npcLabel);

    // NPC slots grid - 7 slots
    const slotsGrid = createElement("div", {
      id: ELEMENTS.partyNpcSlots,
      styles: {
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "12px",
      },
    });

    // Create 7 empty slots
    for (let i = 0; i < 7; i++) {
      const slot = this.createEmptySlot(i);
      slotsGrid.appendChild(slot);
    }

    partyArea.appendChild(slotsGrid);

    // DM Options Section
    const dmOptionsSection = createElement("div", {
      id: "dm-options-section",
      styles: {
        marginTop: "32px",
        padding: "20px",
        backgroundColor: "#252540",
        borderRadius: "12px",
        border: "2px solid #ffd700",
      },
    });

    const dmOptionsTitle = createElement("div", {
      textContent: "⚙️ DM OPTIONS",
      styles: {
        color: "#ffd700",
        fontSize: "12px",
        letterSpacing: "2px",
        marginBottom: "16px",
        fontWeight: "bold",
      },
    });
    dmOptionsSection.appendChild(dmOptionsTitle);

    const dmOptionsGrid = createElement("div", {
      styles: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "16px",
      },
    });

    // Monster Count
    const monsterCountGroup = createElement("div", {
      styles: { display: "flex", flexDirection: "column", gap: "6px" },
    });
    const monsterCountLabel = createElement("label", {
      textContent: "Monster Count",
      styles: { color: "#888", fontSize: "12px" },
    });
    const monsterCountInput = createElement("input", {
      id: "dm-monster-count",
      attributes: { type: "number", min: "1", max: "20", value: "10" },
      styles: {
        padding: "10px 12px",
        backgroundColor: "#1a1a2e",
        border: "1px solid #3a3a5e",
        borderRadius: "6px",
        color: "#fff",
        fontSize: "14px",
      },
    });
    monsterCountGroup.appendChild(monsterCountLabel);
    monsterCountGroup.appendChild(monsterCountInput);
    dmOptionsGrid.appendChild(monsterCountGroup);

    // Player Move Range
    const moveRangeGroup = createElement("div", {
      styles: { display: "flex", flexDirection: "column", gap: "6px" },
    });
    const moveRangeLabel = createElement("label", {
      textContent: "Player Move Range",
      styles: { color: "#888", fontSize: "12px" },
    });
    const moveRangeInput = createElement("input", {
      id: "dm-move-range",
      attributes: { type: "number", min: "1", max: "10", value: "3" },
      styles: {
        padding: "10px 12px",
        backgroundColor: "#1a1a2e",
        border: "1px solid #3a3a5e",
        borderRadius: "6px",
        color: "#fff",
        fontSize: "14px",
      },
    });
    moveRangeGroup.appendChild(moveRangeLabel);
    moveRangeGroup.appendChild(moveRangeInput);
    dmOptionsGrid.appendChild(moveRangeGroup);

    dmOptionsSection.appendChild(dmOptionsGrid);
    partyArea.appendChild(dmOptionsSection);

    // Buttons at bottom
    const buttonArea = createElement("div", {
      styles: {
        display: "flex",
        justifyContent: "center",
        gap: "16px",
        marginTop: "40px",
      },
    });

    const backBtn = createElement("button", {
      id: ELEMENTS.partyBackBtn,
      textContent: "← Back",
      className: "secondary-btn",
      styles: {
        padding: "12px 32px",
        fontSize: "16px",
        borderRadius: "8px",
        cursor: "pointer",
      },
    });

    const startBtn = createElement("button", {
      id: ELEMENTS.partyStartBtn,
      textContent: "Start Game →",
      className: "primary-btn",
      styles: {
        padding: "12px 32px",
        fontSize: "16px",
        borderRadius: "8px",
        cursor: "pointer",
      },
    });

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
      styles: {
        aspectRatio: "1",
        backgroundColor: "#1a1a2e",
        borderRadius: "12px",
        border: "2px dashed #333",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "border-color 0.2s, background-color 0.2s",
      },
    });

    const plus = createElement("div", {
      textContent: "+",
      styles: {
        fontSize: "32px",
        color: "#444",
        lineHeight: "1",
      },
    });
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
      styles: {
        aspectRatio: "1",
        backgroundColor: style.color,
        borderRadius: "12px",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      },
    });

    // Remove button
    const removeBtn = createElement("div", {
      textContent: "×",
      styles: {
        position: "absolute",
        top: "8px",
        right: "8px",
        width: "24px",
        height: "24px",
        borderRadius: "50%",
        backgroundColor: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        fontSize: "16px",
        color: "#fff",
      },
    });
    removeBtn.addEventListener("click", () => {
      this.removeNpcFromSlot(index);
    });
    slot.appendChild(removeBtn);

    // Icon
    const icon = createElement("div", {
      textContent: style.icon,
      styles: {
        fontSize: "36px",
        textAlign: "center",
        marginTop: "8px",
      },
    });
    slot.appendChild(icon);

    // Class name
    const classLabel = createElement("div", {
      textContent: NPC_CLASS_OPTIONS.find(c => c.name === npc.className)?.display ?? npc.className,
      styles: {
        fontSize: "12px",
        fontWeight: "bold",
        textAlign: "center",
        color: "#fff",
        marginTop: "8px",
      },
    });
    slot.appendChild(classLabel);

    // Name input
    const nameInput = createElement("input", {
      attributes: {
        type: "text",
        value: npc.name,
        placeholder: "Name...",
      },
      styles: {
        marginTop: "auto",
        width: "100%",
        padding: "6px",
        border: "none",
        borderRadius: "4px",
        backgroundColor: "rgba(0,0,0,0.3)",
        color: "#fff",
        fontSize: "11px",
        textAlign: "center",
        boxSizing: "border-box",
      },
    }) as HTMLInputElement;
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

  private createPartySetupHandler(): ScreenHandler {
    return {
      enter: (state: MultiplayerState) => {
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
      npcClasses: this.partySlots.map(s => s.className),
      monsterCount,
      playerMoveRange,
    };
  }

  /**
   * Setup event listeners for all screens.
   */
  private setupEventListeners(): void {
    // Login button - handles both Pocket ID and name-based login
    document.getElementById(ELEMENTS.loginBtn)?.addEventListener("click", () => {
      const authEnabled = this.callbacks.isAuthEnabled();
      if (authEnabled) {
        this.callbacks.onLogin();
      } else {
        // Name-based login for dev mode
        const nameInput = document.getElementById(ELEMENTS.loginNameInput) as HTMLInputElement;
        const name = nameInput?.value?.trim();
        if (name && name.length >= 2) {
          this.callbacks.onLoginWithName(name);
        } else {
          const statusEl = document.getElementById(ELEMENTS.loginStatus);
          if (statusEl) {
            statusEl.textContent = "Please enter a name (at least 2 characters)";
          }
        }
      }
    });

    // Name input - allow Enter key to login
    document.getElementById(ELEMENTS.loginNameInput)?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        document.getElementById(ELEMENTS.loginBtn)?.click();
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

    // Party setup - Back button
    document.getElementById(ELEMENTS.partyBackBtn)?.addEventListener("click", () => {
      this.callbacks.onBackToMainMenu();
    });

    // Party setup - Start game button
    document.getElementById(ELEMENTS.partyStartBtn)?.addEventListener("click", () => {
      if (this.selectedCharacterId) {
        const config = this.getPartyConfig();
        this.callbacks.onCreateGame(this.selectedCharacterId, config);
      }
    });

    // Join game button - opens character selector first
    document.getElementById(ELEMENTS.joinGameBtn)?.addEventListener("click", async () => {
      const input = document.getElementById(ELEMENTS.joinCodeInput) as HTMLInputElement;
      const joinCode = input?.value?.trim().toUpperCase();
      if (joinCode && joinCode.length === 6) {
        const character = await selectCharacter();
        if (character) {
          this.callbacks.onJoinGame(joinCode, character.id);
        }
      }
    });

    // Ready button
    document.getElementById(ELEMENTS.readyBtn)?.addEventListener("click", () => {
      const btn = document.getElementById(ELEMENTS.readyBtn);
      const isReady = btn?.classList.contains("ready");
      this.callbacks.onSetReady(!isReady);
    });

    // Start game button (DM only)
    document.getElementById(ELEMENTS.startGameBtn)?.addEventListener("click", () => {
      this.callbacks.onStartGame();
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
  // Screen Handlers
  // ===========================================================================

  private createLoginHandler(): ScreenHandler {
    return {
      enter: () => {
        const statusEl = document.getElementById(ELEMENTS.loginStatus);
        if (statusEl) {
          statusEl.textContent = "";
        }

        // Check if auth is enabled and show/hide name input accordingly
        const authEnabled = this.callbacks.isAuthEnabled();
        const nameSection = document.getElementById("login-name-section");
        const loginBtn = document.getElementById(ELEMENTS.loginBtn);

        if (nameSection && loginBtn) {
          if (authEnabled) {
            nameSection.style.display = "none";
            loginBtn.textContent = "Login with Pocket ID";
          } else {
            nameSection.style.display = "block";
            loginBtn.textContent = "Join Game";
          }
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

        // Show/hide start button based on DM status
        const startBtn = document.getElementById(ELEMENTS.startGameBtn);
        if (startBtn) {
          startBtn.style.display = state.isDM ? "block" : "none";
        }
      },
      exit: () => {
        // Reset ready button
        const readyBtn = document.getElementById(ELEMENTS.readyBtn);
        if (readyBtn) {
          readyBtn.classList.remove("ready");
          readyBtn.textContent = "Ready";
        }
      },
      update: (state) => {
        this.renderLobbyPlayers(state.players);

        // Update lobby title with player count
        const titleEl = document.getElementById("lobby-title");
        if (titleEl) {
          titleEl.textContent = `Game Lobby (${state.players.length} players)`;
        }

        // Update connection status
        const lobbyStatusEl = document.getElementById("lobby-connection-status");
        if (lobbyStatusEl) {
          const statusMap: Record<string, { text: string; cls: string }> = {
            disconnected: { text: "Disconnected", cls: "status-disconnected" },
            connecting: { text: "Connecting...", cls: "status-connecting" },
            authenticating: { text: "Authenticating...", cls: "status-connecting" },
            connected: { text: "Connected", cls: "status-connected" },
            reconnecting: { text: "Reconnecting...", cls: "status-reconnecting" },
          };
          const info = statusMap[state.connectionStatus] ?? statusMap.disconnected;
          lobbyStatusEl.textContent = info!.text;
          lobbyStatusEl.className = `connection-status ${info!.cls}`;
        }

        // Update game status message
        const gameStatusEl = document.getElementById("lobby-game-status");
        if (gameStatusEl) {
          const allReady = state.players.every((p) => p.ready || p.isDM);
          const readyCount = state.players.filter((p) => p.ready || p.isDM).length;
          if (state.players.length < 2) {
            gameStatusEl.textContent = "Waiting for more players to join...";
            gameStatusEl.className = "lobby-game-status waiting";
          } else if (allReady) {
            gameStatusEl.textContent = state.isDM
              ? "All players ready! Click Start Game"
              : "All players ready! Waiting for DM to start...";
            gameStatusEl.className = "lobby-game-status ready";
          } else {
            gameStatusEl.textContent = `${readyCount}/${state.players.length} players ready`;
            gameStatusEl.className = "lobby-game-status waiting";
          }
        }

        // Update start button state
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
        // Hide other UI elements that might interfere
        const startScreen = document.getElementById("start-screen");
        if (startScreen) startScreen.style.display = "none";

        const charSelect = document.getElementById("character-select");
        if (charSelect) charSelect.style.display = "none";
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
