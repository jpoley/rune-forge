/**
 * Three.js isometric renderer for Rune Forge.
 * Renders the game map and units in 3D isometric view.
 */

import * as THREE from "three";
import type { GameMap, GameState, LootDrop, Position, Tile, Unit } from "@rune-forge/simulation";

const TILE_SIZE = 1;
const TILE_HEIGHT = 0.2;
const UNIT_SIZE = 0.9;
const RENDER_RADIUS = 50; // Tiles to render around center in each direction

// Texture loader
const textureLoader = new THREE.TextureLoader();

// Colors - all ground tiles are green shades
const COLORS = {
  // Ground tiles (all green shades)
  floor: 0x4a7a4a,
  grass_light: 0x5a9a5a,
  grass_dark: 0x3a5a3a,
  dirt: 0x4a6a3a, // Now a darker green instead of brown
  sand: 0x6a8a5a, // Now a lighter green instead of tan
  water: 0x4488aa,
  water_deep: 0x336688,
  floorHover: 0x6aaa6a,
  floorBeyond: 0x4a7a4a, // Same as floor for seamless infinite look
  // Obstacles
  wall: 0x5a5a6a,
  pillar: 0x6a6a7a,
  // 5 rock types
  rock: 0x7a7a8a,
  rock_mossy: 0x5a7a6a,
  rock_large: 0x6a6a7a,
  boulder: 0x8a8a9a,
  stone_pile: 0x9a9a9a,
  // 5 tree types
  tree: 0x2a4a2a,
  tree_pine: 0x1a3a1a,
  tree_oak: 0x3a5a2a,
  tree_dead: 0x4a3a2a,
  tree_small: 0x3a6a3a,
  tree_trunk: 0x5a4030,
  bush: 0x4a7a4a,
  // Units
  player: 0x4488ff,
  monster: 0xff4444,
  // Highlights
  moveHighlight: 0x44ff44,
  attackHighlight: 0xff4444,
  blocked: 0xff0000,
  selected: 0xffff00,
  // Loot
  lootBag: 0xc9a227,
  lootBagDark: 0x8a6b1a,
};

export class IsometricRenderer {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private container: HTMLElement;

  private infiniteFloorGroup: THREE.Group;
  private tileGroup: THREE.Group;
  private unitGroup: THREE.Group;
  private highlightGroup: THREE.Group;
  private lootGroup: THREE.Group;
  private shopGroup: THREE.Group;
  private effectsGroup: THREE.Group;

  private tileMeshes: Map<string, THREE.Mesh> = new Map();
  private unitMeshes: Map<string, THREE.Mesh> = new Map();
  private highlightMeshes: THREE.Mesh[] = [];
  private lootMeshes: Map<string, THREE.Group> = new Map();
  private shopMesh: THREE.Group | null = null;

  // Infinite map state
  private currentMap: GameMap | null = null;
  private renderCenter: Position = { x: 0, y: 0 };

  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  private hoveredTile: Position | null = null;
  private selectedUnit: string | null = null;
  private unitColors: Map<string, number> = new Map();
  private unitSprites: Map<string, string> = new Map();
  private loadedTextures: Map<string, THREE.Texture> = new Map();

