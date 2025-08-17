import { BaseEntity, ServerPlayerSnapshot, ServerStateMessage, WelcomeMessage } from "../types";

/**
 * Mapea snapshots del servidor (x,y) a entidades del cliente (position:{x,y}).
 */
export function mapServerPlayersToEntities(players: ServerPlayerSnapshot[]): BaseEntity[] {
  return players.map((p) => ({
    id: p.id,
    kind: "player",
    position: { x: p.x, y: p.y },
    color: p.color,
    label: p.label,
  }));
}

// --- Type guards robustos ---
export function isServerStateMessage(v: unknown): v is ServerStateMessage {
  const obj = v as Record<string, unknown>;
  if (!obj || obj["type"] !== "state" || !Array.isArray(obj["players"])) return false;
  return (obj["players"] as unknown[]).every((pl) => {
    const p = pl as Record<string, unknown>;
    return typeof p?.id === "string" && typeof p?.x === "number" && typeof p?.y === "number";
  });
}

export function isWelcomeMessage(v: unknown): v is WelcomeMessage {
  const obj = v as Record<string, unknown>;
  if (!obj || obj["type"] !== "welcome") return false;
  const world = obj["world"];
  return typeof obj["id"] === "string" && isServerStateMessage(world);
}
