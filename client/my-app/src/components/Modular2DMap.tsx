import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * 2D Map + Modular WASD Movement (React + Canvas)
 * ------------------------------------------------
 * - Single-file, production-ready demo aiming for clean, scalable structure.
 * - Uses a tiny ECS-like approach: World manages entities, Systems do work.
 * - InputManager abstracts controls (WASD & Arrow keys by default) and is extendable.
 * - GameLoop is delta-time based via requestAnimationFrame.
 * - Canvas rendering with crisp scaling; map grid; players as icons.
 * - UI allows adding more players dynamically.
 *
 * How to extend:
 * - Add new Systems (e.g., PhysicsSystem, CollisionSystem) inside World.update.
 * - Add new entity types by extending BaseEntity and adding a renderer.
 * - Expand InputManager bindings or swap to another input strategy (e.g., on-screen arrows).
 */

/******************************
 * Types & Constants
 ******************************/

// Basic vector type for positions and velocities
interface Vec2 { x: number; y: number }

// Supported actions for input abstraction
type Action = "up" | "down" | "left" | "right";

// Base entity with minimal required fields
interface BaseEntity {
  id: string;
  kind: "player" | string;
  position: Vec2; // top-left in world space (pixels)
  speed?: number; // pixels per second (for movable entities)
  color?: string; // optional visual hint
  label?: string; // optional label drawn below icon
}

// World configuration constants
const TILE_SIZE = 48; // pixels per tile
const MAP_COLS = 20; // width in tiles
const MAP_ROWS = 12; // height in tiles
const WORLD_WIDTH = MAP_COLS * TILE_SIZE;
const WORLD_HEIGHT = MAP_ROWS * TILE_SIZE;

// Movement & rendering constants
const DEFAULT_PLAYER_SPEED = 220; // px/s
const PLAYER_SIZE = 30; // rendered diameter

/******************************
 * Input Abstraction
 ******************************/

/**
 * InputManager
 * -------------
 * Holds key state and maps them to semantic actions. This makes it easy to
 * support multiple control schemes (e.g., WASD + Arrows) or future inputs
 * (touch/gamepad) by translating them into Action toggles.
 */
class InputManager {
  // Map action => Set of keys that can trigger it
  private bindings: Record<Action, Set<string>>;

  // Current pressed keys (normalized to lower-case)
  private pressed: Set<string> = new Set();

  constructor(custom?: Partial<Record<Action, string[]>>) {
    // Default bindings: WASD + Arrow keys
    this.bindings = {
      up: new Set(["w", "arrowup"]),
      down: new Set(["s", "arrowdown"]),
      left: new Set(["a", "arrowleft"]),
      right: new Set(["d", "arrowright"]),
    };

    // Merge custom bindings (if provided)
    if (custom) {
      (Object.keys(custom) as Action[]).forEach((action) => {
        const keys = custom[action];
        if (!keys) return;
        this.bindings[action] = new Set(keys.map((k) => k.toLowerCase()));
      });
    }
  }

  /** Register keyboard listeners */
  attach(): void {
    // Use passive listeners for performance; normalize key to lower-case
    window.addEventListener(
      "keydown",
      (e) => {
        // Prevent default for arrow keys to avoid page scroll
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
        }
        this.pressed.add(e.key.toLowerCase());
      },
      { passive: false }
    );

    window.addEventListener(
      "keyup",
      (e) => {
        this.pressed.delete(e.key.toLowerCase());
      },
      { passive: true }
    );
  }

  /** Check whether an action is currently active */
  isActive(action: Action): boolean {
    const keys = this.bindings[action];
    for (const k of keys) if (this.pressed.has(k)) return true;
    return false;
  }
}

/** React hook that owns a single InputManager instance */
function useInput(bindings?: Partial<Record<Action, string[]>>) {
  const managerRef = useRef<InputManager | null>(null);
  if (!managerRef.current) managerRef.current = new InputManager(bindings);

  useEffect(() => {
    managerRef.current!.attach();
  }, []);

  return managerRef.current!;
}

/******************************
 * World & Systems
 ******************************/

