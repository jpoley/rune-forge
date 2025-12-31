/**
 * A* pathfinding implementation for grid-based movement.
 * Handles walkable/blocked tiles and occupied positions.
 */

import type { GameMap, Position, Unit } from "./types.js";

interface PathNode {
  position: Position;
  g: number; // Cost from start
  h: number; // Heuristic (estimated cost to goal)
  f: number; // Total cost (g + h)
  parent: PathNode | null;
}

function positionKey(pos: Position): string {
  return `${pos.x},${pos.y}`;
}

function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function getNeighbors(pos: Position, _map: GameMap): Position[] {
  const neighbors: Position[] = [];
  const directions = [
    // Cardinal directions
    { x: 0, y: -1 }, // up
    { x: 0, y: 1 }, // down
    { x: -1, y: 0 }, // left
    { x: 1, y: 0 }, // right
    // Diagonal directions
    { x: -1, y: -1 }, // up-left
    { x: 1, y: -1 }, // up-right
    { x: -1, y: 1 }, // down-left
    { x: 1, y: 1 }, // down-right
  ];

  for (const dir of directions) {
    // Infinite map - all positions are valid
    neighbors.push({ x: pos.x + dir.x, y: pos.y + dir.y });
  }

  return neighbors;
}

function isWalkable(
  pos: Position,
  map: GameMap,
  blockedPositions: Set<string>,
  passablePositions: Set<string>,
  isGoalCheck = false
): boolean {
  const tile = map.getTile(pos.x, pos.y);
  if (!tile.walkable) {
    return false;
  }

  // Check if blocked by enemy unit
  if (blockedPositions.has(positionKey(pos))) {
    return false;
  }

  // Check if occupied by friendly unit - can pass through but not stop on
  // When checking if we can STOP on a tile (isGoalCheck), passable positions are blocked
  if (isGoalCheck && passablePositions.has(positionKey(pos))) {
    return false;
  }

  return true;
}

/**
 * Find a path from start to goal using A* algorithm.
 * Returns the path as an array of positions (including start and goal),
 * or null if no path exists.
 */
// Helper to check if a unit is on the player's team (player or npc)
function isPlayerTeam(type: string): boolean {
  return type === "player" || type === "npc";
}

export function findPath(
  start: Position,
  goal: Position,
  map: GameMap,
  units: ReadonlyArray<Unit>,
  movingUnitId: string
): Position[] | null {
  // Find the moving unit to determine its team
  const movingUnit = units.find(u => u.id === movingUnitId);
  const movingIsPlayerTeam = movingUnit ? isPlayerTeam(movingUnit.type) : true;

  // Build sets of blocked and passable positions
  // Blocked = enemies (cannot pass through)
  // Passable = friendlies (can pass through but not stop on)
  const blockedPositions = new Set<string>();
  const passablePositions = new Set<string>();

  for (const unit of units) {
    if (unit.id !== movingUnitId && unit.stats.hp > 0) {
      const unitKey = positionKey(unit.position);
      // Goal can be occupied if we're pathfinding for attack range check
      if (unitKey === positionKey(goal)) continue;

      const unitIsPlayerTeam = isPlayerTeam(unit.type);
      // Same team = friendly (passable), different team = enemy (blocked)
      if (unitIsPlayerTeam === movingIsPlayerTeam) {
        passablePositions.add(unitKey);
      } else {
        blockedPositions.add(unitKey);
      }
    }
  }

  // Check if goal is walkable (or occupied by target for attacks)
  const goalTile = map.getTile(goal.x, goal.y);
  if (!goalTile.walkable) {
    return null;
  }

  const openSet = new Map<string, PathNode>();
  const closedSet = new Set<string>();

  const startNode: PathNode = {
    position: start,
    g: 0,
    h: manhattanDistance(start, goal),
    f: manhattanDistance(start, goal),
    parent: null,
  };

  openSet.set(positionKey(start), startNode);

  // Maximum iterations to prevent infinite loops on infinite maps
  const MAX_ITERATIONS = 10000;
  let iterations = 0;

  while (openSet.size > 0) {
    // Safety check: abort if taking too long (no path exists or very far)
    if (++iterations > MAX_ITERATIONS) {
      return null;
    }

    // Find node with lowest f score
    let current: PathNode | null = null;
    let lowestF = Infinity;

    for (const node of openSet.values()) {
      if (node.f < lowestF) {
        lowestF = node.f;
        current = node;
      }
    }

    if (!current) break;

    // Check if we reached the goal
    if (current.position.x === goal.x && current.position.y === goal.y) {
      // Reconstruct path
      const path: Position[] = [];
      let node: PathNode | null = current;
      while (node) {
        path.unshift(node.position);
        node = node.parent;
      }
      return path;
    }

    // Move current from open to closed
    openSet.delete(positionKey(current.position));
    closedSet.add(positionKey(current.position));

    // Check neighbors
    for (const neighborPos of getNeighbors(current.position, map)) {
      const key = positionKey(neighborPos);

      if (closedSet.has(key)) continue;

      // Goal is always considered walkable for pathfinding purposes
      const isGoal =
        neighborPos.x === goal.x && neighborPos.y === goal.y;
      if (!isGoal && !isWalkable(neighborPos, map, blockedPositions, passablePositions)) {
        continue;
      }

      const g = current.g + 1; // Each step costs 1
      const existingNode = openSet.get(key);

      if (!existingNode || g < existingNode.g) {
        const h = manhattanDistance(neighborPos, goal);
        const node: PathNode = {
          position: neighborPos,
          g,
          h,
          f: g + h,
          parent: current,
        };
        openSet.set(key, node);
      }
    }
  }

  return null; // No path found
}

