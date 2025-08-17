"""
Authoritative multiplayer server (FastAPI + WebSocket)

- In-memory world state (players only).
- Server integrates inputs at a fixed tick (20 Hz) and clamps to bounds.
- Broadcasts the full state to all clients ~20 FPS.
- No auth, no persistence.

Message protocol (JSON)
-----------------------
Client -> Server:
  { "type": "hello" }
      # optional, just to open the socket; server answers with "welcome"

  { "type": "input", "id": "<player_id>",
    "up": bool, "down": bool, "left": bool, "right": bool }

Server -> Client:
  { "type": "welcome", "id": "<player_id>", "world": { "type":"state", "players":[...] } }
  { "type": "state", "players": [ { "id": str, "x": float, "y": float, "label": str, "color": str } ] }
  { "type": "join", "id": str }
  { "type": "leave", "id": str }
"""

import asyncio
import json
import math
import os
import random
import string
import time
from dataclasses import dataclass, field, asdict
from typing import Dict, Set, Tuple, Optional, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

# ---- World constants (mirror the client) ----
TILE_SIZE: int = 48
MAP_COLS: int = 20
MAP_ROWS: int = 12
WORLD_WIDTH: int = MAP_COLS * TILE_SIZE
WORLD_HEIGHT: int = MAP_ROWS * TILE_SIZE
PLAYER_SIZE: int = 30
DEFAULT_PLAYER_SPEED: float = 220.0  # px/s

# ---- Tick config ----
TICK_RATE: int = 20
TICK_MS: float = 1000.0 / TICK_RATE


# ---- Helpers ----
def _clamp(v: float, vmin: float, vmax: float) -> float:
    """Clamp a numeric value."""
    return max(vmin, min(vmax, v))


def _rand_id(n: int = 6) -> str:
    """Generate a short id."""
    alphabet = string.ascii_letters + string.digits
    return "".join(random.choice(alphabet) for _ in range(n))


def _rand_color() -> str:
    """Pick a pleasant color."""
    palette = ["#2563eb", "#059669", "#7c3aed", "#dc2626", "#f59e0b", "#0ea5e9"]
    return random.choice(palette)


@dataclass
class InputState:
    """Simple input state for a player."""

    up: bool = False
    down: bool = False
    left: bool = False
    right: bool = False


@dataclass
class Player:
    """Server-side player representation."""

    id: str
    x: float
    y: float
    speed: float = DEFAULT_PLAYER_SPEED
    label: str = "P"
    color: str = "#2563eb"
    input: InputState = field(default_factory=InputState)

    def integrate(self, dt: float) -> None:
        """Integrate movement using current input.

        :param dt: Delta time in seconds.
        :type dt: float
        """
        vx = 0.0
        vy = 0.0
        if self.input.left:
            vx -= self.speed
        if self.input.right:
            vx += self.speed
        if self.input.up:
            vy -= self.speed
        if self.input.down:
            vy += self.speed

        # Normalize diagonal
        if vx != 0.0 and vy != 0.0:
            inv = 1.0 / math.sqrt(2.0)
            vx *= inv
            vy *= inv

        nx = self.x + vx * dt
        ny = self.y + vy * dt

        # Clamp to world bounds (player is a disc ~ PLAYER_SIZE)
        self.x = _clamp(nx, 0.0, WORLD_WIDTH - PLAYER_SIZE)
        self.y = _clamp(ny, 0.0, WORLD_HEIGHT - PLAYER_SIZE)

    def snapshot(self) -> Dict:
        """Return a minimal public state for broadcast."""
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "label": self.label,
            "color": self.color,
        }