/**
 * World
 * -----
 * Holds entities and runs systems on update. For now: one MovementSystem that
 * drives the *local* player (id === "player-1") via InputManager. Additional
 * systems (e.g., network sync) can be inserted later without touching UI.
 */
class World {
  private entities: Map<string, BaseEntity> = new Map();
  private bounds = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
  private localPlayerId: string | null = null;

  constructor(initial?: BaseEntity[]) {
    initial?.forEach((e) => this.entities.set(e.id, e));
  }

  /** Get a snapshot array of all entities */
  all(): BaseEntity[] {
    return Array.from(this.entities.values());
  }

  /** Add or update entity */
  upsert(entity: BaseEntity) {
    this.entities.set(entity.id, entity);
  }

  /** Mark an id as the local controllable player */
  setLocalPlayer(id: string) {
    if (!this.entities.has(id)) throw new Error(`Unknown entity id: ${id}`);
    this.localPlayerId = id;
  }

  /**
   * Update the world state. This is where Systems run in a deterministic order.
   *
   * @param dtSeconds - Delta time since last frame in seconds
   * @param input - InputManager for reading current actions
   */
  update(dtSeconds: number, input: InputManager) {
    if (!this.localPlayerId) return;
    const p = this.entities.get(this.localPlayerId);
    if (!p) return;

    // --- MovementSystem: translate intent to velocity & apply ---
    const speed = p.speed ?? DEFAULT_PLAYER_SPEED;
    let vx = 0;
    let vy = 0;
    if (input.isActive("left")) vx -= speed;
    if (input.isActive("right")) vx += speed;
    if (input.isActive("up")) vy -= speed;
    if (input.isActive("down")) vy += speed;

    // Normalize diagonal movement to keep speed consistent
    if (vx !== 0 && vy !== 0) {
      const inv = 1 / Math.sqrt(2);
      vx *= inv;
      vy *= inv;
    }

    // Integrate
    const nx = p.position.x + vx * dtSeconds;
    const ny = p.position.y + vy * dtSeconds;

    // Clamp to world bounds
    p.position.x = Math.max(0, Math.min(this.bounds.width - PLAYER_SIZE, nx));
    p.position.y = Math.max(0, Math.min(this.bounds.height - PLAYER_SIZE, ny));

    // Persist changes
    this.entities.set(p.id, p);
  }
}

/******************************
 * Rendering
 ******************************/

/**
 * Draw a light grid for orientation.
 */
function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#e5e7eb"; // neutral-200
  for (let x = 0; x <= width; x += TILE_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += TILE_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw a single player as a colored disc with a label. Replace with sprite
 * rendering later if needed.
 */
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  e: BaseEntity
) {
  const r = PLAYER_SIZE / 2;
  const cx = e.position.x + r;
  const cy = e.position.y + r;

  // Body
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = e.color ?? "#2563eb"; // blue-600
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6;
  ctx.fill();

  // Direction hint (simple triangle pointing up)
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.7);
  ctx.lineTo(cx - r * 0.3, cy - r * 0.2);
  ctx.lineTo(cx + r * 0.3, cy - r * 0.2);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Label
  if (e.label) {
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI";
    ctx.fillStyle = "#111827"; // gray-900
    ctx.textAlign = "center";
    ctx.fillText(e.label, cx, cy + r + 14);
  }

  ctx.restore();
}

/**
 * Render all entities in the world.
 */
function renderWorld(ctx: CanvasRenderingContext2D, world: World) {
  // Clear
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Background
  ctx.fillStyle = "#f9fafb"; // gray-50
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Grid
  drawGrid(ctx, ctx.canvas.width, ctx.canvas.height);

  // Entities
  const entities = world.all();
  for (const e of entities) {
    if (e.kind === "player") drawPlayer(ctx, e);
    // Add other entity renderers here as you expand kinds
  }
}

/******************************
 * Game Loop Hook
 ******************************/

/**
 * useGameLoop
 * -----------
 * Delta-timed RAF loop. Calls user update/render. Cleans up on unmount.
 */
