/**
 * Loot system for Rune Forge.
 * Handles weapon definitions, loot generation, and inventory management.
 */

import type { LootDrop, LootItem, PlayerInventory, Position } from "./types.js";

// =============================================================================
// Weapon Definitions
// =============================================================================

export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;
  readonly attackBonus: number;
  readonly rarity: "common" | "uncommon" | "rare";
  readonly dropWeight: number; // Higher = more likely to drop
  readonly price: number; // Gold price at merchant
}

export const WEAPON_DEFINITIONS: ReadonlyArray<WeaponDefinition> = [
  { id: "rusty_dagger", name: "Rusty Dagger", attackBonus: 1, rarity: "common", dropWeight: 40, price: 10 },
  { id: "iron_sword", name: "Iron Sword", attackBonus: 2, rarity: "common", dropWeight: 30, price: 25 },
  { id: "steel_blade", name: "Steel Blade", attackBonus: 3, rarity: "uncommon", dropWeight: 20, price: 50 },
  { id: "enchanted_axe", name: "Enchanted Axe", attackBonus: 5, rarity: "rare", dropWeight: 10, price: 100 },
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
      attackBonus: weapon.attackBonus,
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
 * Get the attack bonus from the equipped weapon.
 */
export function getEquippedWeaponBonus(inventory: PlayerInventory): number {
  if (!inventory.equippedWeaponId) {
    return 0;
  }

  const weapon = inventory.weapons.find(w => w.id === inventory.equippedWeaponId);
  return weapon?.attackBonus ?? 0;
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
        // Auto-equip if better than current
        const currentBonus = getEquippedWeaponBonus({ ...inventory, weapons, equippedWeaponId });
        if ((item.attackBonus ?? 0) > currentBonus) {
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
