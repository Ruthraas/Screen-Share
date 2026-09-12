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
- **#29 — Configuração e gestão de segredos** (2026-09-12, branch
  `feat/backend-config-secrets`): `src/config.ts` reescrito com schema
  `zod` cobrindo banco (`DATABASE_PATH`), autenticação (Firebase service
  account, path ou JSON), sinalização (`SIGNALING_PATH`) e TURN
  (`TURN_HOST`/`TURN_SECRET`). Variáveis sem valor seguro por padrão
  (banco, credencial Firebase, segredo TURN) são obrigatórias; sem elas o
  processo sai com `ConfigError` listando cada campo problemático, sem
  stack trace. `toPublicSummary()` redige segredos antes de qualquer log —
  `index.ts` loga a config no startup só com essa versão redigida.
  `.env.example` criado com placeholders (sem valores reais);
  `backend/data/` e `backend/secrets/` adicionados ao `.gitignore` da raiz.
  Decisão registrada em `docs/backend/ARQUITETURA.md`: persistência via
  SQLite (`better-sqlite3`) e verificação de token via `firebase-admin`
  (justificativas lá). Validado: `npm test` cobre config válida, ausente
  (banco/Firebase faltando) e inválida (`PORT` fora do intervalo), mais um
  teste que garante que `toPublicSummary()` não vaza segredo nenhum;
  testado manualmente também via `node dist/index.js` sem env (falha limpa)
  e com env válida (sobe e loga config redigida). Scanner de segredos:
  varredura manual do diff por padrões conhecidos (chaves privadas, tokens
  AWS/GCP/Slack/Stripe) — nada encontrado; nenhum arquivo `.env` real
  rastreado.