function useGameLoop(
  update: (dtSeconds: number) => void,
  render: () => void
) {
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = (now: number) => {
      if (lastTimeRef.current == null) {
        lastTimeRef.current = now;
      }
      const dtMs = now - lastTimeRef.current;
      lastTimeRef.current = now;

      // Convert to seconds and clamp very large deltas (tab switched)
      const dtSeconds = Math.min(dtMs / 1000, 0.1);
      update(dtSeconds);
      render();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTimeRef.current = null;
    };
  }, [update, render]);
}

/******************************
 * Canvas Utilities
 ******************************/

/**
 * Ensure a crisp canvas on HiDPI screens by accounting for devicePixelRatio.
 */
function useHiDPICanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  widthCss: number,
  heightCss: number
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(widthCss * dpr);
    canvas.height = Math.floor(heightCss * dpr);
    canvas.style.width = `${widthCss}px`;
    canvas.style.height = `${heightCss}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [canvasRef, widthCss, heightCss]);
}

/******************************
 * UI: Game Component
 ******************************/

type PlayerSeed = Pick<BaseEntity, "label" | "color">;

function createPlayer(id: string, pos: Vec2, seed?: PlayerSeed): BaseEntity {
  return {
    id,
    kind: "player",
    position: { ...pos },
    speed: DEFAULT_PLAYER_SPEED,
    color: seed?.color ?? randomColor(),
    label: seed?.label ?? id,
  };
}

function randomColor(): string {
  // Friendly palette
  const palette = [
    "#2563eb", // blue-600
    "#059669", // emerald-600
    "#7c3aed", // violet-600
    "#dc2626", // red-600
    "#f59e0b", // amber-500
    "#0ea5e9", // sky-500
  ];
  return palette[Math.floor(Math.random() * palette.length)];
}

/**
 * Default export: 2D Map with modular movement
 */
export default function Modular2DMap() {
  // Canvas settings (CSS pixels)
  const VIEW_W = 960;
  const VIEW_H = 600;

  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Input
  const input = useInput();

  // World (memoized so it persists between renders)
  const world = useMemo(() => {
    const w = new World([
      createPlayer("player-1", { x: 100, y: 100 }, { label: "P1" }),
    ]);
    w.setLocalPlayer("player-1");
    return w;
  }, []);

  // HiDPI setup
  useHiDPICanvas(canvasRef, VIEW_W, VIEW_H);

  // Rendering context memo
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    ctxRef.current = canvas.getContext("2d");
  }, []);

  // Game loop: update and render
  useGameLoop(
    (dt) => {
      world.update(dt, input);
    },
    () => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      renderWorld(ctx, world);
    }
  );

  // UI state for adding new players
  const [nextId, setNextId] = useState(2);

  /** Add a new player at a random free-ish location */
  const addPlayer = () => {
    const id = `player-${nextId}`;
    setNextId((n) => n + 1);
    const px = Math.random() * (WORLD_WIDTH - PLAYER_SIZE);
    const py = Math.random() * (WORLD_HEIGHT - PLAYER_SIZE);
    world.upsert(createPlayer(id, { x: px, y: py }, { label: `P${nextId}` }));
  };

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      {/* Header */}
      <div className="w-full max-w-[1200px] flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">2D Map • Modular Movement</h1>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 rounded-xl shadow-sm border hover:shadow transition bg-white"
            onClick={addPlayer}
          >
            Add Player
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="w-full max-w-[1200px] text-sm text-gray-700 mb-2">
        <p>
          Controls: <span className="font-mono">W/A/S/D</span> or
          <span className="font-mono"> Arrow Keys</span>. Players cannot leave the map.
        </p>
      </div>

      {/* Canvas Container */}
      <div className="flex-1 flex items-center justify-center w-full">
        <div className="relative rounded-2xl border bg-white shadow-lg p-3 max-w-full max-h-full">
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>

      {/* Footer: architecture notes */}
      <div className="w-full max-w-[1200px] text-xs text-gray-500 leading-relaxed mt-4">
        <p>
          Architecture: InputManager → World.update (Systems) → Renderer. Add more systems (e.g.,
          collisions, network sync, AI) without changing the UI. Swap InputManager for touch or
          on-screen arrows by mapping events to the same actions.
        </p>
      </div>
    </div>
  );
}
