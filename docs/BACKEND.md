# Backend — estado, plano e contrato com o frontend

Documento vivo (atualizar a cada mudança relevante, não só descrever o
passado). Objetivo: qualquer pessoa ou IA do lado do frontend consegue ler só
este arquivo e saber (1) o que já existe no backend, (2) o que está
planejado, (3) o que precisa implementar/expor para os dois lados se
conversarem — sem depender de contexto de conversa anterior.

> **Nota de migração (2026-09-12):** o repositório foi reescrito. A stack
> antiga (Electron + `client/*.cjs` consumindo Firebase RTDB direto do
> renderer) foi abandonada; ela ainda existe só como referência histórica no
> clone antigo (`ScreenShare Clone`, fora deste repo). A partir de
> `ed9e397` o cliente é **React + Vite + Tauri (Rust)** em `src/` e
> `src-tauri/`, e o backend passa a ser **um serviço remoto separado** que o
> cliente consome por contrato explícito (ver §4). Nada do código antigo se
> aplica diretamente — este documento descreve só o backend novo.

---

## 1. O que é "backend" agora

Um serviço remoto em **Node.js + TypeScript** (Fastify para HTTP, `ws` para
WebSocket — decisão registrada e justificada em
[`docs/backend/ARQUITETURA.md`](backend/ARQUITETURA.md), issue
[#27](https://github.com/Ruthraas/Screen-Share/issues/27)) que serve o
cliente React/Tauri via HTTP (grupos, convites, presença, credenciais TURN)
e WebSocket (sinalização WebRTC: offer/answer/ICE). Ele é o dono de:
autenticação de requisições, autorização por papel dentro do grupo,
persistência de grupos/membros/convites, emissão de credenciais TURN de
curta duração, e relay de sinalização entre participantes autorizados.

O backend **não** implementa UI, não guarda mídia/SDP além do necessário para
rotear, e não decide layout/design — isso é escopo do frontend.

## 2. Feito

- **#27 — Arquitetura e contrato HTTP do backend** (2026-09-12, branch
  `feat/backend-http-contract`): decisão de stack registrada
  (`docs/backend/ARQUITETURA.md`), módulos e limites mapeados por issue,
  formato de erro/versionamento definido, e contrato OpenAPI 3.1 inicial em
  [`docs/backend/openapi.yaml`](backend/openapi.yaml) cobrindo grupos
  (criar/listar/detalhar/atualizar/excluir/saír), convites
  (criar/listar/revogar/aceitar), presença (heartbeat/consulta) e emissão de
  credenciais TURN — com exemplos de requisição/resposta e validado com
  `@redocly/cli lint` (0 erros, 1 warning cosmético de `info.license`, sem
  `LICENSE` no repo). Nenhum código de implementação ainda — só doc/contrato,
  como pede o escopo da issue.
- **#28 — Serviço backend inicial com health check** (2026-09-12, branch
  `feat/backend-service-bootstrap`): `backend/` criado como projeto Node.js +
  TypeScript independente (não roda dentro do Tauri) com Fastify. Estrutura:
  `src/config.ts` (host/porta, sem segredos — isso é #29), `src/server.ts`
  (monta o Fastify sem dar `listen`, testável via `inject()`),
  `src/routes/health.ts` (`GET /health` → `{status:"ok"}`), `src/index.ts`
  (sobe o servidor, trata `SIGINT`/`SIGTERM` chamando `app.close()`).
  Comando documentado em `backend/README.md` (`npm install && npm run dev`,
  ou `npm run build && npm start`). Validado localmente: `npm run build` ok,
  `npm test` (Node test runner via `tsx`) 5/5 passando, `npm start` sobe e
  responde `/health` com 200. Nenhuma regra de produto/auth/persistência
  ainda — só a base. Nota: o encerramento gracioso via sinal não pôde ser
  validado ponta a ponta neste ambiente Windows de desenvolvimento (ver
  `backend/README.md`); `app.close()` em si é coberto pelos testes.

## 3. Planejado — backlog de backend (26 issues, todas atribuídas a @ProgVictorPe)

Ordem de execução pela dependência declarada em cada issue (quem não depende
de nada vem primeiro; grupos entre `---` podem andar em paralelo):

1. [#27](https://github.com/Ruthraas/Screen-Share/issues/27) — Documentar arquitetura e contrato HTTP do backend (OpenAPI) — **sem dependências, ponto de partida**
2. [#28](https://github.com/Ruthraas/Screen-Share/issues/28) — Inicializar serviço backend com health checks — depende de #27

---
3. [#29](https://github.com/Ruthraas/Screen-Share/issues/29) — Config e gestão de segredos — depende de #28
4. [#30](https://github.com/Ruthraas/Screen-Share/issues/30) — Verificar tokens de autenticação — depende de #27, #28
5. [#31](https://github.com/Ruthraas/Screen-Share/issues/31) — Schema/migrações de grupos e membros — depende de #27, #28
6. [#38](https://github.com/Ruthraas/Screen-Share/issues/38) — Protocolo versionado de sinalização — depende de #27
7. [#40](https://github.com/Ruthraas/Screen-Share/issues/40) — Provisionar infraestrutura TURN — depende de #28 (+ decisão TURN já aprovada)

---
8. [#35](https://github.com/Ruthraas/Screen-Share/issues/35) — Autorização por papel no grupo — depende de #30, #31
9. [#32](https://github.com/Ruthraas/Screen-Share/issues/32) — API de criação/consulta de grupos — depende de #30, #31
10. [#41](https://github.com/Ruthraas/Screen-Share/issues/41) — Credenciais TURN temporárias — depende de #30, #40

---
11. [#33](https://github.com/Ruthraas/Screen-Share/issues/33) — Exclusão/saída segura de grupos — depende de #32
12. [#34](https://github.com/Ruthraas/Screen-Share/issues/34) — Convites com expiração/revogação — depende de #30, #31, #32
13. [#36](https://github.com/Ruthraas/Screen-Share/issues/36) — Presença com heartbeat/expiração — depende de #35, #38
14. [#37](https://github.com/Ruthraas/Screen-Share/issues/37) — Serviço de sinalização WebSocket — depende de #30, #35, #38

---
15. [#39](https://github.com/Ruthraas/Screen-Share/issues/39) — Autorizar signaling por grupo/participante — depende de #35, #37, #38
16. [#42](https://github.com/Ruthraas/Screen-Share/issues/42) — Reconexão de signaling e ICE restart — depende de #36, #37, #41
17. [#43](https://github.com/Ruthraas/Screen-Share/issues/43) — Limites de uso / anti-abuso — depende de #28, #30, #36, #41
18. [#44](https://github.com/Ruthraas/Screen-Share/issues/44) — Logs estruturados, métricas, readiness — depende de #28, #36, #40

---
19. [#45](https://github.com/Ruthraas/Screen-Share/issues/45) — Suíte de testes automatizados do backend — depende de #30 a #42 (incremental)
20. [#46](https://github.com/Ruthraas/Screen-Share/issues/46) — CI e ambiente reproduzível — depende de #28, #31, #44
21. [#47](https://github.com/Ruthraas/Screen-Share/issues/47) — Teste de capacidade TURN + signaling — depende de #36, #40, #41, #42, #43

22. [#49](https://github.com/Ruthraas/Screen-Share/issues/49) — Automatizar release/manifesto do updater Tauri — depende de #5 e #22 (**issues do frontend**) + decisão de assinatura digital. Paralelo, mas só fecha depois que o frontend entregar build/ícones.

23. [#10](https://github.com/Ruthraas/Screen-Share/issues/10) — Validar múltiplas transmissões com TURN (integração ponta a ponta) — depende de [#20](https://github.com/Ruthraas/Screen-Share/issues/20) (**frontend**: troca entre transmissões no cliente) + #36, #37, #38, #39, #40, #41, #43, #47. **Não é backend puro — é o gate de integração cross-team**, fica para o fim.

### #6, #7, #9 — fechadas como duplicadas (2026-09-12)

- **#6** "Definir modelo persistente de grupos privados" — fechada, superseded por #27 (contrato) + #31 (schema).
- **#7** "Implementar convites e presença em grupos" — fechada, superseded por #34 (convites) + #36 (presença).
- **#9** "Implementar sinalização e conexão WebRTC" — fechada, superseded por #37 (serviço WS) + #38 (protocolo) + #39 (autorização). Ponto aberto anotado no comentário de fechamento: a implementação do `RTCPeerConnection` no cliente não tem issue própria clara do lado frontend — não é nosso escopo resolver, só ficar de olho.
- **#10 continua aberta** — não é duplicado, é o gate de integração cross-team (depende de #20 do frontend + várias issues novas do backend).

## 4. Contrato com o Frontend

_(o que o front precisa implementar/expor, ou o que o backend precisa que o front decida, para os dois lados se conversarem — atualizar a cada entrega)_

Contrato HTTP inicial fechado em [`docs/backend/openapi.yaml`](backend/openapi.yaml) (#27, ainda sem implementação — próximo passo é #28). Pontos que o frontend precisa saber desde já:

- **Base URL/versionamento**: todas as rotas HTTP terão prefixo `/v1/...`; mudança incompatível vira `/v2/...`, `/v1` nunca muda de forma retroativa.
- **Autenticação**: `Authorization: Bearer <idToken do Firebase Auth>` em toda requisição — o mesmo token que `src/services/firebase.ts` já obtém no login. Verificação real do token é #30 (ainda não implementada); o formato do header já está fixado.
- **Erros**: envelope único `{ "error": { "code", "message", "correlationId" } }` — `code` é estável p/ lógica do cliente, `message` é pt-BR seguro pra exibir direto. Ver schema `Error` no OpenAPI.
- **Grupos/convites/presença/TURN**: endpoints e payloads completos, com exemplos, em `openapi.yaml` — `POST /v1/groups`, `GET /v1/groups`, `GET|PATCH|DELETE /v1/groups/{id}`, `POST /v1/groups/{id}/leave`, `POST|GET /v1/groups/{id}/invites`, `DELETE /v1/groups/{id}/invites/{inviteId}`, `POST /v1/invites/{token}/accept`, `POST /v1/groups/{id}/presence/heartbeat`, `GET /v1/groups/{id}/presence`, `POST /v1/turn-credentials`.
- **WebSocket**: cliente troca offer/answer/ICE por um protocolo versionado com `correlationId` (#38, ainda a escrever) — o front precisa implementar o cliente WS e o `RTCPeerConnection` consumindo esse protocolo (não é escopo do backend).
- **TURN**: cliente precisa pedir credenciais temporárias ao backend (#41) antes de abrir conexão — nunca usar segredo estático.
- **Updater**: `#48` (frontend, exibir/instalar atualização) consome o manifesto gerado por `#49` (backend/infra) — URLs HTTPS da própria release, arquitetura x64.
- **Dependência inversa**: `#49` (backend) só fecha depois que o frontend entregar `#5` (build/smoke test Windows) e `#22` (ícones/identidade do bundle).
- **Dependência inversa**: `#10` (integração) só fecha depois que o frontend entregar `#20` (troca entre transmissões no cliente).

## 5. Contexto de leitura do frontend (read-only)

Consultado só para alinhamento, sem tocar: 23 issues com `team: frontend`
(#1-#5, #8, #11-#26, #48) cobrem OAuth/sessão, design system, captura de
tela nativa, seletor de fonte, troca de transmissões, testes de frontend,
logging local, updater UI. Lista completa disponível via GitHub, não
duplicada aqui para não ficar desatualizada — conferir direto no repo
quando precisar de detalhe.
