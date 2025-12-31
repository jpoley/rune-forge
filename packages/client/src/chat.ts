/**
 * Chat UI Component
 *
 * Provides in-game chat with broadcast and whisper support.
 */

// =============================================================================
// Types
// =============================================================================

export interface ChatMessage {
  id: string;
  from: string;
  fromName: string;
  message: string;
  isWhisper: boolean;
  isSystem: boolean;
  timestamp: number;
}

export interface ChatOptions {
  onSend: (message: string, target?: string) => void;
  onClose?: () => void;
  players?: Array<{ id: string; name: string }>;
}

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
// Chat UI Class
// =============================================================================

export class ChatUI {
  private container: HTMLDivElement;
  private messagesContainer: HTMLDivElement;
  private input: HTMLInputElement;
  private options: ChatOptions;
  private messages: ChatMessage[] = [];
  private isExpanded: boolean = false;
  private unreadCount: number = 0;

  constructor(parentContainer: HTMLElement, options: ChatOptions) {
    this.options = options;
    this.container = this.createContainer();
    this.messagesContainer = this.container.querySelector(".chat-messages") as HTMLDivElement;
    this.input = this.container.querySelector(".chat-input") as HTMLInputElement;

    parentContainer.appendChild(this.container);
    this.injectStyles();
    this.setupEventListeners();
  }

  private createContainer(): HTMLDivElement {
    const container = el("div", { className: "chat-container collapsed" });

    // Header with toggle and unread badge
    const header = el("div", { className: "chat-header" });
    const title = el("span", { className: "chat-title" }, "Chat");
    const badge = el("span", { className: "chat-badge hidden" }, "0");
    const toggleBtn = el("button", { className: "chat-toggle" }, "^");
    header.appendChild(title);
    header.appendChild(badge);
    header.appendChild(toggleBtn);
    container.appendChild(header);

    // Messages area
    const messages = el("div", { className: "chat-messages" });
    container.appendChild(messages);

    // Input area
    const inputArea = el("div", { className: "chat-input-area" });
    const input = el("input", {
      type: "text",
      className: "chat-input",
      placeholder: "Type a message...",
      maxlength: "500",
    }) as HTMLInputElement;
    const sendBtn = el("button", { className: "chat-send" }, "Send");
    inputArea.appendChild(input);
    inputArea.appendChild(sendBtn);
    container.appendChild(inputArea);

    return container;
  }

