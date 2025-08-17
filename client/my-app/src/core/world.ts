import { BaseEntity, WORLD_WIDTH, WORLD_HEIGHT, ServerStateMessage, WelcomeMessage } from "../types";
import { mapServerPlayersToEntities } from "../net/mapper";

export class World {
  private entities: Map<string, BaseEntity> = new Map();
  private localPlayerId: string | null = null;
  private readonly bounds = { width: WORLD_WIDTH, height: WORLD_HEIGHT };

  public all(): BaseEntity[] {
    return Array.from(this.entities.values());
  }

  public upsert(entity: BaseEntity): void {
    this.entities.set(entity.id, entity);
  }

  public setLocalPlayer(id: string): void {
    this.localPlayerId = id;
  }

  public getLocalPlayer(): BaseEntity | null {
    return this.localPlayerId ? this.entities.get(this.localPlayerId) ?? null : null;
  }

  /**
   * Sustituye el estado local con el snapshot del servidor.
   * Acepta tanto el `world` de welcome como mensajes `state`.
   */
  public updateFromServer(state: ServerStateMessage | WelcomeMessage["world"]): void {
    const players = mapServerPlayersToEntities(state.players);
    this.entities.clear();
    for (const p of players) this.entities.set(p.id, p);
  }
}
