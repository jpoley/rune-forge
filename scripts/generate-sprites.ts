#!/usr/bin/env bun
/**
 * Generate placeholder sprites for Rune Forge characters and monsters.
 *
 * Usage: bun run scripts/generate-sprites.ts
 *
 * For real D&D sprites, download from:
 * - https://www.spriters-resource.com/arcade/ddshadovermyst/
 * - https://opengameart.org/content/16x16-fantasy-pixel-art-characters
 * - https://opengameart.org/content/dungeon-crawl-32x32-tiles
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const SPRITE_SIZE = 64;
const OUTPUT_DIR = join(import.meta.dir, "../packages/client/public/sprites");

// Character definitions with colors
const PLAYERS = [
  { id: "fighter", color: "#cc4444", weapon: "sword" },
  { id: "cleric", color: "#eeeeaa", weapon: "mace" },
  { id: "mage", color: "#6644cc", weapon: "staff" },
  { id: "thief", color: "#444444", weapon: "dagger" },
  { id: "elf", color: "#44aa44", weapon: "bow" },
  { id: "dwarf", color: "#aa6633", weapon: "axe" },
];

const MONSTERS = [
  { id: "goblin", color: "#88aa44", type: "small" },
  { id: "orc", color: "#556633", type: "large" },
  { id: "skeleton", color: "#ddddcc", type: "undead" },
  { id: "kobold", color: "#cc6644", type: "small" },
  { id: "gnoll", color: "#997755", type: "large" },
  { id: "owlbear", color: "#886644", type: "beast" },
  { id: "troll", color: "#446644", type: "large" },
  { id: "beholder", color: "#884488", type: "aberration" },
];

/**
 * Generate SVG for a player character.
 */
