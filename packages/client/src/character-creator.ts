/**
 * Character Creator UI
 *
 * Modal dialog for creating and editing characters with customization options.
 */

import {
  type LocalCharacter,
  type CharacterClass,
  type CharacterAppearance,
  type CharacterInput,
  createCharacter,
  updateCharacter,
  getAllCharacters,
  deleteCharacter,
  getDefaultAppearance,
  validateCharacter,
} from "./db/character-db.js";

// =============================================================================
// Types
// =============================================================================

export interface CharacterCreatorOptions {
  /** Called when a character is selected or created */
  onSelect: (character: LocalCharacter) => void;
  /** Called when the modal is closed without selection */
  onCancel?: () => void;
  /** Whether to show character list for selection */
  showList?: boolean;
  /** Pre-select a character by ID */
  preselectedId?: string;
}

// =============================================================================
// Character Class Definitions
// =============================================================================

interface ClassInfo {
  id: CharacterClass;
  name: string;
  description: string;
  icon: string;
}

const CLASS_INFO: ClassInfo[] = [
  {
    id: "warrior",
    name: "Warrior",
    description: "A master of martial combat. High HP and defense.",
    icon: "/sprites/players/fighter.svg",
  },
  {
    id: "ranger",
    name: "Ranger",
    description: "A skilled archer and tracker. Balanced stats with range.",
    icon: "/sprites/players/elf.svg",
  },
  {
    id: "mage",
    name: "Mage",
    description: "A wielder of arcane power. High attack but fragile.",
    icon: "/sprites/players/mage.svg",
  },
  {
    id: "rogue",
    name: "Rogue",
    description: "A master of stealth and speed. High initiative.",
    icon: "/sprites/players/thief.svg",
  },
];

// =============================================================================
// Appearance Options
// =============================================================================

const SKIN_TONES = [
  "#ffecd2",
  "#f5deb3",
  "#dfc49c",
  "#c4a07a",
  "#a67c52",
  "#8d5524",
  "#6b4423",
  "#4a2c17",
];

const HAIR_COLORS = [
  "#1a1a1a",
  "#3d2314",
  "#5c3317",
  "#8b4513",
  "#a0522d",
  "#808080",
  "#d4a574",
  "#ffcc00",
  "#cc0000",
  "#0066cc",
  "#00cc66",
  "#cc00cc",
];

const BODY_TYPES = [
  { id: "small" as const, name: "Small" },
  { id: "medium" as const, name: "Medium" },
  { id: "large" as const, name: "Large" },
];

const HAIR_STYLES = [
  { id: "bald" as const, name: "Bald" },
  { id: "short" as const, name: "Short" },
  { id: "medium" as const, name: "Medium" },
  { id: "long" as const, name: "Long" },
  { id: "ponytail" as const, name: "Ponytail" },
];

const FACIAL_HAIR = [
  { id: "none" as const, name: "None" },
  { id: "stubble" as const, name: "Stubble" },
  { id: "beard" as const, name: "Beard" },
  { id: "mustache" as const, name: "Mustache" },
];

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
// Character Creator Class
// =============================================================================

export class CharacterCreator {
  private overlay: HTMLDivElement;
  private modal: HTMLDivElement;
  private options: CharacterCreatorOptions;

  // Form state
  private mode: "list" | "create" | "edit" = "list";
  private editingCharacter: LocalCharacter | null = null;
  private selectedClass: CharacterClass = "warrior";
  private appearance: CharacterAppearance = getDefaultAppearance("warrior");
  private name: string = "";
  private backstory: string = "";

  constructor(options: CharacterCreatorOptions) {
    this.options = options;
    this.overlay = document.createElement("div");
    this.modal = document.createElement("div");
    this.createModal();
  }

  /**
   * Show the character creator modal.
   */
  async show(): Promise<void> {
    document.body.appendChild(this.overlay);

    if (this.options.showList !== false) {
      await this.showCharacterList();
    } else {
      this.showCreateForm();
    }
  }