- **#30 — Verificação de tokens de autenticação** (2026-09-12, branch
  `feat/backend-auth-tokens`): `src/auth/verifier.ts` define a interface
  `TokenVerifier`/`AuthIdentity`; `src/auth/firebaseTokenVerifier.ts`
  implementa via `firebase-admin` (`verifyIdToken`), carregando a service
  account de `FIREBASE_SERVICE_ACCOUNT_JSON`/`_PATH` (#29); `src/auth/plugin.ts`
  é um hook `onRequest` global que exige `Authorization: Bearer <token>` em
  toda rota exceto as listadas em `publicPaths` (hoje só `/health`) — token
  ausente, malformado, inválido ou expirado sempre responde `401
  {"error":{"code":"unauthorized",...}}` usando o envelope de erro do
  contrato (#27); em sucesso, `request.auth = { uid, email }` fica
  disponível pros handlers. Identidade vem **só** do token verificado, nunca
  de campo enviado pelo cliente. `src/testing/fakeTokenVerifier.ts` (só
  testes) permite testar o plugin e o server sem Firebase real. Efeito
  colateral notado nos testes: como a autenticação roda antes do roteamento,
  uma rota inexistente sem token responde `401` em vez de `404` (só vira
  `404` com token válido) — decisão deliberada, evita expor a um cliente não
  autenticado quais rotas existem. Validado: `npm test` 15/15 (6 novos
  testes do plugin + os 2 do server ajustados), `npm run build` ok, e
  smoke test manual local (`/health` público 200, rota qualquer sem token
  401, com token válido segue pro roteamento normal).
- **#31 — Schema e migrações de grupos e membros** (2026-09-12, branch
  `feat/backend-groups-schema`): `backend/migrations/0001_groups_and_members.sql`
  cria `groups` (id, name, owner_id, created_at) e `group_members` (chave
  composta `group_id`+`user_id`, `role` restrito a
  `owner`/`admin`/`member`, `ON DELETE CASCADE` do grupo pros membros),
  com índices em `owner_id` e `user_id`. `src/db/migrate.ts` é um runner
  simples (tabela `_migrations`, migrações são arquivos `.sql` com blocos
  `-- up`/`-- down`) — idempotente, e `migrateDownOne` desfaz a última
  aplicada. `src/db/connection.ts` abre o SQLite com
  `foreign_keys = ON` (senão o cascade não funciona). Novo comando `npm run
  migrate` (`src/db/migrateCli.ts`) usa a config de #29. Presença efêmera
  **não** é persistida aqui (fica pra #36), como pede o escopo da issue.
  Validado: `npm test` 21/21 (6 novos: sobe em banco vazio, idempotência em
  banco populado, desce e remove as tabelas, chave composta rejeita membro
  duplicado, cascade remove membros ao excluir o grupo, role fora do enum é
  rejeitada); e `npm run migrate` rodado de verdade contra um arquivo
  `.db` real — vazio (cria as tabelas) e depois populado com uma
  linha real (rodar de novo não duplica nem apaga o dado).
- **#35, #32, #33, #34 — API de grupos, autorização por papel e convites**
  (2026-09-12, branch `feat/backend-groups-api`, um PR só para as 4 issues
  por formarem uma etapa coerente): `src/authz/policy.ts` centraliza a
  matriz de permissões (owner/admin/member — ver comentário no arquivo) e é
  a única fonte de verdade de autorização, usada por toda rota; grupo
  inexistente e "não sou membro" respondem os dois `404` (nunca revelam
  a um não-membro que o grupo existe). `src/groups/repository.ts`
  implementa toda a persistência (criar/listar/detalhar/renomear/excluir
  grupo, saír, criar/listar/revogar/aceitar convite) em cima do schema de
  #31 + nova migração `0002_invites.sql`. `src/routes/groups.ts` expõe
  exatamente os endpoints do contrato (#27): `POST/GET /v1/groups`,
  `GET/PATCH/DELETE /v1/groups/:id`, `POST /v1/groups/:id/leave`,
  `POST/GET /v1/groups/:id/invites`, `DELETE /v1/groups/:id/invites/:id`,
  `POST /v1/invites/:token/accept`. `server.ts` ganhou um
  `setErrorHandler` central que traduz os erros de domínio
  (`NotFoundError`→404, `ForbiddenError`→403, `ConflictError`→409,
  `ValidationError`→422) pro envelope de erro único — nenhum handler
  monta resposta de erro na mão. `index.ts` agora abre o banco e roda
  `migrateUp` automaticamente no boot (antes só existia `npm run
  migrate` manual; a partir daqui o servidor de fato usa o banco, então
  faz sentido migrar sozinho ao subir). Regras de negócio implementadas:
  dono não sai do grupo sem transferir/excluir (409); só dono exclui;
  só owner/admin cria ou revoga convite; aceitar convite é idempotente
  para quem já é membro e rejeita (409) quando expirado, revogado ou
  esgotado (`maxUses`). Validado: `npm test` 36/36 (14 testes novos de
  rotas cobrindo toda a matriz owner/admin/member/outsider + casos de
  convite, e 4 testes de policy isolados); `npm run build` ok; smoke test
  manual real via `curl` contra o processo (`/health` público 200,
  `/v1/groups` sem token 401, log confirma `migrationsApplied` no boot).
  Verificação de token do Firebase de verdade contra um convite real não
  foi possível sem projeto Firebase disponível — comportamento cobre
  pelos testes com verificador falso, igual nas issues anteriores.
- **#58 — Instalação reproduzível no Windows** (2026-09-12, branch
  `fix/backend-windows-install`): causa raiz encontrada e reproduzida —
  `better-sqlite3` tem um `binding.gyp`, e o npm por padrão roda
  `node-gyp rebuild` nele em toda instalação (`npm ci`/`npm install`)
  **mesmo já existindo um binário pré-compilado certo** em
  `node_modules/better-sqlite3/prebuilds/<plataforma>-<arch>.node` pra
  linux/darwin/win32 em x64/arm64. Isso exige Python + compilador C++ só
  pra recompilar algo que já estava pronto, e falhava (`node-gyp rebuild`
  → "Could not find any Python installation") em qualquer máquina Windows
  sem esse toolchain. Correção: `backend/.npmrc` com `ignore-scripts=true`
  (pula o rebuild — verificado que nenhuma outra dependência da árvore
  precisa de install/postinstall) + `engine-strict=true` (falha cedo e
  claro fora da faixa de Node suportada, em vez de instalar silenciosamente
  numa versão não testada). `backend/.nvmrc` fixa Node 22; `engines` em
  `package.json` corrigido de `>=20` (nunca funcionaria — o próprio
  `better-sqlite3@13` exige `>=22`) para `>=22 <25`. SQLite **não** foi
  removido/trocado (fora do escopo da issue). Validado do zero: `rm -rf
  node_modules dist`, `npm ci` (Node v24.14.1, npm 11.11.0, Windows 10
  Home 10.0.19045). Confirmado que `node_modules/better-sqlite3/build/`
  não é criado (ou seja, nenhuma compilação rodou — usa só o prebuild),
  `npm run build` ok, `npm test` 36/36. Esta máquina tem Python instalado,
  então não reproduz sozinha o ambiente exato do Ruthraas — a evidência de
  que a correção funciona é a ausência do diretório `build/` (prova que o
  `node-gyp rebuild` nem chegou a rodar), não a falta de Python aqui.

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

Contrato HTTP em [`docs/backend/openapi.yaml`](backend/openapi.yaml) (#27). **Grupos e convites já estão implementados e testados** (presença/heartbeat ainda não — isso é #36) — dá pra integrar de verdade contra `/v1/groups` e `/v1/invites`, não é mais só o papel. Pontos que o frontend precisa saber desde já:

- **Base URL/versionamento**: todas as rotas HTTP terão prefixo `/v1/...`; mudança incompatível vira `/v2/...`, `/v1` nunca muda de forma retroativa.
- **Autenticação**: `Authorization: Bearer <idToken do Firebase Auth>` em toda requisição — o mesmo token que `src/services/firebase.ts` já obtém no login. Verificação real do token (#30) está implementada; sem header ou token invalido/expirado sempre dá `401`.
- **Erros**: envelope único `{ "error": { "code", "message", "correlationId" } }` — `code` é estável p/ lógica do cliente, `message` é pt-BR seguro pra exibir direto. Ver schema `Error` no OpenAPI. Códigos em uso: `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409), `validation_error` (422).
- **Importante para UX**: grupo inexistente e "usuário autenticado mas não é membro" respondem **os dois `404`**, nunca `403` — de propósito, pra não revelar a quem não participa que o grupo existe. Não trate 404 nessas rotas como "erro de rede", é esperado pra quem não é membro.
- **Grupos e convites — implementados** (`src/routes/groups.ts`, testados): `POST /v1/groups`, `GET /v1/groups`, `GET|PATCH|DELETE /v1/groups/{id}`, `POST /v1/groups/{id}/leave` (dono recebe `409` se tentar saír sem transferir/excluir antes), `POST|GET /v1/groups/{id}/invites`, `DELETE /v1/groups/{id}/invites/{inviteId}`, `POST /v1/invites/{token}/accept` (idempotente pra quem já é membro; `409` se expirado/revogado/esgotado). `PATCH`/criar-revogar-convite exigem papel `owner` ou `admin`; excluir grupo exige `owner`.
- **Presença/TURN — ainda não implementados** (payloads já definidos em `openapi.yaml`, aguardando #36/#40/#41): `POST /v1/groups/{id}/presence/heartbeat`, `GET /v1/groups/{id}/presence`, `POST /v1/turn-credentials`.
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
