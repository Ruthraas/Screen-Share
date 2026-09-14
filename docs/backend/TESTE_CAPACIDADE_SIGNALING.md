# Teste de capacidade — sinalização (issue #47)

Documento vivo. Objetivo: deixar claro o que este teste mede de verdade
hoje, o que fica de fora (e por quê), como rodar, e os números da última
execução real.

## 0. O que este teste NÃO cobre (leia antes de interpretar os números)

`#47` original pede "bitrate, CPU, memória, banda" do **relay de mídia**.
Isso não dá pra medir ainda:

- **Sem `RTCPeerConnection` no cliente ainda** (issue #71, em aberto) — não
  existe SDP/mídia de verdade trafegando, só mensagens pequenas de
  sinalização (`offer`/`answer`/`ice-candidate` com payload sintético).
  "Bitrate" não existe nesse cenário.
- **TURN é um serviço gerenciado (Cloudflare Realtime, issue #40)** — não
  operamos o relay de mídia, então CPU/memória/banda desse relay não são
  infraestrutura nossa pra medir. Quando a #71 estiver pronta e uma sessão
  de mídia real acontecer, os números relevantes de capacidade de TURN
  vêm do próprio dashboard/limites da Cloudflare, não de um teste local.

O que **este** teste mede, de verdade, contra um servidor real: capacidade
da camada de **sinalização** (WebSocket, `/ws`) e da API HTTP que a
antecede (registro, grupos, convites) — conexões simultâneas, latência de
relay de mensagens sob carga, e tempo de notificação quando uma conexão
cai (perda de pacote/reconexão). É a parte que já está pronta e é nossa.

## 1. Como rodar

O rate limit (issue #43) é por IP e pensado pra tráfego real — esse teste
roda tudo do mesmo IP (localhost), então precisa dos limites bem altos pra
não confundir "capacidade de sinalização" com "limite anti-abuso
funcionando" (que já está provado nos testes automatizados/PR do #43):

```bash
cd backend
RATE_LIMIT_REGISTER_MAX=1000000 RATE_LIMIT_WS_CONNECT_MAX=1000000 npm run dev
```

Em outro terminal:

```bash
cd backend
CONNECTIONS=300 GROUPS=30 RUNS=2 npm run test:capacidade-signaling
```

`CONNECTIONS` (default 100), `GROUPS` (default 10, conexões distribuídas
entre os grupos), `RUNS` (default 2 — roda duas vezes e compara, critério
de validação da issue). Escreve um relatório JSON em
`backend/reports/capacidade-signaling-<timestamp>.json` (gitignored — é
saída de execução local, não artefato versionado).

## 2. Achado real no caminho: SQLite sem WAL degradava de forma super-linear

Rodando a primeira vez com 500 conexões, o setup (registro sequencial de
usuários) foi de **~10s pros primeiros 100 pra ~147s no total pros 500** —
claramente não-linear (deveria ser ~5x, não ~15x). Investigado: `openDatabase()`
não configurava `journal_mode` — o padrão do SQLite (rollback journal) cria e
apaga um arquivo de journal a cada transação de escrita, com `fsync` a cada
commit; em Windows isso fica sensível a antivírus/indexação reescaneando o
arquivo a cada escrita, piorando conforme o arquivo cresce.

**Corrigido** (`src/db/connection.ts`): `PRAGMA journal_mode = WAL` +
`PRAGMA synchronous = NORMAL` (pareamento padrão recomendado pela própria
documentação do SQLite pra esse cenário — ainda seguro contra corrupção,
só relaxa o fsync por transação). Resultado, mesmo teste, mesma máquina:
**147s → 8.4s pros 500 registros (17.6x mais rápido)**, e a curva virou
linear (ver seção 3). Isso não é específico deste teste sintético — afeta
qualquer sequência de escritas reais no produto (cadastro em massa,
importação, etc.), então vale pra produção também, não só pro teste.

## 3. Última execução real (2026-09-14)

Ambiente: Windows 10 Home, 8 CPUs, 17GB RAM, Node v24.14.1, mesma máquina
(sem isolamento de rede/CPU — por isso a tolerância de repetibilidade é
50%, ou um piso absoluto de 20ms pra medições muito pequenas onde ruído
do SO já domina qualquer percentual).

`CONNECTIONS=300 GROUPS=30 RUNS=2` (300 conexões simultâneas, 10 membros
por grupo, resultado com WAL já ligado):

| Métrica | Execução 1 | Execução 2 |
|---|---|---|
| Setup (registro de 300 usuários, concorrência 25) | 4372ms | 4122ms |
| Conexões WS simultâneas bem-sucedidas | 300/300 | 300/300 |
| Latência de connect — p50 / p95 / max | 185.0 / 254.7 / 263.5 ms | 171.5 / 245.1 / 255.7 ms |
| Latência de relay (offer→destinatário) — p50 / p95 / max | 0.3 / 1.9 / 1.9 ms | 0.4 / 1.7 / 1.7 ms |
| Notificação de queda (peer-left) — p50 / max | 0.7 / 1.2 ms | 0.8 / 8.4 ms |
| Δ memória RSS (processo cliente do teste) | +67.6MB | -23.6MB |
| Falhas | 0 | 0 |

Repetibilidade: dentro da tolerância documentada nas duas execuções (sem
falhas, latências de relay consistentemente sub-2ms, connect p95 estável
em ~250ms pra 300 conexões simultâneas).

Também testado a 500/1000 conexões durante a investigação do achado da
seção 2 — 500 conexões simultâneas: 0 falhas, connect p50 ~462-512ms
(cresce com o número de conexões porque a checagem de membership em cada
`/ws` faz uma leitura síncrona no SQLite — `better-sqlite3` é
propositalmente síncrono, então N conexões simultâneas serializam N
leituras rápidas no mesmo processo; não é gargalo de banda/rede, é
esperado pra essa arquitetura e ainda assim rápido o bastante pro tamanho
do produto). **Limite observado nesta rodada**: nenhuma falha até 500
conexões simultâneas; não foi encontrado um teto real de quebra dentro do
que testei — o próximo passo pra achar um teto de verdade seria escalar
bem além de 1000 ou introduzir concorrência artificial na leitura de
membership, o que não parece valer o esforço pro tamanho do produto
(grupos privados pequenos, não milhares de conexões simultâneas).

## 4. Próximo passo real de capacidade

A issue #71 (cliente WebRTC no frontend, com indicador de qualidade) já
foi mergeada (`4604275`, 2026-09-14) — então o bloqueio "sem cliente
capaz de mídia real" descrito na seção 0 não existe mais no frontend.
O que falta pra medir bitrate/CPU/memória de mídia de verdade não é mais
código, é **execução**: rodar duas ou mais instâncias reais do app
Tauri (não um script Node) trocando tela de verdade, o que é um teste
manual/integração, fora do escopo de um script automatizado de backend.
Esse documento e o script (`backend/scripts/teste-capacidade-signaling.mjs`)
continuam cobrindo a camada de sinalização (o que é nosso e é
automatizável); o teste de mídia real fica para quando houver testes reais
manuais com o app compilado.
