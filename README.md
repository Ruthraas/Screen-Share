# ScreenShare

**Compartilhamento de tela nativo, leve e privado para grupos pequenos no Windows.**

[![Release](https://img.shields.io/github/v/release/Ruthraas/Screen-Share?label=release&color=2ea44f)](https://github.com/Ruthraas/Screen-Share/releases/latest)
[![Backend CI](https://github.com/Ruthraas/Screen-Share/actions/workflows/backend-ci.yml/badge.svg?branch=main)](https://github.com/Ruthraas/Screen-Share/actions/workflows/backend-ci.yml)
[![Frontend CI](https://github.com/Ruthraas/Screen-Share/actions/workflows/frontend-ci.yml/badge.svg?branch=main)](https://github.com/Ruthraas/Screen-Share/actions/workflows/frontend-ci.yml)
[![License: GPL v3](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6)](https://github.com/Ruthraas/Screen-Share/releases/latest)

ScreenShare é um aplicativo desktop para Windows feito pra compartilhar a tela
com um grupo pequeno de pessoas — família, amigos, um time — sem depender de
Discord, Zoom ou qualquer plataforma de terceiros. Captura nativa (sem
navegador, sem `getDisplayMedia`), conexão direta entre participantes via
WebRTC, e nada além disso: sem chat de voz, sem microfone, sem coleta de dados
que o produto não precisa.

## Funcionalidades

- **Contas e grupos** — cadastro por e-mail/senha ou OAuth (Google, GitHub,
  Discord), grupos privados por convite com papéis (dono/admin/membro).
- **Captura de tela nativa** — Windows Graphics Capture direto via Rust, com
  seletor de monitor/janela (miniaturas reais), qualidade (auto/720p/1080p) e
  fps configuráveis.
- **Áudio do sistema, opcional** — o que está tocando na tela (jogo, vídeo,
  música) pode ir junto, sempre por escolha de quem compartilha. Nunca
  microfone.
- **Transmissão ao vivo entre participantes** — WebRTC ponto a ponto com
  fallback TURN automático, sala com o vídeo em destaque e a lista de quem
  está presente/transmitindo ao lado, controles de volume e tela cheia.
- **Atualização automática** — o app verifica e instala novas versões
  sozinho, artefatos assinados e verificados antes de aplicar.

## Instalar

Baixe o instalador mais recente na página de
[**Releases**](https://github.com/Ruthraas/Screen-Share/releases/latest)
(`ScreenShare_<versão>_x64-setup.exe`). Exige Windows 10/11 x64 com WebView2
(já vem instalado por padrão em instalações atualizadas).

## Arquitetura

```text
React + TypeScript + Tauri 2 (Rust)  →  ScreenShare.exe (Windows x64)
              │
              ├─ captura nativa (Windows Graphics Capture) + áudio (WASAPI)
              └─ WebRTC direto entre participantes, sinalização via backend

Backend Node.js + Fastify (pasta backend/, hospedado à parte)
   auth própria · grupos/convites · sinalização WebSocket · credenciais TURN
   banco: Turso (libSQL)
```

Frontend/desktop e backend têm escopos e donos separados — detalhe completo
em [`CONTRIBUTING.md`](CONTRIBUTING.md), arquitetura de cada lado em
[`docs/FRONTEND.md`](docs/FRONTEND.md) e
[`docs/backend/ARQUITETURA.md`](docs/backend/ARQUITETURA.md).

## Desenvolvimento

```powershell
npm ci
npm run tauri:dev
```

Precisa do backend rodando à parte (`backend/`, ver seu próprio
`README`/`.env.example`) — sem ele, login e grupos não funcionam. Passo a
passo completo de build, testes e empacotamento em
[`docs/FRONTEND.md`](docs/FRONTEND.md).

## Contribuindo

Issues e pull requests são bem-vindos. Ninguém — nem os mantenedores —
commita direto na `main`: toda mudança entra por pull request, revisada e só
mergeada com os testes automatizados passando (veja os badges de CI acima).
Antes de abrir um PR, leia o [`CONTRIBUTING.md`](CONTRIBUTING.md) — ele
explica o fluxo, os limites entre frontend e backend, e os critérios pra um
PR ser aceito.

## Créditos

Projeto mantido por **[@Ruthraas](https://github.com/Ruthraas)** (frontend,
cliente desktop, captura nativa, UI) e
**[@ProgVictorPe](https://github.com/ProgVictorPe)** (backend, autenticação,
sinalização, infraestrutura e hospedagem) — o ScreenShare não teria backend
nem estaria no ar sem o trabalho dele.

## Licença

[GPL-3.0](LICENSE) — livre pra usar, estudar, modificar e redistribuir,
contanto que qualquer trabalho derivado continue sob a mesma licença.
