/**
 * Character IndexedDB Storage
 *
 * Client-side storage for characters with offline support.
 * Characters are stored locally and synced to server when online.
 */

// =============================================================================
// Types
// =============================================================================

export type CharacterClass = "warrior" | "ranger" | "mage" | "rogue";

export interface CharacterAppearance {
  bodyType: "small" | "medium" | "large";
  skinTone: string;
  hairColor: string;
  hairStyle: "bald" | "short" | "medium" | "long" | "ponytail";
  facialHair?: "none" | "stubble" | "beard" | "mustache";
}

export interface LocalCharacter {
  id: string;
  name: string;
  class: CharacterClass;
  appearance: CharacterAppearance;
  backstory: string | null;
  createdAt: number;
  updatedAt: number;
  /** Whether this character needs to be synced to server */
  pendingSync: boolean;
  /** Server-assigned data after sync (null if not synced) */
  serverData: {
    level: number;
    xp: number;
    gold: number;
    silver: number;
  } | null;
}

export interface CharacterInput {
  name: string;
  class: CharacterClass;
  appearance: CharacterAppearance;
  backstory?: string | null;
}

// =============================================================================
// Database Constants
// =============================================================================

const DB_NAME = "rune-forge";
const DB_VERSION = 1;
const STORE_CHARACTERS = "characters";
const STORE_SYNC_QUEUE = "sync_queue";

// =============================================================================
// UUID Generation
// =============================================================================

export function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// =============================================================================
// Validation
// =============================================================================

export interface ValidationError {
  field: string;
  message: string;
}

export function validateCharacter(input: CharacterInput): ValidationError[] {
  const errors: ValidationError[] = [];

  // Name validation (3-30 chars)
  if (!input.name || input.name.trim().length < 3) {
    errors.push({ field: "name", message: "Name must be at least 3 characters" });
  } else if (input.name.trim().length > 30) {
    errors.push({ field: "name", message: "Name must be 30 characters or less" });
  }

  // Class validation
  const validClasses: CharacterClass[] = ["warrior", "ranger", "mage", "rogue"];
  if (!validClasses.includes(input.class)) {
    errors.push({ field: "class", message: "Invalid character class" });
  }

  // Appearance validation
  if (!input.appearance) {
    errors.push({ field: "appearance", message: "Appearance is required" });
  } else {
    const validBodyTypes = ["small", "medium", "large"];
    if (!validBodyTypes.includes(input.appearance.bodyType)) {
      errors.push({ field: "appearance.bodyType", message: "Invalid body type" });
    }

    const validHairStyles = ["bald", "short", "medium", "long", "ponytail"];
    if (!validHairStyles.includes(input.appearance.hairStyle)) {
      errors.push({ field: "appearance.hairStyle", message: "Invalid hair style" });
    }

    // Validate colors are hex format
    const hexColorRegex = /^#[0-9a-fA-F]{6}$/;
    if (!hexColorRegex.test(input.appearance.skinTone)) {
      errors.push({ field: "appearance.skinTone", message: "Invalid skin tone (use hex color)" });
    }
    if (!hexColorRegex.test(input.appearance.hairColor)) {
      errors.push({ field: "appearance.hairColor", message: "Invalid hair color (use hex color)" });
    }
  }

  return errors;
}

// =============================================================================
// Database Initialization
// =============================================================================

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("[character-db] Failed to open database:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log("[character-db] Database opened successfully");
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      console.log("[character-db] Upgrading database schema...");
      const db = (event.target as IDBOpenDBRequest).result;

      // Characters store
      if (!db.objectStoreNames.contains(STORE_CHARACTERS)) {
        const charStore = db.createObjectStore(STORE_CHARACTERS, { keyPath: "id" });
        charStore.createIndex("name", "name", { unique: false });
        charStore.createIndex("pendingSync", "pendingSync", { unique: false });
        charStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      // Sync queue store (for offline-created characters)
      if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
        const syncStore = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: "id" });
        syncStore.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
  });

  return dbPromise;
}

// =============================================================================
// Character CRUD Operations
// =============================================================================

/**
 * Create a new character.
 */
