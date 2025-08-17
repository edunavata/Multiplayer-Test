import { Action } from "../types";
import { useEffect, useRef } from "react";

export class InputManager {
  private bindings: Record<Action, Set<string>>;
  private pressed: Set<string> = new Set();

  constructor(custom?: Partial<Record<Action, string[]>>) {
    this.bindings = {
      up: new Set(["w", "arrowup"]),
      down: new Set(["s", "arrowdown"]),
      left: new Set(["a", "arrowleft"]),
      right: new Set(["d", "arrowright"]),
    };
    if (custom) {
      (Object.keys(custom) as Action[]).forEach((action) => {
        const keys = custom[action];
        if (!keys) return;
        this.bindings[action] = new Set(keys.map((k) => k.toLowerCase()));
      });
    }
  }

  attach(): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
      this.pressed.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.pressed.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }

  isActive(action: Action): boolean {
    for (const k of this.bindings[action]) if (this.pressed.has(k)) return true;
    return false;
  }
}

export function useInput(bindings?: Partial<Record<Action, string[]>>): InputManager {
  const managerRef = useRef<InputManager | null>(null);
  if (!managerRef.current) managerRef.current = new InputManager(bindings);
  useEffect(() => managerRef.current!.attach(), []);
  return managerRef.current!;
}