class Hub:
    """Connection hub that stores players and sockets.

    Responsibilities
    ----------------
    - Create/destroy players on connect/disconnect.
    - Store input per player.
    - Broadcast world snapshots.
    - Run the fixed-step simulation.
    """

    def __init__(self) -> None:
        self.players: Dict[str, Player] = {}
        self.sockets: Dict[str, WebSocket] = {}  # id -> websocket
        self.lock = asyncio.Lock()
        self._tick_task: Optional[asyncio.Task] = None
        self._last_tick: Optional[float] = None

    async def start(self) -> None:
        """Start the simulation loop."""
        if self._tick_task is None:
            self._tick_task = asyncio.create_task(self._ticker())

    async def stop(self) -> None:
        """Stop the simulation loop."""
        if self._tick_task:
            self._tick_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._tick_task
            self._tick_task = None

    async def _ticker(self) -> None:
        """20 Hz game loop."""
        self._last_tick = time.perf_counter()
        try:
            while True:
                now = time.perf_counter()
                dt = now - (self._last_tick or now)
                self._last_tick = now
                dt = min(dt, 0.1)  # clamp long pauses

                await self._step(dt)
                await self._broadcast_state()

                await asyncio.sleep(TICK_MS / 1000.0)
        except asyncio.CancelledError:
            return

    async def _step(self, dt: float) -> None:
        """Integrate all players."""
        async with self.lock:
            for p in self.players.values():
                p.integrate(dt)

    async def _broadcast_state(self) -> None:
        """Broadcast a world snapshot to all connected sockets."""
        snapshot = {
            "type": "state",
            "players": [p.snapshot() for p in self.players.values()],
        }
        msg = json.dumps(snapshot)
        # Send concurrently; drop dead sockets silently
        await asyncio.gather(
            *(self._safe_send(ws, msg) for ws in self.sockets.values()),
            return_exceptions=True,
        )

    async def _safe_send(self, ws: WebSocket, msg: str) -> None:
        try:
            await ws.send_text(msg)
        except Exception:
            # We let disconnect handler clean up
            pass

    async def connect(self, ws: WebSocket) -> str:
        """Register a new connection, create a player, and send welcome."""
        await ws.accept()
        pid = _rand_id()
        px = random.random() * (WORLD_WIDTH - PLAYER_SIZE)
        py = random.random() * (WORLD_HEIGHT - PLAYER_SIZE)
        player = Player(
            id=pid,
            x=px,
            y=py,
            label=f"P{pid[:2].upper()}",
            color=_rand_color(),
            input=InputState(),
        )
        async with self.lock:
            self.players[pid] = player
            self.sockets[pid] = ws

        # Send welcome with initial snapshot
        welcome = {
            "type": "welcome",
            "id": pid,
            "world": {
                "type": "state",
                "players": [p.snapshot() for p in self.players.values()],
            },
        }
        await ws.send_text(json.dumps(welcome))
        # Notify others
        await self._broadcast_event({"type": "join", "id": pid}, exclude={pid})
        return pid

    async def disconnect(self, pid: str) -> None:
        """Remove a player and close its socket if needed."""
        async with self.lock:
            self.players.pop(pid, None)
            self.sockets.pop(pid, None)
        await self._broadcast_event({"type": "leave", "id": pid})

    async def _broadcast_event(
        self, event: Dict, exclude: Set[str] | None = None
    ) -> None:
        msg = json.dumps(event)
        targets = [
            ws for p, ws in self.sockets.items() if not exclude or p not in exclude
        ]
        await asyncio.gather(
            *(self._safe_send(ws, msg) for ws in targets), return_exceptions=True
        )

    async def handle_message(self, pid: str, data: Dict) -> None:
        """Handle a single client message (only 'input')."""
        if data.get("type") != "input":
            return
        # Basic validation
        if data.get("id") != pid:
            return
        async with self.lock:
            p = self.players.get(pid)
            if not p:
                return
            # Update input flags
            p.input.up = bool(data.get("up"))
            p.input.down = bool(data.get("down"))
            p.input.left = bool(data.get("left"))
            p.input.right = bool(data.get("right"))


# ---- FastAPI app and routes ----
app = FastAPI()
hub = Hub()


@app.on_event("startup")
async def _on_startup() -> None:
    await hub.start()


@app.on_event("shutdown")
async def _on_shutdown() -> None:
    # No need to await stop in FastAPI shutdown; kept for completeness
    pass


@app.get("/")
async def root() -> HTMLResponse:
    # Tiny page for manual test if you open ws from console
    return HTMLResponse("<h1>WS server up</h1>")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    """WebSocket endpoint.

    :param ws: The WebSocket connection.
    :type ws: WebSocket
    """
    pid = await hub.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except Exception:
                continue
            await hub.handle_message(pid, data)
    except WebSocketDisconnect:
        await hub.disconnect(pid)
    except Exception:
        await hub.disconnect(pid)