export async function createCharacter(input: CharacterInput): Promise<LocalCharacter> {
  const errors = validateCharacter(input);
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.map((e) => e.message).join(", ")}`);
  }

  const now = Date.now();
  const character: LocalCharacter = {
    id: generateUUID(),
    name: input.name.trim(),
    class: input.class,
    appearance: input.appearance,
    backstory: input.backstory ?? null,
    createdAt: now,
    updatedAt: now,
    pendingSync: true,
    serverData: null,
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHARACTERS, STORE_SYNC_QUEUE], "readwrite");
    const charStore = tx.objectStore(STORE_CHARACTERS);
    const syncStore = tx.objectStore(STORE_SYNC_QUEUE);

    // Add to characters store
    const charRequest = charStore.add(character);
    charRequest.onerror = () => reject(charRequest.error);

    // Add to sync queue
    syncStore.add({ id: character.id, createdAt: now, type: "create" });

    tx.oncomplete = () => {
      console.log(`[character-db] Created character: ${character.name} (${character.id})`);
      resolve(character);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get a character by ID.
 */
export async function getCharacter(id: string): Promise<LocalCharacter | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHARACTERS, "readonly");
    const store = tx.objectStore(STORE_CHARACTERS);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all characters, sorted by most recently updated.
 */
export async function getAllCharacters(): Promise<LocalCharacter[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHARACTERS, "readonly");
    const store = tx.objectStore(STORE_CHARACTERS);
    const index = store.index("updatedAt");
    const request = index.openCursor(null, "prev");

    const characters: LocalCharacter[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        characters.push(cursor.value);
        cursor.continue();
      } else {
        resolve(characters);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update a character's persona (client-owned fields).
 */
export async function updateCharacter(
  id: string,
  updates: Partial<CharacterInput>
): Promise<LocalCharacter> {
  const db = await openDB();
  const existing = await getCharacter(id);

  if (!existing) {
    throw new Error("Character not found");
  }

  // Merge updates
  const updated: LocalCharacter = {
    ...existing,
    name: updates.name?.trim() ?? existing.name,
    class: updates.class ?? existing.class,
    appearance: updates.appearance ?? existing.appearance,
    backstory: updates.backstory !== undefined ? updates.backstory : existing.backstory,
    updatedAt: Date.now(),
    pendingSync: true,
  };

  // Validate merged result
  const errors = validateCharacter(updated);
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.map((e) => e.message).join(", ")}`);
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHARACTERS, STORE_SYNC_QUEUE], "readwrite");
    const charStore = tx.objectStore(STORE_CHARACTERS);
    const syncStore = tx.objectStore(STORE_SYNC_QUEUE);

    charStore.put(updated);
    syncStore.put({ id: updated.id, createdAt: Date.now(), type: "update" });

    tx.oncomplete = () => {
      console.log(`[character-db] Updated character: ${updated.name} (${updated.id})`);
      resolve(updated);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Delete a character.
 */
export async function deleteCharacter(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHARACTERS, STORE_SYNC_QUEUE], "readwrite");
    const charStore = tx.objectStore(STORE_CHARACTERS);
    const syncStore = tx.objectStore(STORE_SYNC_QUEUE);

    charStore.delete(id);
    // Add delete to sync queue so server knows to delete too
    syncStore.put({ id, createdAt: Date.now(), type: "delete" });

    tx.oncomplete = () => {
      console.log(`[character-db] Deleted character: ${id}`);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// =============================================================================
// Sync Queue Operations
// =============================================================================

export interface SyncQueueItem {
  id: string;
  createdAt: number;
  type: "create" | "update" | "delete";
}

/**
 * Get all pending sync items.
 */
export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SYNC_QUEUE, "readonly");
    const store = tx.objectStore(STORE_SYNC_QUEUE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Mark a character as synced (remove from queue, update flag).
 */
export async function markSynced(
  id: string,
  serverData?: LocalCharacter["serverData"]
): Promise<void> {
  const db = await openDB();
  const character = await getCharacter(id);

  if (!character) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHARACTERS, STORE_SYNC_QUEUE], "readwrite");
    const charStore = tx.objectStore(STORE_CHARACTERS);
    const syncStore = tx.objectStore(STORE_SYNC_QUEUE);

    // Update character
    charStore.put({
      ...character,
      pendingSync: false,
      serverData: serverData ?? character.serverData,
    });

    // Remove from sync queue
    syncStore.delete(id);

    tx.oncomplete = () => {
      console.log(`[character-db] Marked synced: ${id}`);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Clear the sync queue for a specific item (e.g., on sync failure that shouldn't retry).
 */
export async function removeSyncItem(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SYNC_QUEUE, "readwrite");
    const store = tx.objectStore(STORE_SYNC_QUEUE);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// =============================================================================
// Default Character (for quick start)
// =============================================================================

const DEFAULT_APPEARANCES: Record<CharacterClass, CharacterAppearance> = {
  warrior: {
    bodyType: "large",
    skinTone: "#c4a07a",
    hairColor: "#3d2314",
    hairStyle: "short",
    facialHair: "stubble",
  },
  ranger: {
    bodyType: "medium",
    skinTone: "#dfc49c",
    hairColor: "#5c3317",
    hairStyle: "long",
    facialHair: "none",
  },
  mage: {
    bodyType: "small",
    skinTone: "#f5deb3",
    hairColor: "#808080",
    hairStyle: "medium",
    facialHair: "beard",
  },
  rogue: {
    bodyType: "medium",
    skinTone: "#8d5524",
    hairColor: "#1a1a1a",
    hairStyle: "short",
    facialHair: "none",
  },
};

/**
 * Get or create a default character for quick start.
 */
export async function getOrCreateDefaultCharacter(): Promise<LocalCharacter> {
  const all = await getAllCharacters();

  // Return first character if any exist
  if (all.length > 0) {
    return all[0]!;
  }

  // Create a default warrior
  return createCharacter({
    name: "Hero",
    class: "warrior",
    appearance: DEFAULT_APPEARANCES.warrior,
  });
}

/**
 * Get default appearance for a class.
 */
export function getDefaultAppearance(charClass: CharacterClass): CharacterAppearance {
  return { ...DEFAULT_APPEARANCES[charClass] };
}
