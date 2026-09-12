# ScreenShare Backend

[![Backend CI](https://github.com/Ruthraas/Screen-Share/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/Ruthraas/Screen-Share/actions/workflows/backend-ci.yml)

Serviço remoto do ScreenShare — HTTP (Fastify) + WebSocket (a partir da
issue #37). Não roda dentro do processo Tauri; é implantado e executado
separadamente. Ver [`docs/backend/ARQUITETURA.md`](../docs/backend/ARQUITETURA.md)
para a decisão de stack e [`docs/backend/openapi.yaml`](../docs/backend/openapi.yaml)
para o contrato HTTP.

## Requisitos

- **Node.js 22.x ou 23.x** (`>=22 <25` — ver `engines` em `package.json` e
  `.nvmrc`). Node 24+ ainda não teve um binário pré-compilado do
  `better-sqlite3` validado neste projeto; se usar `nvm`, `nvm use` já lê o
  `.nvmrc`.
- **Nenhum Python nem compilador C++ é necessário.** `better-sqlite3` (a
  única dependência nativa) já vem com binários pré-compilados para
  linux/darwin/win32 (x64 e arm64) dentro do próprio pacote — o
  `backend/.npmrc` (`ignore-scripts=true`) impede o npm de tentar
  recompilar do zero, que é o comportamento padrão dele quando o pacote
  tem um `binding.gyp` (issue #58: isso quebrava a instalação limpa no
  Windows por falta de Python, mesmo com o binário certo já disponível).
  Se um dia trocar de plataforma/arquitetura pra uma que o
  `better-sqlite3` não pré-compila, a instalação vai falhar de novo — nesse
  caso remova `ignore-scripts` (ou rode `npm rebuild better-sqlite3` à
  parte) e garanta Python 3 + toolchain de build C++ nessa máquina.

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
ambiente `HOST` e `PORT`. No boot, o servidor abre `DATABASE_PATH` e roda
as migrações pendentes automaticamente (`src/db/migrate.ts`) — não é
preciso rodar `npm run migrate` à parte para simplesmente subir o serviço.

## Endpoints disponíveis

- `GET /health` — público, `200 { "status": "ok" }`.
- `/v1/groups`, `/v1/invites` — grupos e convites completos (issues #35,
  #32, #33, #34). Exigem `Authorization: Bearer <token>`.
- Presença (`/v1/groups/:id/presence*`) e credenciais TURN
  (`/v1/turn-credentials`) ainda não implementadas — ver `docs/BACKEND.md`.

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
