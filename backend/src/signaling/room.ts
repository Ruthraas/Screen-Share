import type { WebSocket } from "ws";

/**
 * Salas de sinalização em memória — um Map por grupo, de uid pro socket
 * ativo (issue #37: "salas por grupo, roteamento e limpeza no disconnect").
 * Não há persistência: se o processo reiniciar, todo mundo reconecta.
 */
export class SignalingRooms {
  private readonly rooms = new Map<string, Map<string, WebSocket>>();

  /**
   * Uma conexão por usuário por grupo — uma nova substitui (fecha) a
   * anterior. Devolve `true` quando substituiu uma conexão existente
   * (retomada de sala após queda de rede — issue #42): quem chama usa isso
   * pra decidir entre broadcastar `peer-joined` (uid nunca esteve na sala)
   * ou `peer-reconnected` (uid caiu e voltou, outros participantes devem
   * tentar ICE restart com ele em vez de tratar como participante novo).
   */
  join(groupId: string, uid: string, socket: WebSocket): boolean {
    let room = this.rooms.get(groupId);
    if (!room) {
      room = new Map();
      this.rooms.set(groupId, room);
    }
    const existing = room.get(uid);
    const replaced = existing !== undefined && existing !== socket;
    if (replaced && existing.readyState === existing.OPEN) {
      existing.close(4409, "replaced by a new connection");
    }
    room.set(uid, socket);
    return replaced;
  }

  /**
   * Remove a conexão — mas só se `socket` ainda for a atual pra esse uid.
   * Devolve `false` sem remover nada quando não for (issue #42: o `close`
   * de uma conexão antiga, já substituída por uma reconexão via `join()`,
   * não deve mais contar como o participante saindo — sem isso, quem
   * chama broadcastaria um `peer-left` incorreto pra alguém que na
   * verdade continua conectado pela conexão nova).
   */
  leave(groupId: string, uid: string, socket: WebSocket): boolean {
    const room = this.rooms.get(groupId);
    if (!room || room.get(uid) !== socket) return false;
    room.delete(uid);
    if (room.size === 0) {
      this.rooms.delete(groupId);
    }
    return true;
  }

  membersOf(groupId: string): string[] {
    return Array.from(this.rooms.get(groupId)?.keys() ?? []);
  }

  sendTo(groupId: string, uid: string, data: string): boolean {
    const socket = this.rooms.get(groupId)?.get(uid);
    if (!socket || socket.readyState !== socket.OPEN) return false;
    socket.send(data);
    return true;
  }

  broadcast(groupId: string, data: string, exceptUid?: string): void {
    const room = this.rooms.get(groupId);
    if (!room) return;
    for (const [uid, socket] of room) {
      if (uid === exceptUid) continue;
      if (socket.readyState === socket.OPEN) socket.send(data);
    }
  }

  /** Derruba todas as sessões de um grupo (ex.: grupo excluído — issue #39). */
  closeGroup(groupId: string, code: number, reason: string): void {
    const room = this.rooms.get(groupId);
    if (!room) return;
    for (const socket of room.values()) {
      if (socket.readyState === socket.OPEN) socket.close(code, reason);
    }
    this.rooms.delete(groupId);
  }
}
