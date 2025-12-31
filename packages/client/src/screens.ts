/**
 * Screen State Machine
 *
 * Manages UI transitions and screen-specific rendering for multiplayer mode.
 * Each screen has its own enter/exit handlers and UI elements.
 */

import type { MultiplayerState, MultiplayerScreen, LobbyPlayer } from "./multiplayer.js";
import type { ConnectionStatus } from "./ws.js";

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

/** Screen manager callbacks */
export interface ScreenManagerCallbacks {
  onLogin: () => void;
  onDevLogin: (name: string) => void;
  onLogout: () => void;
  onCreateGame: (characterId: string) => void;
  onJoinGame: (joinCode: string, characterId: string) => void;
  onLeaveGame: () => void;
  onSetReady: (ready: boolean) => void;
  onStartGame: () => void;
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

  constructor(callbacks: ScreenManagerCallbacks) {
    this.callbacks = callbacks;

    // Initialize handlers for each screen
    this.handlers = {
      login: this.createLoginHandler(),
      main_menu: this.createMainMenuHandler(),
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
    const classes = [
      { value: "warrior", label: "Warrior - High HP & Defense" },
      { value: "ranger", label: "Ranger - Ranged Attacks" },
      { value: "mage", label: "Mage - High Damage" },
      { value: "rogue", label: "Rogue - Fast & Agile" },
    ];
    for (const cls of classes) {
      const option = document.createElement("option");
      option.value = cls.value;
      option.textContent = cls.label;
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

    const content = createElement("div", { className: "screen-content" });

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

    // Create game button - opens character selection modal
    document.getElementById(ELEMENTS.createGameBtn)?.addEventListener("click", () => {
      this.pendingAction = { type: "create" };
      this.showCharacterModal();
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
        className: "character-item",
      });
      charEl.dataset.characterId = char.id;

      const info = createElement("div", { className: "character-info" });
      const name = createElement("span", {
        className: "character-name",
        textContent: char.name,
      });
      const details = createElement("span", {
        className: "character-details",
        textContent: `Level ${char.level} ${char.class.charAt(0).toUpperCase() + char.class.slice(1)}`,
      });
      info.appendChild(name);
      info.appendChild(details);

      const selectBtn = createElement("button", {
        className: "select-btn",
        textContent: "Select",
      });
      selectBtn.addEventListener("click", () => {
        this.selectCharacterAndProceed(char.id);
      });

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
