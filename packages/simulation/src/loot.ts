/**
 * Loot system for Rune Forge.
 * Handles weapon definitions, loot generation, and inventory management.
 */

import type { LootDrop, LootItem, PlayerInventory, Position } from "./types.js";

// =============================================================================
// Weapon Definitions (D&D-style)
// =============================================================================

export type WeaponType = "melee" | "ranged";

export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;
  readonly damage: number;       // Base damage (like D&D dice average)
  readonly range: number;        // Attack range in tiles (1 = melee adjacent)
  readonly weaponType: WeaponType;
  readonly rarity: "common" | "uncommon" | "rare";
  readonly dropWeight: number;   // Higher = more likely to drop
  readonly price: number;        // Gold price at merchant
}

// D&D-inspired damage values (based on dice averages):
// Dagger: 1d4 = ~2, Short Sword: 1d6 = ~3, Longsword: 1d8 = ~4
// Shortbow: 1d6 = ~3 (range 5), Longbow: 1d8 = ~4 (range 8)
export const WEAPON_DEFINITIONS: ReadonlyArray<WeaponDefinition> = [
  // Melee weapons (range 1 = adjacent only)
  { id: "dagger", name: "Dagger", damage: 2, range: 1, weaponType: "melee", rarity: "common", dropWeight: 40, price: 5 },
  { id: "short_sword", name: "Short Sword", damage: 3, range: 1, weaponType: "melee", rarity: "common", dropWeight: 30, price: 10 },
  { id: "longsword", name: "Longsword", damage: 4, range: 1, weaponType: "melee", rarity: "common", dropWeight: 20, price: 25 },
  { id: "battleaxe", name: "Battleaxe", damage: 5, range: 1, weaponType: "melee", rarity: "uncommon", dropWeight: 15, price: 40 },
  { id: "greatsword", name: "Greatsword", damage: 6, range: 1, weaponType: "melee", rarity: "uncommon", dropWeight: 10, price: 75 },
  // Ranged weapons
  { id: "shortbow", name: "Shortbow", damage: 3, range: 5, weaponType: "ranged", rarity: "common", dropWeight: 25, price: 15 },
  { id: "longbow", name: "Longbow", damage: 4, range: 8, weaponType: "ranged", rarity: "uncommon", dropWeight: 15, price: 50 },
  { id: "crossbow", name: "Crossbow", damage: 5, range: 6, weaponType: "ranged", rarity: "uncommon", dropWeight: 10, price: 60 },
] as const;

// =============================================================================
// Constants
// =============================================================================

export const LOOT_DROP_CHANCE_COINS = 0.80; // 80% chance for coins
export const LOOT_DROP_CHANCE_WEAPON = 0.25; // 25% chance for weapon

export const COIN_GOLD_MIN = 1;
export const COIN_GOLD_MAX = 5;
export const COIN_SILVER_MIN = 5;
export const COIN_SILVER_MAX = 20;

// =============================================================================
// Default Inventory
// =============================================================================

export const DEFAULT_INVENTORY: PlayerInventory = {
  gold: 0,
  silver: 0,
  weapons: [],
  equippedWeaponId: null,
};

// =============================================================================
// Seeded Random (deterministic)
// =============================================================================

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// =============================================================================
// Loot Generation
// =============================================================================

let lootIdCounter = 0;

/**
 * Generate a loot drop for a defeated unit.
 * Uses deterministic RNG based on seed for reproducibility.
 */