function generatePlayerSVG(color: string, weapon: string): string {
  const skinTone = "#ffd8b0";

  let weaponSVG = "";
  switch (weapon) {
    case "sword":
      weaponSVG = `<rect x="48" y="20" width="4" height="30" fill="#888" stroke="#444" stroke-width="1"/>
                   <rect x="44" y="18" width="12" height="6" fill="#654" stroke="#432" stroke-width="1"/>`;
      break;
    case "mace":
      weaponSVG = `<rect x="50" y="24" width="3" height="24" fill="#654"/>
                   <circle cx="51" cy="20" r="8" fill="#888" stroke="#444" stroke-width="1"/>`;
      break;
    case "staff":
      weaponSVG = `<rect x="50" y="10" width="3" height="44" fill="#654"/>
                   <circle cx="51" cy="8" r="6" fill="#88f" stroke="#44a" stroke-width="1"/>`;
      break;
    case "dagger":
      weaponSVG = `<polygon points="52,28 56,40 52,42 48,40" fill="#aaa" stroke="#666" stroke-width="1"/>`;
      break;
    case "bow":
      weaponSVG = `<path d="M 48 16 Q 56 32 48 48" fill="none" stroke="#654" stroke-width="3"/>
                   <line x1="48" y1="16" x2="48" y2="48" stroke="#876" stroke-width="1"/>`;
      break;
    case "axe":
      weaponSVG = `<rect x="50" y="20" width="3" height="28" fill="#654"/>
                   <path d="M 46 18 L 58 22 L 58 32 L 46 36 Z" fill="#888" stroke="#444" stroke-width="1"/>`;
      break;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 64 64">
    <!-- Body -->
    <ellipse cx="32" cy="44" rx="14" ry="16" fill="${color}" stroke="#000" stroke-width="2"/>
    <!-- Head -->
    <circle cx="32" cy="20" r="12" fill="${skinTone}" stroke="#000" stroke-width="1"/>
    <!-- Helmet/Hair -->
    <path d="M 20 20 Q 20 8 32 8 Q 44 8 44 20" fill="${color}" stroke="#000" stroke-width="1"/>
    <!-- Eyes -->
    <circle cx="27" cy="18" r="2" fill="#000"/>
    <circle cx="37" cy="18" r="2" fill="#000"/>
    <!-- Mouth -->
    <path d="M 28 24 Q 32 28 36 24" fill="none" stroke="#000" stroke-width="1"/>
    <!-- Weapon -->
    ${weaponSVG}
  </svg>`;
}

/**
 * Generate SVG for a monster.
 */
function generateMonsterSVG(color: string, type: string): string {
  switch (type) {
    case "small":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 64 64">
        <!-- Body -->
        <ellipse cx="32" cy="40" rx="16" ry="18" fill="${color}" stroke="#000" stroke-width="2"/>
        <!-- Ears -->
        <polygon points="12,30 20,20 22,32" fill="${color}" stroke="#000" stroke-width="1"/>
        <polygon points="52,30 44,20 42,32" fill="${color}" stroke="#000" stroke-width="1"/>
        <!-- Eyes -->
        <ellipse cx="24" cy="34" rx="6" ry="4" fill="#ff0" stroke="#000" stroke-width="1"/>
        <ellipse cx="40" cy="34" rx="6" ry="4" fill="#ff0" stroke="#000" stroke-width="1"/>
        <circle cx="24" cy="34" r="2" fill="#f00"/>
        <circle cx="40" cy="34" r="2" fill="#f00"/>
        <!-- Nose -->
        <circle cx="32" cy="42" r="3" fill="#654"/>
        <!-- Mouth -->
        <path d="M 24 50 L 28 54 L 32 50 L 36 54 L 40 50" fill="none" stroke="#000" stroke-width="2"/>
      </svg>`;

    case "large":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 64 64">
        <!-- Body -->
        <ellipse cx="32" cy="38" rx="22" ry="22" fill="${color}" stroke="#000" stroke-width="2"/>
        <!-- Tusks -->
        <polygon points="18,44 14,56 22,48" fill="#fff" stroke="#000" stroke-width="1"/>
        <polygon points="46,44 50,56 42,48" fill="#fff" stroke="#000" stroke-width="1"/>
        <!-- Eyes -->
        <circle cx="22" cy="30" r="5" fill="#ff0" stroke="#000" stroke-width="1"/>
        <circle cx="42" cy="30" r="5" fill="#ff0" stroke="#000" stroke-width="1"/>
        <circle cx="22" cy="30" r="2" fill="#f00"/>
        <circle cx="42" cy="30" r="2" fill="#f00"/>
        <!-- Brow -->
        <path d="M 14 24 L 30 28" fill="none" stroke="#000" stroke-width="3"/>
        <path d="M 50 24 L 34 28" fill="none" stroke="#000" stroke-width="3"/>
      </svg>`;

    case "undead":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 64 64">
        <!-- Skull -->
        <ellipse cx="32" cy="24" rx="16" ry="14" fill="${color}" stroke="#000" stroke-width="2"/>
        <!-- Eye sockets -->
        <ellipse cx="24" cy="22" rx="5" ry="6" fill="#000"/>
        <ellipse cx="40" cy="22" rx="5" ry="6" fill="#000"/>
        <!-- Eye glow -->
        <circle cx="24" cy="22" r="2" fill="#f44"/>
        <circle cx="40" cy="22" r="2" fill="#f44"/>
        <!-- Nose -->
        <polygon points="32,28 28,34 36,34" fill="#000"/>
        <!-- Teeth -->
        <rect x="22" y="36" width="20" height="8" fill="${color}" stroke="#000" stroke-width="1"/>
        <line x1="26" y1="36" x2="26" y2="44" stroke="#000" stroke-width="1"/>
        <line x1="30" y1="36" x2="30" y2="44" stroke="#000" stroke-width="1"/>
        <line x1="34" y1="36" x2="34" y2="44" stroke="#000" stroke-width="1"/>
        <line x1="38" y1="36" x2="38" y2="44" stroke="#000" stroke-width="1"/>
        <!-- Ribs -->
        <path d="M 20 48 Q 32 52 44 48" fill="none" stroke="${color}" stroke-width="3"/>
        <path d="M 22 54 Q 32 58 42 54" fill="none" stroke="${color}" stroke-width="3"/>
      </svg>`;

    case "beast":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 64 64">
        <!-- Body -->
        <ellipse cx="32" cy="42" rx="24" ry="18" fill="${color}" stroke="#000" stroke-width="2"/>
        <!-- Owl face -->
        <circle cx="32" cy="24" r="18" fill="${color}" stroke="#000" stroke-width="2"/>
        <!-- Eye circles -->
        <circle cx="24" cy="22" r="8" fill="#fff" stroke="#000" stroke-width="1"/>
        <circle cx="40" cy="22" r="8" fill="#fff" stroke="#000" stroke-width="1"/>
        <!-- Pupils -->
        <circle cx="24" cy="22" r="4" fill="#000"/>
        <circle cx="40" cy="22" r="4" fill="#000"/>
        <!-- Beak -->
        <polygon points="32,28 28,36 36,36" fill="#f80" stroke="#a50" stroke-width="1"/>
        <!-- Ear tufts -->
        <polygon points="14,14 18,6 22,16" fill="${color}" stroke="#000" stroke-width="1"/>
        <polygon points="50,14 46,6 42,16" fill="${color}" stroke="#000" stroke-width="1"/>
      </svg>`;

    case "aberration":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 64 64">
        <!-- Main eye body -->
        <circle cx="32" cy="32" r="24" fill="${color}" stroke="#000" stroke-width="2"/>
        <!-- Central eye -->
        <circle cx="32" cy="28" r="12" fill="#fff" stroke="#000" stroke-width="1"/>
        <circle cx="32" cy="28" r="6" fill="#080"/>
        <circle cx="32" cy="28" r="3" fill="#000"/>
        <!-- Eye stalks -->
        <line x1="20" y1="12" x2="14" y2="4" stroke="${color}" stroke-width="4"/>
        <circle cx="14" cy="4" r="4" fill="#fff" stroke="#000" stroke-width="1"/>
        <circle cx="14" cy="4" r="2" fill="#f00"/>

        <line x1="44" y1="12" x2="50" y2="4" stroke="${color}" stroke-width="4"/>
        <circle cx="50" cy="4" r="4" fill="#fff" stroke="#000" stroke-width="1"/>
        <circle cx="50" cy="4" r="2" fill="#f00"/>

        <line x1="12" y1="24" x2="4" y2="20" stroke="${color}" stroke-width="4"/>
        <circle cx="4" cy="20" r="4" fill="#fff" stroke="#000" stroke-width="1"/>
        <circle cx="4" cy="20" r="2" fill="#f00"/>

        <line x1="52" y1="24" x2="60" y2="20" stroke="${color}" stroke-width="4"/>
        <circle cx="60" cy="20" r="4" fill="#fff" stroke="#000" stroke-width="1"/>
        <circle cx="60" cy="20" r="2" fill="#f00"/>
        <!-- Mouth -->
        <path d="M 20 44 Q 32 56 44 44" fill="#400" stroke="#000" stroke-width="1"/>
        <polygon points="24,44 26,50 28,44" fill="#fff"/>
        <polygon points="32,44 34,52 36,44" fill="#fff"/>
        <polygon points="38,44 40,50 42,44" fill="#fff"/>
      </svg>`;

    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="24" fill="${color}" stroke="#000" stroke-width="2"/>
        <circle cx="24" cy="28" r="4" fill="#ff0"/>
        <circle cx="40" cy="28" r="4" fill="#ff0"/>
      </svg>`;
  }
}

/**
 * Convert SVG to PNG using Bun's native capabilities.
 */
async function svgToPng(svg: string): Promise<Buffer> {
  // For now, we'll save as SVG since Bun doesn't have native canvas
  // The browser will handle SVG just fine
  return Buffer.from(svg);
}

async function main() {
  console.log("Generating sprites for Rune Forge...\n");

  // Create directories
  const playersDir = join(OUTPUT_DIR, "players");
  const monstersDir = join(OUTPUT_DIR, "monsters");

  mkdirSync(playersDir, { recursive: true });
  mkdirSync(monstersDir, { recursive: true });

  // Generate player sprites
  console.log("Generating player sprites:");
  for (const player of PLAYERS) {
    const svg = generatePlayerSVG(player.color, player.weapon);
    const path = join(playersDir, `${player.id}.svg`);
    writeFileSync(path, svg);
    console.log(`  ✓ ${player.id}.svg`);
  }

  // Generate monster sprites
  console.log("\nGenerating monster sprites:");
  for (const monster of MONSTERS) {
    const svg = generateMonsterSVG(monster.color, monster.type);
    const path = join(monstersDir, `${monster.id}.svg`);
    writeFileSync(path, svg);
    console.log(`  ✓ ${monster.id}.svg`);
  }

  console.log("\nDone! Sprites saved to packages/client/public/sprites/");
  console.log("\nNote: These are SVG placeholders. For pixel-art sprites, download from:");
  console.log("  - https://opengameart.org/content/dungeon-crawl-32x32-tiles-supplemental");
  console.log("  - https://www.spriters-resource.com/arcade/ddshadovermyst/");
}

main().catch(console.error);
