import { BaseEntity, PLAYER_SIZE, TILE_SIZE } from "../types";

export function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#e5e7eb";
  for (let x = 0; x <= width; x += TILE_SIZE) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); ctx.stroke();
  }
  for (let y = 0; y <= height; y += TILE_SIZE) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); ctx.stroke();
  }
  ctx.restore();
}

export function drawPlayer(ctx: CanvasRenderingContext2D, e: BaseEntity): void {
  const r = PLAYER_SIZE / 2;
  const cx = e.position.x + r;
  const cy = e.position.y + r;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = e.color ?? "#2563eb";
  ctx.fill();

  if (e.label) {
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI";
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.fillText(e.label, cx, cy + r + 14);
  }
  ctx.restore();
}

export function renderWorld(ctx: CanvasRenderingContext2D, entities: BaseEntity[], width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f9fafb";
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  for (const e of entities) if (e.kind === "player") drawPlayer(ctx, e);
}
