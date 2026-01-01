/**
 * Character and monster definitions with sprite paths.
 *
 * Download sprites from:
 * - https://www.spriters-resource.com/arcade/ddshadovermyst/ (Shadow Over Mystara)
 * - https://www.spriters-resource.com/nes/advanceddungeonsdragonspoolofradiance/
 *
 * Place sprites in:
 * - public/sprites/players/[class].png
 * - public/sprites/monsters/[type].png
 */

export interface CharacterClass {
  id: string;
  name: string;
  description: string;
  sprite: string;
  color: number; // Fallback color if sprite not loaded
  stats: {
    hp: number;
    attack: number;
    defense: number;
    initiative: number;
    moveRange: number;
    attackRange: number;
  };
}

export interface MonsterType {
  id: string;
  name: string;
  sprite: string;
  color: number;
  stats: {
    hp: number;
    attack: number;
    defense: number;
    initiative: number;
    moveRange: number;
    attackRange: number;
  };
}

export const CHARACTER_CLASSES: CharacterClass[] = [
  {
    id: "fighter",
    name: "Fighter",
    description: "A master of martial combat, skilled with a variety of weapons and armor.",
    sprite: "/sprites/players/fighter.svg",
    color: 0xcc4444,
    stats: { hp: 60, attack: 12, defense: 8, initiative: 10, moveRange: 4, attackRange: 1 },
  },
  {
    id: "cleric",
    name: "Cleric",
    description: "A priestly champion who wields divine magic in service of a higher power.",
    sprite: "/sprites/players/cleric.svg",
    color: 0xeeeeaa,
    stats: { hp: 45, attack: 8, defense: 10, initiative: 8, moveRange: 3, attackRange: 1 },
  },
  {
    id: "mage",
    name: "Mage",
    description: "A scholarly magic-user capable of manipulating the structures of reality.",
    sprite: "/sprites/players/mage.svg",
    color: 0x6644cc,
    stats: { hp: 30, attack: 14, defense: 4, initiative: 12, moveRange: 3, attackRange: 3 },
  },
  {
    id: "thief",
    name: "Thief",
    description: "A scoundrel who uses stealth and trickery to overcome obstacles.",
    sprite: "/sprites/players/thief.svg",
    color: 0x444444,
    stats: { hp: 35, attack: 10, defense: 5, initiative: 15, moveRange: 5, attackRange: 1 },
  },
  {
    id: "elf",
    name: "Elf",
    description: "A graceful warrior with keen senses and affinity for magic.",
    sprite: "/sprites/players/elf.svg",
    color: 0x44aa44,
    stats: { hp: 40, attack: 10, defense: 6, initiative: 14, moveRange: 4, attackRange: 2 },
  },
  {
    id: "dwarf",
    name: "Dwarf",
    description: "A stout and sturdy warrior, resistant to poison and magic.",
    sprite: "/sprites/players/dwarf.svg",
    color: 0xaa6633,
    stats: { hp: 55, attack: 11, defense: 12, initiative: 6, moveRange: 3, attackRange: 1 },
  },
];

export const MONSTER_TYPES: MonsterType[] = [
  // Base monsters (matching server dm-commands.ts)
  {
    id: "goblin",
    name: "Goblin",
    sprite: "/sprites/monsters/goblin.svg",
    color: 0x88aa44,
    stats: { hp: 6, attack: 2, defense: 1, initiative: 4, moveRange: 4, attackRange: 1 },
  },
  {
    id: "goblin_archer",
    name: "Goblin Archer",
    sprite: "/sprites/monsters/goblin.svg", // Reuse goblin sprite
    color: 0x99bb55,
    stats: { hp: 4, attack: 3, defense: 0, initiative: 3, moveRange: 3, attackRange: 4 },
  },
  {
    id: "orc",
    name: "Orc",
    sprite: "/sprites/monsters/orc.svg",
    color: 0x556633,
    stats: { hp: 12, attack: 4, defense: 2, initiative: 2, moveRange: 3, attackRange: 1 },
  },
  {
    id: "orc_warlord",
    name: "Orc Warlord",
    sprite: "/sprites/monsters/orc.svg", // Reuse orc sprite
    color: 0x445522,
    stats: { hp: 20, attack: 5, defense: 3, initiative: 3, moveRange: 3, attackRange: 1 },
  },
  {
    id: "skeleton",
    name: "Skeleton",
    sprite: "/sprites/monsters/skeleton.svg",
    color: 0xddddcc,
    stats: { hp: 8, attack: 3, defense: 2, initiative: 2, moveRange: 3, attackRange: 1 },
  },
  {
    id: "skeleton_archer",
    name: "Skeleton Archer",
    sprite: "/sprites/monsters/skeleton.svg", // Reuse skeleton sprite
    color: 0xccccbb,
    stats: { hp: 6, attack: 3, defense: 1, initiative: 3, moveRange: 2, attackRange: 5 },
  },
  {
    id: "wolf",
    name: "Dire Wolf",
    sprite: "/sprites/monsters/gnoll.svg", // Use gnoll as wolf-like
    color: 0x666666,
    stats: { hp: 8, attack: 3, defense: 1, initiative: 5, moveRange: 5, attackRange: 1 },
  },
  {
    id: "troll",
    name: "Troll",
    sprite: "/sprites/monsters/troll.svg",
    color: 0x446644,
    stats: { hp: 25, attack: 6, defense: 2, initiative: 1, moveRange: 2, attackRange: 1 },
  },
  {
    id: "dragon_wyrmling",
    name: "Dragon Wyrmling",
    sprite: "/sprites/monsters/beholder.svg", // Use beholder for now
    color: 0xcc4444,
    stats: { hp: 30, attack: 7, defense: 4, initiative: 3, moveRange: 4, attackRange: 3 },
  },
  // Legacy monsters (for single-player mode compatibility)
  {
    id: "kobold",
    name: "Kobold",
    sprite: "/sprites/monsters/kobold.svg",
    color: 0xcc6644,
    stats: { hp: 15, attack: 4, defense: 2, initiative: 12, moveRange: 4, attackRange: 1 },
  },
  {
    id: "gnoll",
    name: "Gnoll",
    sprite: "/sprites/monsters/gnoll.svg",
    color: 0x997755,
    stats: { hp: 40, attack: 9, defense: 5, initiative: 7, moveRange: 4, attackRange: 1 },
  },
  {
    id: "owlbear",
    name: "Owlbear",
    sprite: "/sprites/monsters/owlbear.svg",
    color: 0x886644,
    stats: { hp: 50, attack: 12, defense: 6, initiative: 6, moveRange: 3, attackRange: 1 },
  },
  {
    id: "beholder",
    name: "Beholder",
    sprite: "/sprites/monsters/beholder.svg",
    color: 0x884488,
    stats: { hp: 45, attack: 15, defense: 3, initiative: 11, moveRange: 2, attackRange: 4 },
  },
];

export function getCharacterClass(id: string): CharacterClass | undefined {
  return CHARACTER_CLASSES.find(c => c.id === id);
}

export function getMonsterType(id: string): MonsterType | undefined {
  return MONSTER_TYPES.find(m => m.id === id);
}

/** Lookup monster type by name (case-insensitive). */
export function getMonsterTypeByName(name: string): MonsterType | undefined {
  const lowerName = name.toLowerCase();
  return MONSTER_TYPES.find(m => m.name.toLowerCase() === lowerName);
}

export function getRandomMonsterTypes(count: number): MonsterType[] {
  const shuffled = [...MONSTER_TYPES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
