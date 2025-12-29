/**
 * Line of Sight (LoS) calculations using ray-based checking.
 *
 * Per spec:
 * - LoS is required for all attacks and targeted abilities
 * - Target is valid if unobstructed ray exists from attacker center → target center
 * - Tiles marked blocksLos=true block the ray
 * - Touching a blocking tile edge/corner counts as blocked (conservative rule)
 */

import type { GameMap, Position, Tile } from "./types.js";

/**
 * Check if there is clear line of sight between two positions.
 * Uses Bresenham's line algorithm to trace the ray.
 * Returns true if LoS is clear, false if blocked.
 */
export function hasLineOfSight(
  from: Position,
  to: Position,
  map: GameMap
): boolean {
  // Same position always has LoS
  if (from.x === to.x && from.y === to.y) {
    return true;
  }

  // Get all tiles the line passes through (excluding start and end)
  const tilesOnPath = getLineOfSightPath(from, to);

  // Check each tile on the path for LoS blocking
  for (const pos of tilesOnPath) {
    // Skip the start and end positions
    if ((pos.x === from.x && pos.y === from.y) ||
        (pos.x === to.x && pos.y === to.y)) {
      continue;
    }

    const tile = getTile(pos, map);
    if (tile && tile.blocksLos) {
      return false;
    }
  }

  return true;
}

/**
 * Get all tiles that a line of sight ray passes through.
 * Uses Bresenham's line algorithm for consistent results.
 */
export function getLineOfSightPath(from: Position, to: Position): Position[] {
  const path: Position[] = [];

  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    path.push({ x: x0, y: y0 });

    if (x0 === x1 && y0 === y1) break;

    const e2 = 2 * err;

    // For conservative LoS (touching corners/edges counts as blocked),
    // we check diagonal movements through both adjacent tiles
    if (e2 > -dy && e2 < dx) {
      // Diagonal move - check both adjacent tiles
      const diag1: Position = { x: x0 + sx, y: y0 };
      const diag2: Position = { x: x0, y: y0 + sy };

      // Add both tiles that the diagonal passes through
      if (!path.some(p => p.x === diag1.x && p.y === diag1.y)) {
        path.push(diag1);
      }
      if (!path.some(p => p.x === diag2.x && p.y === diag2.y)) {
        path.push(diag2);
      }
    }

    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return path;
}

/**
 * Get the tile at a position, or null if out of bounds.
 */
function getTile(pos: Position, map: GameMap): Tile | null {
  if (pos.x < 0 || pos.x >= map.size.width ||
      pos.y < 0 || pos.y >= map.size.height) {
    return null;
  }
  return map.tiles[pos.y]?.[pos.x] ?? null;
}

/**
 * Find the first blocking tile along a line of sight ray.
 * Returns the blocking position or null if LoS is clear.
 */
export function findBlockingTile(
  from: Position,
  to: Position,
  map: GameMap
): Position | null {
  const path = getLineOfSightPath(from, to);

  for (const pos of path) {
    // Skip start and end
    if ((pos.x === from.x && pos.y === from.y) ||
        (pos.x === to.x && pos.y === to.y)) {
      continue;
    }

    const tile = getTile(pos, map);
    if (tile && tile.blocksLos) {
      return pos;
    }
  }

  return null;
}

/**
 * Check if a position is adjacent to another (including diagonals).
 * Used for melee range checking.
 */
export function isAdjacent(a: Position, b: Position): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);

  // For v1, melee only works on cardinal directions (not diagonal)
  // as per grid-based movement spec
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

/**
 * Get Manhattan distance between two positions.
 */
export function getDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Get all positions within a given range of a center position.
 */
export function getPositionsInRange(
  center: Position,
  range: number,
  map: GameMap
): Position[] {
  const positions: Position[] = [];

  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (dx === 0 && dy === 0) continue; // Skip center

      const pos = { x: center.x + dx, y: center.y + dy };

      // Check bounds
      if (pos.x < 0 || pos.x >= map.size.width ||
          pos.y < 0 || pos.y >= map.size.height) {
        continue;
      }

      // Check Manhattan distance
      if (Math.abs(dx) + Math.abs(dy) <= range) {
        positions.push(pos);
      }
    }
  }

  return positions;
}