export function generateLootDrop(
  position: Position,
  seed: number
): LootDrop | null {
  const random = seededRandom(seed);
  const items: LootItem[] = [];

  // Roll for coins (80% chance)
  if (random() < LOOT_DROP_CHANCE_COINS) {
    // Generate gold coins
    const goldCount = Math.floor(random() * (COIN_GOLD_MAX - COIN_GOLD_MIN + 1)) + COIN_GOLD_MIN;
    items.push({
      id: `gold_${lootIdCounter++}`,
      type: "gold",
      name: `${goldCount} Gold`,
      value: goldCount,
    });

    // Generate silver coins
    const silverCount = Math.floor(random() * (COIN_SILVER_MAX - COIN_SILVER_MIN + 1)) + COIN_SILVER_MIN;
    items.push({
      id: `silver_${lootIdCounter++}`,
      type: "silver",
      name: `${silverCount} Silver`,
      value: silverCount,
    });
  }

  // Roll for weapon (25% chance)
  if (random() < LOOT_DROP_CHANCE_WEAPON) {
    const weapon = selectRandomWeapon(random);
    items.push({
      id: `weapon_${lootIdCounter++}`,
      type: "weapon",
      name: weapon.name,
      damage: weapon.damage,
      range: weapon.range,
      weaponType: weapon.weaponType,
    });
  }

  // Return null if no loot dropped
  if (items.length === 0) {
    return null;
  }

  return {
    id: `loot_${lootIdCounter++}`,
    position,
    items,
  };
}

/**
 * Select a random weapon based on drop weights.
 */
function selectRandomWeapon(random: () => number): WeaponDefinition {
  const totalWeight = WEAPON_DEFINITIONS.reduce((sum, w) => sum + w.dropWeight, 0);
  let roll = random() * totalWeight;

  for (const weapon of WEAPON_DEFINITIONS) {
    roll -= weapon.dropWeight;
    if (roll <= 0) {
      return weapon;
    }
  }

  // Fallback to first weapon
  return WEAPON_DEFINITIONS[0]!;
}

// =============================================================================
// Inventory Management
// =============================================================================

/**
 * Get the equipped weapon's stats.
 */
export function getEquippedWeapon(inventory: PlayerInventory): { damage: number; range: number; weaponType: "melee" | "ranged" } | null {
  if (!inventory.equippedWeaponId) {
    return null;
  }

  const weapon = inventory.weapons.find(w => w.id === inventory.equippedWeaponId);
  if (!weapon) return null;

  return {
    damage: weapon.damage ?? 0,
    range: weapon.range ?? 1,
    weaponType: weapon.weaponType ?? "melee",
  };
}

/**
 * Get the attack damage from the equipped weapon.
 * Returns 0 if no weapon equipped (unarmed).
 */
export function getEquippedWeaponDamage(inventory: PlayerInventory): number {
  const weapon = getEquippedWeapon(inventory);
  return weapon?.damage ?? 0;
}

/**
 * Get the attack range from the equipped weapon.
 * Returns 1 if no weapon equipped (melee range).
 */
export function getEquippedWeaponRange(inventory: PlayerInventory): number {
  const weapon = getEquippedWeapon(inventory);
  return weapon?.range ?? 1;
}

/**
 * Collect loot and add to inventory.
 * Automatically equips a weapon if it's better than current.
 */
export function collectLoot(
  inventory: PlayerInventory,
  lootDrop: LootDrop
): PlayerInventory {
  let gold = inventory.gold;
  let silver = inventory.silver;
  const weapons = [...inventory.weapons];
  let equippedWeaponId = inventory.equippedWeaponId;

  for (const item of lootDrop.items) {
    switch (item.type) {
      case "gold":
        gold += item.value ?? 0;
        break;
      case "silver":
        silver += item.value ?? 0;
        break;
      case "weapon":
        weapons.push(item);
        // Auto-equip if better damage than current
        const currentDamage = getEquippedWeaponDamage({ ...inventory, weapons, equippedWeaponId });
        if ((item.damage ?? 0) > currentDamage) {
          equippedWeaponId = item.id;
        }
        break;
    }
  }

  return {
    gold,
    silver,
    weapons,
    equippedWeaponId,
  };
}

/**
 * Check if a unit can collect loot at a position.
 * Unit must be adjacent (including diagonals) or on the same tile.
 */
export function canCollectLoot(
  unitPosition: Position,
  lootPosition: Position
): boolean {
  const dx = Math.abs(unitPosition.x - lootPosition.x);
  const dy = Math.abs(unitPosition.y - lootPosition.y);
  return dx <= 1 && dy <= 1;
}