  // Event callbacks
  onTileClick: ((pos: Position) => void) | null = null;
  onTileHover: ((pos: Position | null) => void) | null = null;
  onUnitClick: ((unitId: string) => void) | null = null;
  onLootClick: ((lootId: string) => void) | null = null;
  onShopClick: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Isometric camera
    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = 15;
    this.camera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      1000
    );

    // Isometric angle (approx 45 degrees rotated, looking down at 35 degrees)
    this.camera.position.set(20, 20, 20);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Groups for organization (order matters for rendering)
    this.infiniteFloorGroup = new THREE.Group();
    this.tileGroup = new THREE.Group();
    this.lootGroup = new THREE.Group();
    this.shopGroup = new THREE.Group();
    this.unitGroup = new THREE.Group();
    this.highlightGroup = new THREE.Group();
    this.effectsGroup = new THREE.Group();
    this.scene.add(this.infiniteFloorGroup);
    this.scene.add(this.tileGroup);
    this.scene.add(this.lootGroup);
    this.scene.add(this.shopGroup);
    this.scene.add(this.unitGroup);
    this.scene.add(this.highlightGroup);
    this.scene.add(this.effectsGroup);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);

    // Raycaster for mouse picking
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Event listeners
    this.setupEventListeners();

    // Handle resize
    window.addEventListener("resize", this.handleResize.bind(this));
  }

  private setupEventListeners(): void {
    this.renderer.domElement.addEventListener("mousemove", (e) => {
      this.updateMousePosition(e);
      this.handleHover();
    });

    this.renderer.domElement.addEventListener("click", () => {
      this.handleClick();
    });
  }

  private updateMousePosition(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handleHover(): void {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.tileGroup.children);

    if (intersects.length > 0) {
      const mesh = intersects[0]!.object as THREE.Mesh;
      const pos = mesh.userData.position as Position | undefined;

      // Guard against missing position data
      if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") {
        return;
      }

      if (!this.hoveredTile || this.hoveredTile.x !== pos.x || this.hoveredTile.y !== pos.y) {
        this.hoveredTile = pos;
        this.onTileHover?.(pos);
      }
    } else {
      if (this.hoveredTile) {
        this.hoveredTile = null;
        this.onTileHover?.(null);
      }
    }
  }

  private handleClick(): void {
    if (this.hoveredTile) {
      // Check if there's a unit at this position FIRST (for attacking)
      for (const [unitId, mesh] of this.unitMeshes) {
        const unitPos = mesh.userData.position as Position;
        if (unitPos.x === this.hoveredTile.x && unitPos.y === this.hoveredTile.y) {
          this.onUnitClick?.(unitId);
          return;
        }
      }

      // Then check if there's a loot bag at this position
      for (const [lootId, group] of this.lootMeshes) {
        const lootPos = group.userData.position as Position;
        if (lootPos.x === this.hoveredTile.x && lootPos.y === this.hoveredTile.y) {
          this.onLootClick?.(lootId);
          return;
        }
      }

      // Check if clicking on shop
      if (this.shopMesh) {
        const shopPos = this.shopMesh.userData.position as Position;
        if (shopPos.x === this.hoveredTile.x && shopPos.y === this.hoveredTile.y) {
          this.onShopClick?.();
          return;
        }
      }

      // Otherwise, it's a tile click
      this.onTileClick?.(this.hoveredTile);
    }
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const aspect = width / height;
    const frustumSize = 15;

    this.camera.left = (frustumSize * aspect) / -2;
    this.camera.right = (frustumSize * aspect) / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = frustumSize / -2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }

  private posToWorld(pos: Position): THREE.Vector3 {
    // Center the map
    return new THREE.Vector3(
      pos.x * TILE_SIZE - 10,
      0,
      pos.y * TILE_SIZE - 10
    );
  }

  private posKey(pos: Position): string {
    return `${pos.x},${pos.y}`;
  }

  /**
   * Render the infinite game map around a center position.
   */
  renderMap(map: GameMap, center?: Position): void {
    this.currentMap = map;
    this.renderCenter = center ?? { x: 0, y: 0 };

    // Clear existing tiles
    this.infiniteFloorGroup.clear();
    this.tileGroup.clear();
    this.tileMeshes.clear();

    // Reusable geometries
    const tileGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.95, TILE_HEIGHT, TILE_SIZE * 0.95);
    const wallGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.95, TILE_SIZE, TILE_SIZE * 0.95);
    const pillarGeometry = new THREE.CylinderGeometry(TILE_SIZE * 0.3, TILE_SIZE * 0.35, TILE_SIZE, 8);
    const rockGeometry = new THREE.DodecahedronGeometry(TILE_SIZE * 0.35, 0);
    const treeTopGeometry = new THREE.ConeGeometry(TILE_SIZE * 0.4, TILE_SIZE * 0.8, 6);
    const treeTrunkGeometry = new THREE.CylinderGeometry(TILE_SIZE * 0.1, TILE_SIZE * 0.12, TILE_SIZE * 0.4, 6);
    const bushGeometry = new THREE.SphereGeometry(TILE_SIZE * 0.3, 6, 4);
    const waterGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.95, TILE_HEIGHT * 0.5, TILE_SIZE * 0.95);

    // Render tiles around the center position (infinite world)
    const startX = this.renderCenter.x - RENDER_RADIUS;
    const endX = this.renderCenter.x + RENDER_RADIUS;
    const startY = this.renderCenter.y - RENDER_RADIUS;
    const endY = this.renderCenter.y + RENDER_RADIUS;

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const tile = map.getTile(x, y);
        const pos = { x, y };
        let mesh: THREE.Mesh;

        switch (tile.type) {
          case "floor":
          case "grass_light":
          case "grass_dark":
          case "dirt":
          case "sand": {
            const colorKey = tile.type as keyof typeof COLORS;
            const material = new THREE.MeshLambertMaterial({ color: COLORS[colorKey] });
            mesh = new THREE.Mesh(tileGeometry, material);
            break;
          }
          case "water":
          case "water_deep": {
            const colorKey = tile.type as keyof typeof COLORS;
            const material = new THREE.MeshLambertMaterial({
              color: COLORS[colorKey],
              transparent: true,
              opacity: 0.8,
            });
            mesh = new THREE.Mesh(waterGeometry, material);
            mesh.position.y = -TILE_HEIGHT * 0.25;
            break;
          }
          case "wall": {
            const material = new THREE.MeshLambertMaterial({ color: COLORS.wall });
            mesh = new THREE.Mesh(wallGeometry, material);
            mesh.position.y = TILE_SIZE / 2 - TILE_HEIGHT / 2;
            break;
          }
          case "pillar": {
            const material = new THREE.MeshLambertMaterial({ color: COLORS.pillar });
            mesh = new THREE.Mesh(pillarGeometry, material);
            mesh.position.y = TILE_SIZE / 2 - TILE_HEIGHT / 2;
            break;
          }
          case "rock":
          case "rock_mossy":
          case "rock_large":
          case "boulder":
          case "stone_pile": {
            // Ground tile underneath
            const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.dirt });
            const groundMesh = new THREE.Mesh(tileGeometry, groundMat);
            const worldPos = this.posToWorld(pos);
            groundMesh.position.set(worldPos.x, 0, worldPos.z);
            this.tileGroup.add(groundMesh);

            // Rock on top
            const rockColor = COLORS[tile.type as keyof typeof COLORS] || COLORS.rock;
            const rockMat = new THREE.MeshLambertMaterial({ color: rockColor });
            const scale = tile.type === "rock_large" || tile.type === "boulder" ? 1.3 : tile.type === "stone_pile" ? 0.8 : 1.0;
            mesh = new THREE.Mesh(rockGeometry, rockMat);
            mesh.scale.set(scale, scale, scale);
            mesh.position.y = TILE_SIZE * 0.3 * scale;
            // Use deterministic rotation based on position
            mesh.rotation.x = this.simpleNoise(x, y) * 0.5;
            mesh.rotation.z = this.simpleNoise(y, x) * 0.5;
            break;
          }
          case "tree":
          case "tree_pine":
          case "tree_oak":
          case "tree_dead":
          case "tree_small": {
            // Ground tile underneath
            const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.grass_dark });
            const groundMesh = new THREE.Mesh(tileGeometry, groundMat);
            const worldPos = this.posToWorld(pos);
            groundMesh.position.set(worldPos.x, 0, worldPos.z);
            this.tileGroup.add(groundMesh);

            const treeScale = tile.type === "tree_small" ? 0.7 : tile.type === "tree_oak" ? 1.2 : 1.0;
            const trunkColor = tile.type === "tree_dead" ? 0x5a4a3a : COLORS.tree_trunk;

            // Tree trunk
            const trunkMat = new THREE.MeshLambertMaterial({ color: trunkColor });
            const trunkMesh = new THREE.Mesh(treeTrunkGeometry, trunkMat);
            trunkMesh.scale.set(treeScale, treeScale, treeScale);
            trunkMesh.position.set(worldPos.x, TILE_SIZE * 0.2 * treeScale, worldPos.z);
            this.tileGroup.add(trunkMesh);

            // Tree top
            const treeColor = COLORS[tile.type as keyof typeof COLORS] || COLORS.tree;
            const treeMat = new THREE.MeshLambertMaterial({ color: treeColor });
            mesh = new THREE.Mesh(treeTopGeometry, treeMat);
            mesh.scale.set(treeScale, treeScale, treeScale);
            mesh.position.y = TILE_SIZE * 0.6 * treeScale;
            if (tile.type === "tree_dead") {
              mesh.scale.set(treeScale * 0.3, treeScale * 0.5, treeScale * 0.3);
            }
            break;
          }
          case "bush": {
            // Ground tile underneath
            const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.grass_light });
            const groundMesh = new THREE.Mesh(tileGeometry, groundMat);
            const worldPos = this.posToWorld(pos);
            groundMesh.position.set(worldPos.x, 0, worldPos.z);
            this.tileGroup.add(groundMesh);

            const bushMat = new THREE.MeshLambertMaterial({ color: COLORS.bush });
            mesh = new THREE.Mesh(bushGeometry, bushMat);
            mesh.position.y = TILE_SIZE * 0.25;
            break;
          }
          default: {
            const material = new THREE.MeshLambertMaterial({ color: COLORS.floor });
            mesh = new THREE.Mesh(tileGeometry, material);
          }
        }

        const worldPos = this.posToWorld(pos);
        mesh.position.x = worldPos.x;
        mesh.position.z = worldPos.z;
        mesh.userData.position = pos;
        mesh.userData.tileType = tile.type;

        this.tileGroup.add(mesh);
        this.tileMeshes.set(this.posKey(pos), mesh);
      }
    }
  }

  /**
   * Update the render center and re-render tiles if needed.
   * Call this when the player moves significantly.
   */
  updateRenderCenter(center: Position): void {
    const dx = Math.abs(center.x - this.renderCenter.x);
    const dy = Math.abs(center.y - this.renderCenter.y);

    // Only re-render if moved more than 10 tiles from current center
    if (dx > 10 || dy > 10) {
      if (this.currentMap) {
        this.renderMap(this.currentMap, center);
      }
    }
  }

  /**
   * Simple noise function for terrain variation.
   */
  private simpleNoise(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  /**
   * Set custom colors for units (from character selection).
   */
  setUnitColors(colors: Map<string, number>): void {
    this.unitColors = new Map(colors);
  }

  /**
   * Set sprite paths for units (from character selection).
   */
  setUnitSprites(sprites: Map<string, string>): void {
    this.unitSprites = new Map(sprites);
    // Preload textures
    for (const [unitId, spritePath] of sprites) {
      if (!this.loadedTextures.has(spritePath)) {
        textureLoader.load(
          spritePath,
          (texture) => {
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            this.loadedTextures.set(spritePath, texture);
          },
          undefined,
          () => {
            // Failed to load - will use fallback color
            console.warn(`Failed to load sprite: ${spritePath}`);
          }
        );
      }
    }
  }

  /**
   * Create a character-like sprite texture as fallback.
   */
  private createFallbackTexture(color: number, isMonster = false): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;

    const hexColor = `#${color.toString(16).padStart(6, "0")}`;

    // Clear with transparency
    ctx.clearRect(0, 0, 64, 64);

    if (isMonster) {
      // Monster: angular/spiky shape
      ctx.fillStyle = hexColor;
      ctx.beginPath();
      ctx.moveTo(32, 4);  // Top spike
      ctx.lineTo(58, 20);
      ctx.lineTo(54, 50);
      ctx.lineTo(42, 60);
      ctx.lineTo(22, 60);
      ctx.lineTo(10, 50);
      ctx.lineTo(6, 20);
      ctx.closePath();
      ctx.fill();

      // Dark outline
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Evil eyes
      ctx.fillStyle = "#ff0";
      ctx.beginPath();
      ctx.ellipse(22, 28, 6, 4, 0, 0, Math.PI * 2);
      ctx.ellipse(42, 28, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f00";
      ctx.beginPath();
      ctx.arc(22, 28, 2, 0, Math.PI * 2);
      ctx.arc(42, 28, 2, 0, Math.PI * 2);
      ctx.fill();

      // Fangs
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(24, 44);
      ctx.lineTo(28, 52);
      ctx.lineTo(32, 44);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(32, 44);
      ctx.lineTo(36, 52);
      ctx.lineTo(40, 44);
      ctx.fill();
    } else {
      // Hero: humanoid shape
      // Body
      ctx.fillStyle = hexColor;
      ctx.beginPath();
      ctx.ellipse(32, 40, 16, 20, 0, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.fillStyle = "#ffd8b0"; // Skin tone
      ctx.beginPath();
      ctx.arc(32, 18, 14, 0, Math.PI * 2);
      ctx.fill();

      // Hair/helmet (same color as body)
      ctx.fillStyle = hexColor;
      ctx.beginPath();
      ctx.arc(32, 14, 12, Math.PI, 0, false);
      ctx.fill();

      // Eyes
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(26, 18, 3, 0, Math.PI * 2);
      ctx.arc(38, 18, 3, 0, Math.PI * 2);
      ctx.fill();

      // Smile
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(32, 22, 6, 0.2, Math.PI - 0.2);
      ctx.stroke();

      // Outline
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(32, 40, 16, 20, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
  }

  /**
   * Render all units as sprite billboards.
   */
  renderUnits(units: ReadonlyArray<Unit>): void {
    // Clear existing units
    this.unitGroup.clear();
    this.unitMeshes.clear();

    const spriteGeometry = new THREE.PlaneGeometry(UNIT_SIZE, UNIT_SIZE);

    for (const unit of units) {
      if (unit.stats.hp <= 0) continue;

      // Get sprite path and color for this unit
      const spritePath = this.unitSprites.get(unit.id);
      const customColor = this.unitColors.get(unit.id);
      const defaultColor = unit.type === "player" ? COLORS.player : COLORS.monster;
      const color = customColor ?? defaultColor;

      // Try to use loaded texture, otherwise create fallback
      let texture: THREE.Texture;
      if (spritePath && this.loadedTextures.has(spritePath)) {
        texture = this.loadedTextures.get(spritePath)!;
      } else {
        texture = this.createFallbackTexture(color, unit.type === "monster");
      }

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.1,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(spriteGeometry, material);

      const worldPos = this.posToWorld(unit.position);
      mesh.position.set(worldPos.x, UNIT_SIZE / 2 + TILE_HEIGHT, worldPos.z);
      mesh.userData.position = unit.position;
      mesh.userData.unitId = unit.id;
      mesh.userData.originalColor = color;

      // Billboard: make sprite face camera (isometric view at 45 degrees)
      // Rotate to face camera direction (camera is at 45 degrees around Y axis)
      mesh.rotation.y = Math.PI / 4; // 45 degrees to face isometric camera
      mesh.rotation.x = -Math.PI / 8; // Slight tilt toward camera

      this.unitGroup.add(mesh);
      this.unitMeshes.set(unit.id, mesh);
    }
  }

  /**
   * Highlight tiles for movement or attack.
   */
  highlightTiles(positions: Position[], type: "move" | "attack"): void {
    this.clearHighlights();

    const color = type === "move" ? COLORS.moveHighlight : COLORS.attackHighlight;
    const geometry = new THREE.PlaneGeometry(TILE_SIZE * 0.9, TILE_SIZE * 0.9);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });

    for (const pos of positions) {
      const mesh = new THREE.Mesh(geometry, material);
      const worldPos = this.posToWorld(pos);
      mesh.position.set(worldPos.x, TILE_HEIGHT + 0.01, worldPos.z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.position = pos;

      this.highlightGroup.add(mesh);
      this.highlightMeshes.push(mesh);
    }
  }

  /**
   * Clear all highlights.
   */
  clearHighlights(): void {
    this.highlightGroup.clear();
    this.highlightMeshes = [];
  }

  /**
   * Select a unit visually.
   */
  selectUnit(unitId: string | null): void {
    // Reset previous selection
    if (this.selectedUnit) {
      const prevMesh = this.unitMeshes.get(this.selectedUnit);
      if (prevMesh) {
        const material = prevMesh.material as THREE.MeshLambertMaterial;
        // Restore original color (custom or default)
        const originalColor = prevMesh.userData.originalColor as number | undefined;
        const isPlayer = prevMesh.userData.unitId.startsWith("player");
        material.color.setHex(originalColor ?? (isPlayer ? COLORS.player : COLORS.monster));
      }
    }

    this.selectedUnit = unitId;

    // Highlight new selection
    if (unitId) {
      const mesh = this.unitMeshes.get(unitId);
      if (mesh) {
        const material = mesh.material as THREE.MeshLambertMaterial;
        material.color.setHex(COLORS.selected);
      }
    }
  }

  /**
   * Center camera on a position (defaults to origin for infinite maps).
   */
  centerCamera(position: { x: number; y: number } = { x: 0, y: 0 }): void {
    // Use the same world position calculation as centerOnPosition
    const worldPos = this.posToWorld(position);
    const targetX = worldPos.x + 20;
    const targetZ = worldPos.z + 20;

    this.camera.position.set(targetX, 20, targetZ);
    this.camera.lookAt(worldPos.x, 0, worldPos.z);
  }

  /**
   * Center camera on a specific position (for following units).
   */
  centerOnPosition(pos: Position, smooth = true): void {
    const worldPos = this.posToWorld(pos);
    const targetX = worldPos.x + 20;
    const targetZ = worldPos.z + 20;

    if (smooth) {
      // Smooth camera movement
      const startX = this.camera.position.x;
      const startZ = this.camera.position.z;
      const duration = 300;
      const startTime = performance.now();

      const animate = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const ease = 1 - Math.pow(1 - t, 3);

        this.camera.position.x = startX + (targetX - startX) * ease;
        this.camera.position.z = startZ + (targetZ - startZ) * ease;
        this.camera.lookAt(
          this.camera.position.x - 20,
          0,
          this.camera.position.z - 20
        );

        if (t < 1) {
          requestAnimationFrame(animate);
        }
      };
      animate();
    } else {
      this.camera.position.set(targetX, 20, targetZ);
      this.camera.lookAt(worldPos.x, 0, worldPos.z);
    }
  }

  /**
   * Center camera on a unit by ID.
   */
  centerOnUnit(unitId: string): void {
    const mesh = this.unitMeshes.get(unitId);
    if (mesh) {
      const pos = mesh.userData.position as Position;
      this.centerOnPosition(pos);
    }
  }

  /**
   * Main render loop.
   */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Start animation loop.
   */
  startRenderLoop(): void {
    const animate = () => {
      requestAnimationFrame(animate);
      this.render();
    };
    animate();
  }

  /**
   * Add a loot bag at the given position.
   */
  addLootBag(lootDrop: LootDrop): void {
    const worldPos = this.posToWorld(lootDrop.position);

    // Create a group to hold the bag and its animation
    const lootGroup = new THREE.Group();
    lootGroup.userData.position = lootDrop.position;
    lootGroup.userData.lootId = lootDrop.id;

    // Create a simple treasure bag/chest shape
    // Main bag body
    const bagGeometry = new THREE.BoxGeometry(0.4, 0.35, 0.3);
    const bagMaterial = new THREE.MeshLambertMaterial({ color: COLORS.lootBag });
    const bagMesh = new THREE.Mesh(bagGeometry, bagMaterial);
    bagMesh.position.y = 0.175;
    lootGroup.add(bagMesh);

    // Bag top (darker)
    const topGeometry = new THREE.BoxGeometry(0.44, 0.08, 0.34);
    const topMaterial = new THREE.MeshLambertMaterial({ color: COLORS.lootBagDark });
    const topMesh = new THREE.Mesh(topGeometry, topMaterial);
    topMesh.position.y = 0.35;
    lootGroup.add(topMesh);

    // Position the group
    lootGroup.position.set(worldPos.x, TILE_HEIGHT + 0.01, worldPos.z);

    // Add bouncing animation data
    lootGroup.userData.animPhase = Math.random() * Math.PI * 2;
    lootGroup.userData.baseY = TILE_HEIGHT + 0.01;

    this.lootGroup.add(lootGroup);
    this.lootMeshes.set(lootDrop.id, lootGroup);

    // Start bounce animation for this loot
    this.animateLoot(lootDrop.id);
  }

  /**
   * Remove a loot bag by ID.
   */
  removeLootBag(lootDropId: string): void {
    const lootGroup = this.lootMeshes.get(lootDropId);
    if (lootGroup) {
      this.lootGroup.remove(lootGroup);
      this.lootMeshes.delete(lootDropId);
    }
  }

  /**
   * Animate a loot bag with a gentle bounce.
   */
  private animateLoot(lootId: string): void {
    const animate = () => {
      const lootGroup = this.lootMeshes.get(lootId);
      if (!lootGroup) return; // Stop if loot was removed

      const phase = lootGroup.userData.animPhase as number;
      const baseY = lootGroup.userData.baseY as number;
      const time = performance.now() / 1000;

      // Gentle bounce
      lootGroup.position.y = baseY + Math.sin(time * 2 + phase) * 0.05;

      requestAnimationFrame(animate);
    };
    animate();
  }

  /**
   * Clear all loot bags.
   */
  clearLoot(): void {
    this.lootGroup.clear();
    this.lootMeshes.clear();
  }

  /**
   * Play a death animation (puff of smoke) at the given position.
   * Returns a promise that resolves when the animation is complete.
   */
  playDeathAnimation(position: Position): Promise<void> {
    return new Promise((resolve) => {
      const worldPos = this.posToWorld(position);
      const particleCount = 12;
      const particles: THREE.Mesh[] = [];
      const animDuration = 600; // ms
      const startTime = performance.now();

      // Create smoke particles
      for (let i = 0; i < particleCount; i++) {
        const size = 0.15 + Math.random() * 0.15;
        const geometry = new THREE.SphereGeometry(size, 8, 8);
        const material = new THREE.MeshBasicMaterial({
          color: 0x888888,
          transparent: true,
          opacity: 0.8,
        });
        const particle = new THREE.Mesh(geometry, material);

        // Start position (at unit center, slightly above ground)
        particle.position.set(
          worldPos.x + (Math.random() - 0.5) * 0.3,
          TILE_HEIGHT + 0.4 + Math.random() * 0.2,
          worldPos.z + (Math.random() - 0.5) * 0.3
        );

        // Store velocity for animation
        particle.userData.vx = (Math.random() - 0.5) * 2;
        particle.userData.vy = 1 + Math.random() * 1.5;
        particle.userData.vz = (Math.random() - 0.5) * 2;

        this.effectsGroup.add(particle);
        particles.push(particle);
      }

      // Animate particles
      const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / animDuration, 1);

        particles.forEach((p) => {
          const mat = p.material as THREE.MeshBasicMaterial;
          // Move outward and upward
          p.position.x += (p.userData.vx as number) * 0.02;
          p.position.y += (p.userData.vy as number) * 0.02;
          p.position.z += (p.userData.vz as number) * 0.02;
          // Slow down vertical velocity
          p.userData.vy = (p.userData.vy as number) * 0.95;
          // Fade out
          mat.opacity = 0.8 * (1 - progress);
          // Scale up slightly
          const scale = 1 + progress * 0.5;
          p.scale.set(scale, scale, scale);
        });

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          // Clean up particles
          particles.forEach((p) => {
            this.effectsGroup.remove(p);
            p.geometry.dispose();
            (p.material as THREE.MeshBasicMaterial).dispose();
          });
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Create the merchant shop building at a position.
   */
  createShop(position: Position): void {
    // Remove existing shop if any
    if (this.shopMesh) {
      this.shopGroup.remove(this.shopMesh);
    }

    const worldPos = this.posToWorld(position);
    const shop = new THREE.Group();
    shop.userData.position = position;

    // Shop base/floor (wooden platform)
    const baseGeometry = new THREE.BoxGeometry(1.8, 0.1, 1.4);
    const baseMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 }); // brown wood
    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    baseMesh.position.y = 0.05;
    shop.add(baseMesh);

    // Main building body
    const bodyGeometry = new THREE.BoxGeometry(1.6, 1.0, 1.2);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xa0522d }); // sienna
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    bodyMesh.position.y = 0.6;
    shop.add(bodyMesh);

    // Roof (darker)
    const roofGeometry = new THREE.BoxGeometry(1.9, 0.15, 1.5);
    const roofMaterial = new THREE.MeshLambertMaterial({ color: 0x654321 }); // dark brown
    const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
    roofMesh.position.y = 1.15;
    shop.add(roofMesh);

    // Awning/canopy (colorful)
    const awningGeometry = new THREE.BoxGeometry(1.9, 0.08, 0.6);
    const awningMaterial = new THREE.MeshLambertMaterial({ color: 0xdc143c }); // crimson red
    const awningMesh = new THREE.Mesh(awningGeometry, awningMaterial);
    awningMesh.position.set(0, 0.95, 0.8);
    awningMesh.rotation.x = -0.2;
    shop.add(awningMesh);

    // Shop sign board
    const signGeometry = new THREE.BoxGeometry(0.8, 0.3, 0.05);
    const signMaterial = new THREE.MeshLambertMaterial({ color: 0xffd700 }); // gold
    const signMesh = new THREE.Mesh(signGeometry, signMaterial);
    signMesh.position.set(0, 1.35, 0.1);
    shop.add(signMesh);

    // Counter/window opening
    const counterGeometry = new THREE.BoxGeometry(0.8, 0.4, 0.1);
    const counterMaterial = new THREE.MeshLambertMaterial({ color: 0x2f1f0f }); // dark opening
    const counterMesh = new THREE.Mesh(counterGeometry, counterMaterial);
    counterMesh.position.set(0, 0.5, 0.56);
    shop.add(counterMesh);

    // Position the shop
    shop.position.set(worldPos.x, TILE_HEIGHT + 0.01, worldPos.z);

    this.shopGroup.add(shop);
    this.shopMesh = shop;
  }

  /**
   * Remove the shop building.
   */
  removeShop(): void {
    if (this.shopMesh) {
      this.shopGroup.remove(this.shopMesh);
      this.shopMesh = null;
    }
  }

  /**
   * Cleanup.
   */
  dispose(): void {
    this.renderer.dispose();
    window.removeEventListener("resize", this.handleResize.bind(this));
  }
}
