export interface Vec2 { x: number; y: number; }

export type Action = "up" | "down" | "left" | "right";

export interface BaseEntity {
  id: string;
  kind: "player" | string;
  position: Vec2;         // << Cliente SIEMPRE usa position
  color?: string;
  label?: string;
}

// Constantes compartidas (cliente)
export const TILE_SIZE = 48;
export const MAP_COLS = 20;
export const MAP_ROWS = 12;
export const WORLD_WIDTH = MAP_COLS * TILE_SIZE;
export const WORLD_HEIGHT = MAP_ROWS * TILE_SIZE;
export const PLAYER_SIZE = 30;
export const DEFAULT_PLAYER_SPEED = 220;

// --- Protocolo del servidor ---
export interface ServerPlayerSnapshot {
  id: string;
  x: number;   // top-left del círculo
  y: number;
  label?: string;
  color?: string;
}

export interface ServerStateMessage {
  type: "state";
  players: ServerPlayerSnapshot[];
}

export interface WelcomeMessage {
  type: "welcome";
  id: string;
  world: ServerStateMessage; // { type:"state", players:[...] }
}