/**
 * Get all reachable positions within a given move range.
 * Returns a map of position -> minimum distance to reach it.
 * Units can pass through friendly units but not stop on them.
 */
export function getReachablePositions(
  start: Position,
  moveRange: number,
  map: GameMap,
  units: ReadonlyArray<Unit>,
  movingUnitId: string
): Map<string, number> {
  const reachable = new Map<string, number>();

  // Find the moving unit to determine its team
  const movingUnit = units.find(u => u.id === movingUnitId);
  const movingIsPlayerTeam = movingUnit ? isPlayerTeam(movingUnit.type) : true;

  // Build sets of blocked and passable positions
  const blockedPositions = new Set<string>();
  const passablePositions = new Set<string>();

  for (const unit of units) {
    if (unit.id !== movingUnitId && unit.stats.hp > 0) {
      const unitKey = positionKey(unit.position);
      const unitIsPlayerTeam = isPlayerTeam(unit.type);
      // Same team = friendly (passable), different team = enemy (blocked)
      if (unitIsPlayerTeam === movingIsPlayerTeam) {
        passablePositions.add(unitKey);
      } else {
        blockedPositions.add(unitKey);
      }
    }
  }

  // Track all positions we can reach (including passing through friendlies)
  const visited = new Map<string, number>();

  // BFS to find all reachable positions
  const queue: Array<{ pos: Position; dist: number }> = [
    { pos: start, dist: 0 },
  ];
  visited.set(positionKey(start), 0);
  reachable.set(positionKey(start), 0); // Can always stay in place

  while (queue.length > 0) {
    const { pos, dist } = queue.shift()!;

    if (dist >= moveRange) continue;

    for (const neighbor of getNeighbors(pos, map)) {
      const key = positionKey(neighbor);
      if (visited.has(key)) continue;

      // Check if we can walk through this tile (friendlies are passable)
      if (!isWalkable(neighbor, map, blockedPositions, passablePositions, false)) continue;

      visited.set(key, dist + 1);
      queue.push({ pos: neighbor, dist: dist + 1 });

      // Only add to reachable if we can actually STOP here (not on friendlies)
      if (!passablePositions.has(key)) {
        reachable.set(key, dist + 1);
      }
    }
  }

  return reachable;
}
