import React, { useEffect, useMemo, useRef, useState } from "react";
import { useInput } from "./input/input";
import { renderWorld } from "./render/draw";
import { World } from "./core/world";
import { isServerStateMessage, isWelcomeMessage } from "./net/mapper";
import { WORLD_WIDTH, WORLD_HEIGHT } from "./types";

export default function Modular2DMap() {
  const VIEW_W = 960;
  const VIEW_H = 600; // WORLD_HEIGHT es 576; dejamos margen inferior.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const input = useInput();
  const world = useMemo(() => new World(), []);
  const [ws, setWs] = useState<WebSocket | null>(null);

  // Setup canvas + socket
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) ctxRef.current = canvas.getContext("2d");

    const socket = new WebSocket("ws://192.168.1.35:8000/ws");
    socket.onopen = () => console.log("Connected to server");

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Endurecer parseo
      if (isWelcomeMessage(data)) {
        world.setLocalPlayer(data.id);
        world.updateFromServer(data.world);
      } else if (isServerStateMessage(data)) {
        world.updateFromServer(data);
      } else {
        // Mensajes join/leave se ignoran para render; el estado llega en los "state"
      }
    };

    socket.onclose = () => console.log("Disconnected from server");
    setWs(socket);

    return () => socket.close();
  }, [world]);

  // Tick de input → servidor
  useEffect(() => {
    const tick = () => {
      const lp = world.getLocalPlayer();
      if (lp && ws && ws.readyState === WebSocket.OPEN) {
        const payload = {
          type: "input",
          id: lp.id,
          up: input.isActive("up"),
          down: input.isActive("down"),
          left: input.isActive("left"),
          right: input.isActive("right"),
        };
        ws.send(JSON.stringify(payload));
      }
    };
    const interval = setInterval(tick, 50); // 20 Hz
    return () => clearInterval(interval);
  }, [input, world, ws]);

  // Bucle de render con cancelación correcta
  useEffect(() => {
    let rafId = 0;
    const loop = () => {
      const ctx = ctxRef.current;
      if (ctx) {
        const ents = world.all();
        renderWorld(ctx, ents, ctx.canvas.width, ctx.canvas.height);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [world]);

  // --- Helper: simula teclas para controles táctiles ---
  const pressVirtual = (key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", down: boolean) => {
    // Usamos Pointer Events para móvil/desktop y evitamos scroll por defecto
    const type = down ? "keydown" : "keyup";
    const evt = new KeyboardEvent(type, { key }); // InputManager hace toLowerCase internamente
    window.dispatchEvent(evt);
  };


  return (
    <div className="app-container">


      <canvas ref={canvasRef} width={VIEW_W} height={VIEW_H} />
      {/* Opcional: debug overlay
      <pre className="absolute bottom-2 left-2 bg-white/70 p-2 text-xs">
        {JSON.stringify(world.all(), null, 2)}
      </pre> */}

      {/* Controles táctiles */}
      <div className="controls">
        <div />
        <button
          aria-label="Up"
          className="control-btn"
          onPointerDown={(e) => { e.preventDefault(); pressVirtual("ArrowUp", true); }}
          onPointerUp={(e) => { e.preventDefault(); pressVirtual("ArrowUp", false); }}
          onPointerLeave={() => pressVirtual("ArrowUp", false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          ↑
        </button>
        <div />

        <button
          aria-label="Left"
          className="control-btn"
          onPointerDown={(e) => { e.preventDefault(); pressVirtual("ArrowLeft", true); }}
          onPointerUp={(e) => { e.preventDefault(); pressVirtual("ArrowLeft", false); }}
          onPointerLeave={() => pressVirtual("ArrowLeft", false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          ←
        </button>

        <button
          aria-label="Down"
          className="control-btn"
          onPointerDown={(e) => { e.preventDefault(); pressVirtual("ArrowDown", true); }}
          onPointerUp={(e) => { e.preventDefault(); pressVirtual("ArrowDown", false); }}
          onPointerLeave={() => pressVirtual("ArrowDown", false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          ↓
        </button>

        <button
          aria-label="Right"
          className="control-btn"
          onPointerDown={(e) => { e.preventDefault(); pressVirtual("ArrowRight", true); }}
          onPointerUp={(e) => { e.preventDefault(); pressVirtual("ArrowRight", false); }}
          onPointerLeave={() => pressVirtual("ArrowRight", false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          →
        </button>
      </div>



    </div>
  );
}