  /**
   * Close the modal.
   */
  close(): void {
    this.overlay.remove();
  }

  // ===========================================================================
  // Modal Creation
  // ===========================================================================

  private createModal(): void {
    this.overlay.className = "character-creator-overlay";
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.options.onCancel?.();
        this.close();
      }
    });

    this.modal.className = "character-creator-modal";
    this.overlay.appendChild(this.modal);

    // Add styles if not already present
    this.injectStyles();
  }

  private injectStyles(): void {
    if (document.getElementById("character-creator-styles")) return;

    const style = document.createElement("style");
    style.id = "character-creator-styles";
    style.textContent = `
      .character-creator-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .character-creator-modal {
        background: #1a1a2e;
        border: 2px solid #3a3a5e;
        border-radius: 12px;
        padding: 24px;
        max-width: 600px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        color: #e0e0e0;
      }

      .character-creator-modal h2 {
        margin: 0 0 20px;
        color: #ffd700;
        text-align: center;
      }

      .character-creator-modal h3 {
        margin: 16px 0 8px;
        color: #a0a0c0;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .character-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .character-list-item {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px;
        background: #2a2a4e;
        border: 2px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .character-list-item:hover {
        border-color: #5a5a8e;
      }

      .character-list-item.selected {
        border-color: #ffd700;
        background: #3a3a5e;
      }

      .character-list-item img {
        width: 48px;
        height: 48px;
        object-fit: contain;
      }

      .character-list-info {
        flex: 1;
      }

      .character-list-name {
        font-size: 16px;
        font-weight: bold;
      }

      .character-list-class {
        font-size: 12px;
        color: #a0a0c0;
      }

      .character-list-actions {
        display: flex;
        gap: 8px;
      }

      .class-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }

      .class-option {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 16px;
        background: #2a2a4e;
        border: 2px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .class-option:hover {
        border-color: #5a5a8e;
      }

      .class-option.selected {
        border-color: #ffd700;
        background: #3a3a5e;
      }

      .class-option img {
        width: 64px;
        height: 64px;
        object-fit: contain;
        margin-bottom: 8px;
      }

      .class-option-name {
        font-weight: bold;
        margin-bottom: 4px;
      }

      .class-option-desc {
        font-size: 11px;
        color: #a0a0c0;
        text-align: center;
      }

      .color-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .color-swatch {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition: all 0.2s;
      }

      .color-swatch:hover {
        transform: scale(1.1);
      }

      .color-swatch.selected {
        border-color: #ffd700;
        box-shadow: 0 0 8px rgba(255, 215, 0, 0.5);
      }

      .option-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .option-btn {
        padding: 8px 16px;
        background: #2a2a4e;
        border: 2px solid transparent;
        border-radius: 6px;
        color: #e0e0e0;
        cursor: pointer;
        transition: all 0.2s;
      }

      .option-btn:hover {
        border-color: #5a5a8e;
      }

      .option-btn.selected {
        border-color: #ffd700;
        background: #3a3a5e;
      }

      .form-group {
        margin-bottom: 16px;
      }

      .form-group label {
        display: block;
        margin-bottom: 6px;
        color: #a0a0c0;
        font-size: 14px;
      }

      .form-input {
        width: 100%;
        padding: 10px 12px;
        background: #2a2a4e;
        border: 2px solid #3a3a5e;
        border-radius: 6px;
        color: #e0e0e0;
        font-size: 14px;
        box-sizing: border-box;
      }

      .form-input:focus {
        outline: none;
        border-color: #ffd700;
      }

      .form-input.error {
        border-color: #ff4444;
      }

      .error-message {
        color: #ff4444;
        font-size: 12px;
        margin-top: 4px;
      }

      .modal-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        margin-top: 24px;
      }

      .btn-primary {
        padding: 12px 24px;
        background: #ffd700;
        border: none;
        border-radius: 6px;
        color: #1a1a2e;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-primary:hover {
        background: #ffed4a;
      }

      .btn-primary:disabled {
        background: #666;
        cursor: not-allowed;
      }

      .btn-secondary {
        padding: 12px 24px;
        background: transparent;
        border: 2px solid #5a5a8e;
        border-radius: 6px;
        color: #e0e0e0;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-secondary:hover {
        border-color: #8a8ab0;
      }

      .btn-danger {
        padding: 8px 12px;
        background: transparent;
        border: 1px solid #ff4444;
        border-radius: 4px;
        color: #ff4444;
        font-size: 12px;
        cursor: pointer;
      }

      .btn-danger:hover {
        background: rgba(255, 68, 68, 0.1);
      }

      .btn-small {
        padding: 6px 12px;
        font-size: 12px;
      }

      .empty-state {
        text-align: center;
        padding: 32px;
        color: #a0a0c0;
      }

      .empty-state p {
        margin-bottom: 16px;
      }
    `;
    document.head.appendChild(style);
  }

  // ===========================================================================
  // Character List View
  // ===========================================================================

  private async showCharacterList(): Promise<void> {
    this.mode = "list";
    const characters = await getAllCharacters();

    // Clear modal
    while (this.modal.firstChild) {
      this.modal.removeChild(this.modal.firstChild);
    }

    const header = el("h2", {}, "Select Character");
    this.modal.appendChild(header);

    if (characters.length === 0) {
      const empty = el("div", { className: "empty-state" });
      const emptyText = el("p", {}, "You don't have any characters yet.");
      empty.appendChild(emptyText);

      const createBtn = el("button", { className: "btn-primary" }, "Create Your First Character");
      createBtn.addEventListener("click", () => this.showCreateForm());
      empty.appendChild(createBtn);

      this.modal.appendChild(empty);
      return;
    }

    const list = el("div", { className: "character-list" });

    for (const char of characters) {
      const item = this.createCharacterListItem(char);
      list.appendChild(item);
    }

    this.modal.appendChild(list);

    // Actions
    const actions = el("div", { className: "modal-actions" });

    const createBtn = el("button", { className: "btn-secondary" }, "Create New");
    createBtn.addEventListener("click", () => this.showCreateForm());
    actions.appendChild(createBtn);

    const cancelBtn = el("button", { className: "btn-secondary" }, "Cancel");
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });
    actions.appendChild(cancelBtn);

    this.modal.appendChild(actions);
  }

  private createCharacterListItem(char: LocalCharacter): HTMLDivElement {
    const item = el("div", { className: "character-list-item" });

    if (this.options.preselectedId === char.id) {
      item.classList.add("selected");
    }

    // Icon
    const classInfo = CLASS_INFO.find((c) => c.id === char.class) ?? CLASS_INFO[0]!;
    const icon = el("img", { src: classInfo.icon, alt: classInfo.name });
    item.appendChild(icon);

    // Info
    const info = el("div", { className: "character-list-info" });
    const nameDiv = el("div", { className: "character-list-name" }, char.name);
    const classDiv = el("div", { className: "character-list-class" },
      `Level ${char.serverData?.level ?? 1} ${classInfo.name}`
    );
    info.appendChild(nameDiv);
    info.appendChild(classDiv);
    item.appendChild(info);

    // Actions
    const actionsDiv = el("div", { className: "character-list-actions" });

    const editBtn = el("button", { className: "btn-secondary btn-small" }, "Edit");
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showEditForm(char);
    });
    actionsDiv.appendChild(editBtn);

    const deleteBtn = el("button", { className: "btn-danger btn-small" }, "Delete");
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete ${char.name}? This cannot be undone.`)) {
        await deleteCharacter(char.id);
        await this.showCharacterList();
      }
    });
    actionsDiv.appendChild(deleteBtn);

    item.appendChild(actionsDiv);

    // Click to select
    item.addEventListener("click", () => {
      this.options.onSelect(char);
      this.close();
    });

    return item;
  }

  // ===========================================================================
  // Create/Edit Form
  // ===========================================================================

  private showCreateForm(): void {
    this.mode = "create";
    this.editingCharacter = null;
    this.selectedClass = "warrior";
    this.appearance = getDefaultAppearance("warrior");
    this.name = "";
    this.backstory = "";
    this.renderForm();
  }

  private showEditForm(character: LocalCharacter): void {
    this.mode = "edit";
    this.editingCharacter = character;
    this.selectedClass = character.class;
    this.appearance = { ...character.appearance };
    this.name = character.name;
    this.backstory = character.backstory ?? "";
    this.renderForm();
  }

  private renderForm(): void {
    // Clear modal
    while (this.modal.firstChild) {
      this.modal.removeChild(this.modal.firstChild);
    }

    const header = el("h2", {},
      this.mode === "edit" ? "Edit Character" : "Create Character"
    );
    this.modal.appendChild(header);

    // Name input
    const nameGroup = el("div", { className: "form-group" });
    const nameLabel = el("label", { for: "char-name" }, "Character Name");
    nameGroup.appendChild(nameLabel);

    const nameInput = el("input", {
      type: "text",
      id: "char-name",
      className: "form-input",
      placeholder: "Enter character name (3-30 characters)",
      maxlength: "30",
    }) as HTMLInputElement;
    nameInput.value = this.name;
    nameInput.addEventListener("input", () => {
      this.name = nameInput.value;
    });
    nameGroup.appendChild(nameInput);
    this.modal.appendChild(nameGroup);

    // Class selection
    const classSection = el("h3", {}, "Class");
    this.modal.appendChild(classSection);

    const classGrid = el("div", { className: "class-grid" });

    for (const classInfo of CLASS_INFO) {
      const option = el("div", {
        className: `class-option ${classInfo.id === this.selectedClass ? "selected" : ""}`,
      });

      const icon = el("img", { src: classInfo.icon, alt: classInfo.name });
      option.appendChild(icon);

      const nameDiv = el("div", { className: "class-option-name" }, classInfo.name);
      option.appendChild(nameDiv);

      const descDiv = el("div", { className: "class-option-desc" }, classInfo.description);
      option.appendChild(descDiv);

      option.addEventListener("click", () => {
        this.selectedClass = classInfo.id;
        this.appearance = getDefaultAppearance(classInfo.id);
        this.renderForm();
      });
      classGrid.appendChild(option);
    }

    this.modal.appendChild(classGrid);

    // Appearance section
    const appearanceSection = el("h3", {}, "Appearance");
    this.modal.appendChild(appearanceSection);

    // Body type
    this.modal.appendChild(this.createOptionSection("Body Type", BODY_TYPES, this.appearance.bodyType, (val) => {
      this.appearance.bodyType = val as CharacterAppearance["bodyType"];
    }));

    // Skin tone
    this.modal.appendChild(this.createColorSection("Skin Tone", SKIN_TONES, this.appearance.skinTone, (val) => {
      this.appearance.skinTone = val;
    }));

    // Hair color
    this.modal.appendChild(this.createColorSection("Hair Color", HAIR_COLORS, this.appearance.hairColor, (val) => {
      this.appearance.hairColor = val;
    }));

    // Hair style
    this.modal.appendChild(this.createOptionSection("Hair Style", HAIR_STYLES, this.appearance.hairStyle, (val) => {
      this.appearance.hairStyle = val as CharacterAppearance["hairStyle"];
    }));

    // Facial hair
    this.modal.appendChild(this.createOptionSection("Facial Hair", FACIAL_HAIR, this.appearance.facialHair ?? "none", (val) => {
      this.appearance.facialHair = val as CharacterAppearance["facialHair"];
    }));

    // Backstory (optional)
    const backstoryGroup = el("div", { className: "form-group" });
    const backstoryLabel = el("label", { for: "char-backstory" }, "Backstory (optional)");
    backstoryGroup.appendChild(backstoryLabel);

    const backstoryInput = document.createElement("textarea");
    backstoryInput.id = "char-backstory";
    backstoryInput.className = "form-input";
    backstoryInput.value = this.backstory;
    backstoryInput.placeholder = "Tell us about your character...";
    backstoryInput.rows = 3;
    backstoryInput.addEventListener("input", () => {
      this.backstory = backstoryInput.value;
    });
    backstoryGroup.appendChild(backstoryInput);
    this.modal.appendChild(backstoryGroup);

    // Actions
    const actions = el("div", { className: "modal-actions" });

    const backBtn = el("button", { className: "btn-secondary" }, "Back");
    backBtn.addEventListener("click", () => this.showCharacterList());
    actions.appendChild(backBtn);

    const saveBtn = el("button", { className: "btn-primary" },
      this.mode === "edit" ? "Save Changes" : "Create Character"
    );
    saveBtn.addEventListener("click", () => this.saveCharacter());
    actions.appendChild(saveBtn);

    this.modal.appendChild(actions);
  }

  private createColorSection(
    label: string,
    colors: string[],
    selected: string,
    onChange: (value: string) => void
  ): HTMLDivElement {
    const group = el("div", { className: "form-group" });

    const labelEl = el("label", {}, label);
    group.appendChild(labelEl);

    const grid = el("div", { className: "color-grid" });

    for (const color of colors) {
      const swatch = el("button", {
        type: "button",
        className: `color-swatch ${color === selected ? "selected" : ""}`,
      });
      swatch.style.backgroundColor = color;
      swatch.addEventListener("click", () => {
        onChange(color);
        grid.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
        swatch.classList.add("selected");
      });
      grid.appendChild(swatch);
    }

    group.appendChild(grid);
    return group;
  }

  private createOptionSection(
    label: string,
    options: Array<{ id: string; name: string }>,
    selected: string,
    onChange: (value: string) => void
  ): HTMLDivElement {
    const group = el("div", { className: "form-group" });

    const labelEl = el("label", {}, label);
    group.appendChild(labelEl);

    const grid = el("div", { className: "option-grid" });

    for (const opt of options) {
      const btn = el("button", {
        type: "button",
        className: `option-btn ${opt.id === selected ? "selected" : ""}`,
      }, opt.name);
      btn.addEventListener("click", () => {
        onChange(opt.id);
        grid.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
      grid.appendChild(btn);
    }

    group.appendChild(grid);
    return group;
  }

  // ===========================================================================
  // Form Submission
  // ===========================================================================

  private async saveCharacter(): Promise<void> {
    const input: CharacterInput = {
      name: this.name,
      class: this.selectedClass,
      appearance: this.appearance,
      backstory: this.backstory || null,
    };

    // Validate
    const errors = validateCharacter(input);
    if (errors.length > 0) {
      // Show first error
      const nameInput = this.modal.querySelector("#char-name") as HTMLInputElement;
      if (nameInput && errors.some((e) => e.field === "name")) {
        nameInput.classList.add("error");
        // Remove existing error message
        const existingError = nameInput.parentElement?.querySelector(".error-message");
        if (existingError) existingError.remove();
        // Add new error message
        const errorDiv = el("div", { className: "error-message" },
          errors.find((e) => e.field === "name")?.message ?? ""
        );
        nameInput.parentElement?.appendChild(errorDiv);
      }
      return;
    }

    try {
      let character: LocalCharacter;

      if (this.mode === "edit" && this.editingCharacter) {
        character = await updateCharacter(this.editingCharacter.id, input);
      } else {
        character = await createCharacter(input);
      }

      this.options.onSelect(character);
      this.close();
    } catch (error) {
      console.error("[character-creator] Failed to save:", error);
      alert(`Failed to save character: ${(error as Error).message}`);
    }
  }
}

// =============================================================================
// Convenience Function
// =============================================================================

/**
 * Open the character creator modal and return a promise that resolves
 * with the selected/created character.
 */
export function selectCharacter(
  options?: Partial<CharacterCreatorOptions>
): Promise<LocalCharacter | null> {
  return new Promise((resolve) => {
    const creator = new CharacterCreator({
      onSelect: (character) => resolve(character),
      onCancel: () => resolve(null),
      showList: true,
      ...options,
    });
    creator.show();
  });
}
