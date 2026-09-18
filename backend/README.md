# ScreenShare Backend

[![Backend CI](https://github.com/Ruthraas/Screen-Share/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/Ruthraas/Screen-Share/actions/workflows/backend-ci.yml)

Serviço remoto do ScreenShare — HTTP (Fastify) + WebSocket (a partir da
issue #37). Não roda dentro do processo Tauri; é implantado e executado
separadamente. Ver [`docs/backend/ARQUITETURA.md`](../docs/backend/ARQUITETURA.md)
para a decisão de stack e [`docs/backend/openapi.yaml`](../docs/backend/openapi.yaml)
para o contrato HTTP.

## Requisitos

- **Node.js 22.x ou 23.x** (`>=22 <25` — ver `engines` em `package.json` e
  `.nvmrc`); se usar `nvm`, `nvm use` já lê o `.nvmrc`.
- **Nenhuma dependência nativa.** O backend não tem mais nenhum pacote com
  `binding.gyp`/compilação nativa desde a migração de `better-sqlite3`
  (SQLite local) pra `@libsql/client`/Turso (issue #82) — não precisa de
  Python nem de compilador C++ em nenhuma plataforma. `backend/.npmrc`
  (`ignore-scripts=true`) continua ligado por segurança geral (evita rodar
  script `install`/`postinstall` de qualquer dependência por padrão), não
  mais pelo motivo original (verificado de novo em 2026-09-14,
  pós-migração: nenhum pacote na árvore depende de um desses scripts pra
  funcionar).

## Comandos

```powershell
cd backend
npm ci

# desenvolvimento (reinicia ao salvar)
npm run dev

# build de produção
npm run build
npm start

# testes
npm test
```

`npm ci` falha com mensagem clara (`engine-strict=true` no `.npmrc`) se a
versão do Node instalada estiver fora do intervalo suportado, em vez de
instalar silenciosamente numa versão não testada.

Por padrão o serviço escuta em `0.0.0.0:8787`. Ajuste com as variáveis de
ambiente `HOST` e `PORT`. O banco é configurado por `DATABASE_PATH`
(arquivo local ou `:memory:`, uso local/teste) ou por
`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (Turso remoto, produção — issue
#82) — pelo menos um dos dois é obrigatório, ver `.env.example`. No boot,
o servidor roda as migrações pendentes automaticamente
(`src/db/migrate.ts`) — não é preciso rodar `npm run migrate` à parte
para simplesmente subir o serviço.

## Endpoints disponíveis

- `GET /health` — público, `200 { "status": "ok" }` (liveness, nunca falha).
- `GET /ready` — público, `200 { "status": "ok", "checks": { "database": "ok" } }`
  ou `503` se o banco estiver inacessível (readiness).
- `/v1/auth/*` — registro/login por e-mail+senha, OAuth (Google/GitHub/
  Discord), refresh/logout (issue #30).
- `/v1/groups`, `/v1/invites` — grupos e convites completos (issues #35,
  #32, #33, #34). Exigem `Authorization: Bearer <token>`.
- `/v1/groups/:id/presence*` — presença com heartbeat (issue #36).
- `/v1/turn-credentials` — credenciais TURN de curta duração via
  Cloudflare Realtime (issues #40/#41).
- `/ws` — sinalização WebSocket (offer/answer/ICE) entre participantes do
  mesmo grupo (issues #37/#38/#42).

Contrato completo em [`docs/backend/openapi.yaml`](../docs/backend/openapi.yaml)
e no `docs/BACKEND.md` (seção "Contrato com o Frontend").

## Encerramento

O processo trata `SIGINT`/`SIGTERM`: fecha o Fastify (`app.close()`) antes
de sair, para não deixar conexões pendentes. `app.close()` em si é coberto
pelos testes automatizados (fecha sem pendências a cada teste). A entrega
de sinal ponta a ponta (`SIGINT`/`SIGTERM` → handler → `app.close()`) é
padrão em Node.js e funciona como esperado em Linux/produção; **no Windows,
o próprio Node não expõe esses sinais de forma confiável para o processo**
(o SO encerra o processo diretamente em vez de emitir o evento), então esse
caminho específico não pôde ser validado ponta a ponta neste ambiente de
desenvolvimento — só o comportamento de `app.close()` em si.