  private injectStyles(): void {
    if (document.getElementById("chat-styles")) return;

    const style = document.createElement("style");
    style.id = "chat-styles";
    style.textContent = `
      .chat-container {
        position: fixed;
        bottom: 16px;
        left: 16px;
        width: 320px;
        background: rgba(26, 26, 46, 0.95);
        border: 1px solid #3a3a5e;
        border-radius: 8px;
        z-index: 100;
        display: flex;
        flex-direction: column;
        transition: all 0.3s ease;
      }

      .chat-container.collapsed {
        height: 40px;
        overflow: hidden;
      }

      .chat-container.collapsed .chat-messages,
      .chat-container.collapsed .chat-input-area {
        display: none;
      }

      .chat-header {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        background: #2a2a4e;
        border-radius: 8px 8px 0 0;
        cursor: pointer;
        user-select: none;
      }

      .chat-title {
        flex: 1;
        color: #e0e0e0;
        font-weight: bold;
        font-size: 14px;
      }

      .chat-badge {
        background: #ff4444;
        color: white;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 10px;
        margin-right: 8px;
      }

      .chat-badge.hidden {
        display: none;
      }

      .chat-toggle {
        background: none;
        border: none;
        color: #a0a0c0;
        font-size: 14px;
        cursor: pointer;
        padding: 4px 8px;
        transition: transform 0.3s ease;
      }

      .chat-container.collapsed .chat-toggle {
        transform: rotate(180deg);
      }

      .chat-messages {
        flex: 1;
        min-height: 150px;
        max-height: 250px;
        overflow-y: auto;
        padding: 8px;
      }

      .chat-message {
        padding: 4px 0;
        font-size: 13px;
        line-height: 1.4;
        word-wrap: break-word;
      }

      .chat-message-name {
        font-weight: bold;
        color: #ffd700;
      }

      .chat-message-text {
        color: #e0e0e0;
      }

      .chat-message.whisper .chat-message-name {
        color: #cc66cc;
      }

      .chat-message.whisper .chat-message-text {
        color: #d0a0d0;
        font-style: italic;
      }

      .chat-message.system {
        color: #a0a0c0;
        font-style: italic;
      }

      .chat-input-area {
        display: flex;
        gap: 8px;
        padding: 8px;
        border-top: 1px solid #3a3a5e;
      }

      .chat-input {
        flex: 1;
        padding: 8px 12px;
        background: #2a2a4e;
        border: 1px solid #3a3a5e;
        border-radius: 4px;
        color: #e0e0e0;
        font-size: 13px;
      }

      .chat-input:focus {
        outline: none;
        border-color: #5a5a8e;
      }

      .chat-send {
        padding: 8px 16px;
        background: #ffd700;
        border: none;
        border-radius: 4px;
        color: #1a1a2e;
        font-weight: bold;
        cursor: pointer;
        font-size: 12px;
      }

      .chat-send:hover {
        background: #ffed4a;
      }

      .chat-timestamp {
        font-size: 10px;
        color: #666;
        margin-left: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  private setupEventListeners(): void {
    // Toggle expand/collapse
    const header = this.container.querySelector(".chat-header");
    header?.addEventListener("click", () => this.toggle());

    // Send button
    const sendBtn = this.container.querySelector(".chat-send");
    sendBtn?.addEventListener("click", () => this.sendMessage());

    // Enter key to send
    this.input.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Focus input when expanded
    this.input.addEventListener("focus", () => {
      if (!this.isExpanded) {
        this.expand();
      }
    });
  }

  private toggle(): void {
    if (this.isExpanded) {
      this.collapse();
    } else {
      this.expand();
    }
  }

  private expand(): void {
    this.isExpanded = true;
    this.container.classList.remove("collapsed");
    this.unreadCount = 0;
    this.updateBadge();
    this.scrollToBottom();
  }

  private collapse(): void {
    this.isExpanded = false;
    this.container.classList.add("collapsed");
  }

  private updateBadge(): void {
    const badge = this.container.querySelector(".chat-badge");
    if (badge) {
      badge.textContent = String(this.unreadCount);
      badge.classList.toggle("hidden", this.unreadCount === 0);
    }
  }

  private scrollToBottom(): void {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private sendMessage(): void {
    const message = this.input.value.trim();
    if (!message) return;

    // Check for whisper syntax: /w <name> <message>
    const whisperMatch = message.match(/^\/w\s+(\S+)\s+(.+)$/);
    if (whisperMatch) {
      const [, targetName, whisperMessage] = whisperMatch;
      const target = this.options.players?.find(
        (p) => p.name.toLowerCase() === targetName!.toLowerCase()
      );
      if (target) {
        this.options.onSend(whisperMessage!, target.id);
      } else {
        this.addSystemMessage(`Player "${targetName}" not found`);
      }
    } else {
      this.options.onSend(message);
    }

    this.input.value = "";
  }

  /**
   * Add a received message to the chat.
   */
  addMessage(msg: Omit<ChatMessage, "id" | "timestamp">): void {
    const fullMsg: ChatMessage = {
      ...msg,
      id: crypto.randomUUID?.() ?? String(Date.now()),
      timestamp: Date.now(),
    };

    this.messages.push(fullMsg);

    // Keep only last 100 messages
    if (this.messages.length > 100) {
      this.messages.shift();
      this.messagesContainer.removeChild(this.messagesContainer.firstChild!);
    }

    // Create message element
    const msgEl = el("div", {
      className: `chat-message ${msg.isWhisper ? "whisper" : ""} ${msg.isSystem ? "system" : ""}`,
    });

    if (msg.isSystem) {
      msgEl.appendChild(document.createTextNode(msg.message));
    } else {
      const nameSpan = el("span", { className: "chat-message-name" },
        msg.isWhisper ? `[whisper] ${msg.fromName}` : msg.fromName
      );
      const separator = document.createTextNode(": ");
      const textSpan = el("span", { className: "chat-message-text" }, msg.message);

      msgEl.appendChild(nameSpan);
      msgEl.appendChild(separator);
      msgEl.appendChild(textSpan);
    }

    this.messagesContainer.appendChild(msgEl);

    // Update unread count if collapsed
    if (!this.isExpanded) {
      this.unreadCount++;
      this.updateBadge();
    } else {
      this.scrollToBottom();
    }
  }

  /**
   * Add a system message.
   */
  addSystemMessage(message: string): void {
    this.addMessage({
      from: "system",
      fromName: "System",
      message,
      isWhisper: false,
      isSystem: true,
    });
  }

  /**
   * Update the list of players for whisper autocomplete.
   */
  updatePlayers(players: Array<{ id: string; name: string }>): void {
    this.options.players = players;
  }

  /**
   * Destroy the chat UI.
   */
  destroy(): void {
    this.container.remove();
  }

  /**
   * Focus the chat input.
   */
  focus(): void {
    this.expand();
    this.input.focus();
  }
}
