/**
 * Limite de tentativas de conexão WebSocket por IP (issue #43 — "limites
 * de conexão"). Não usa `@fastify/rate-limit`: aquele plugin atua via
 * `onRoute`/`preHandler` sobre requisições HTTP normais, e a rota de `/ws`
 * é um upgrade de protocolo tratado pelo `@fastify/websocket` — em vez de
 * depender de uma interação não documentada entre os dois plugins, um
 * limitador de janela deslizante simples e próprio, testável isolado.
 * Em memória, como `SignalingRooms`/`PresenceStore` — reinicia com o
 * processo.
 */
export class ConnectRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** `true` se a tentativa é permitida (e já conta pra próxima). */
  allow(key: string, now: number = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
