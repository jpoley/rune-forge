/**
 * Three.js isometric renderer for Rune Forge.
 * Renders the game map and units in 3D isometric view.
 */

import * as THREE from "three";
import type { GameMap, GameState, Position, Tile, Unit } from "@rune-forge/simulation";

const TILE_SIZE = 1;
const TILE_HEIGHT = 0.2;
const UNIT_SIZE = 0.9;
const INFINITE_EXTEND = 30; // How many tiles to extend beyond map edges

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
  rock: 0x7a7a8a,
  tree: 0x2a4a2a,
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

  private tileMeshes: Map<string, THREE.Mesh> = new Map();
  private unitMeshes: Map<string, THREE.Mesh> = new Map();
  private highlightMeshes: THREE.Mesh[] = [];

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
    this.unitGroup = new THREE.Group();
    this.highlightGroup = new THREE.Group();
    this.scene.add(this.infiniteFloorGroup);
    this.scene.add(this.tileGroup);
    this.scene.add(this.unitGroup);
    this.scene.add(this.highlightGroup);

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
      const pos = mesh.userData.position as Position;

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
      // Check if there's a unit at this position
      for (const [unitId, mesh] of this.unitMeshes) {
        const unitPos = mesh.userData.position as Position;
        if (unitPos.x === this.hoveredTile.x && unitPos.y === this.hoveredTile.y) {
          this.onUnitClick?.(unitId);
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
   * Render the game map tiles.
   */
  renderMap(map: GameMap): void {
    // Clear existing tiles
    this.infiniteFloorGroup.clear();
    this.tileGroup.clear();
    this.tileMeshes.clear();

    // Geometries
    const tileGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.95, TILE_HEIGHT, TILE_SIZE * 0.95);
    const wallGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.95, TILE_SIZE, TILE_SIZE * 0.95);
    const pillarGeometry = new THREE.CylinderGeometry(TILE_SIZE * 0.3, TILE_SIZE * 0.35, TILE_SIZE, 8);
    const rockGeometry = new THREE.DodecahedronGeometry(TILE_SIZE * 0.35, 0);
    const treeTopGeometry = new THREE.ConeGeometry(TILE_SIZE * 0.4, TILE_SIZE * 0.8, 6);
    const treeTrunkGeometry = new THREE.CylinderGeometry(TILE_SIZE * 0.1, TILE_SIZE * 0.12, TILE_SIZE * 0.4, 6);
    const bushGeometry = new THREE.SphereGeometry(TILE_SIZE * 0.3, 6, 4);
    const waterGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.95, TILE_HEIGHT * 0.5, TILE_SIZE * 0.95);

    // Render infinite floor tiles beyond map boundaries (varied ground)
    const startX = -INFINITE_EXTEND;
    const endX = map.size.width + INFINITE_EXTEND;
    const startY = -INFINITE_EXTEND;
    const endY = map.size.height + INFINITE_EXTEND;

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        // Skip tiles that are within the actual map bounds
        if (x >= 0 && x < map.size.width && y >= 0 && y < map.size.height) {
          continue;
        }

        // Vary the beyond tiles for natural look (all green shades)
        const noise = this.simpleNoise(x, y);
        let color: number;
        if (noise < 0.3) color = COLORS.grass_dark;
        else if (noise < 0.6) color = COLORS.grass_light;
        else if (noise < 0.85) color = COLORS.floor;
        else color = COLORS.grass_light; // Use grass instead of dirt

        const material = new THREE.MeshLambertMaterial({ color });
        const mesh = new THREE.Mesh(tileGeometry, material);
        const worldPos = this.posToWorld({ x, y });
        mesh.position.set(worldPos.x, -TILE_HEIGHT * 0.5, worldPos.z);
        this.infiniteFloorGroup.add(mesh);
      }
    }

    // Render actual map tiles
    for (let y = 0; y < map.size.height; y++) {
      for (let x = 0; x < map.size.width; x++) {
        const tile = map.tiles[y]?.[x];
        if (!tile) continue;

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
            // Water is slightly lower and transparent-looking
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
          case "rock": {
            // Ground tile underneath
            const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.dirt });
            const groundMesh = new THREE.Mesh(tileGeometry, groundMat);
            const worldPos = this.posToWorld(pos);
            groundMesh.position.set(worldPos.x, 0, worldPos.z);
            this.tileGroup.add(groundMesh);

            // Rock on top
            const rockMat = new THREE.MeshLambertMaterial({ color: COLORS.rock });
            mesh = new THREE.Mesh(rockGeometry, rockMat);
            mesh.position.y = TILE_SIZE * 0.3;
            mesh.rotation.x = Math.random() * 0.5;
            mesh.rotation.z = Math.random() * 0.5;
            break;
          }
          case "tree": {
            // Ground tile underneath
            const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.grass_dark });
            const groundMesh = new THREE.Mesh(tileGeometry, groundMat);
            const worldPos = this.posToWorld(pos);
            groundMesh.position.set(worldPos.x, 0, worldPos.z);
            this.tileGroup.add(groundMesh);

            // Tree trunk
            const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.tree_trunk });
            const trunkMesh = new THREE.Mesh(treeTrunkGeometry, trunkMat);
            trunkMesh.position.set(worldPos.x, TILE_SIZE * 0.2, worldPos.z);
            this.tileGroup.add(trunkMesh);

            // Tree top (cone)
            const treeMat = new THREE.MeshLambertMaterial({ color: COLORS.tree });
            mesh = new THREE.Mesh(treeTopGeometry, treeMat);
            mesh.position.y = TILE_SIZE * 0.6;
            break;
          }
          case "bush": {
            // Ground tile underneath
            const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.grass_light });
            const groundMesh = new THREE.Mesh(tileGeometry, groundMat);
            const worldPos = this.posToWorld(pos);
            groundMesh.position.set(worldPos.x, 0, worldPos.z);
            this.tileGroup.add(groundMesh);

            // Bush sphere
            const bushMat = new THREE.MeshLambertMaterial({ color: COLORS.bush });
            mesh = new THREE.Mesh(bushGeometry, bushMat);
            mesh.position.y = TILE_SIZE * 0.25;
            break;
          }
          default: {
            // Fallback to floor
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

      // Billboard: make sprite face camera (rotate to face isometric view)
      mesh.rotation.x = -Math.PI / 6; // Tilt slightly
      mesh.lookAt(
        mesh.position.x + this.camera.position.x,
        mesh.position.y + this.camera.position.y,
        mesh.position.z + this.camera.position.z
      );

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
   * Center camera on the map.
   */
  centerCamera(mapSize: { width: number; height: number }): void {
    const centerX = (mapSize.width / 2 - 10) * TILE_SIZE;
    const centerZ = (mapSize.height / 2 - 10) * TILE_SIZE;

    this.camera.position.set(centerX + 20, 20, centerZ + 20);
    this.camera.lookAt(centerX, 0, centerZ);
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
   * Cleanup.
   */
  dispose(): void {
    this.renderer.dispose();
    window.removeEventListener("resize", this.handleResize.bind(this));
  }
}
