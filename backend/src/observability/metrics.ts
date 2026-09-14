/**
 * Métricas em memória (issue #44) — sem Prometheus/serviço externo de
 * propósito: a escala do produto (poucos usuários, um processo só) não
 * justifica operar mais uma dependência; um snapshot JSON em `/metrics`
 * já cobre "métricas mostram conexões/erros" (critério de aceite).
 * Nome da métrica segue convenção `nome{label="valor",...}` (familiar de
 * quem já viu Prometheus) só como identificador de string — não há
 * parsing/agregação por label aqui, cada combinação é uma chave própria.
 * Perdido em restart do processo, como qualquer coisa só-em-memória deste
 * backend (mesma escolha já feita pra SignalingRooms/PresenceStore).
 */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  incrementGauge(name: string, by = 1): void {
    this.setGauge(name, (this.gauges.get(name) ?? 0) + by);
  }

  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}
