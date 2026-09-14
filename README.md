# ScreenShare — documentação e continuidade

Última revisão: **14 de setembro de 2026**. Versão do aplicativo: **1.0.0**.

Este README é o ponto de entrada para uma pessoa ou outra IA continuar o projeto sem depender do histórico da conversa. Descreve o código existente, decisões aprovadas, limites conhecidos e evolução pretendida. Leia-o antes de alterar o projeto; confirme os detalhes nos arquivos, pois ele representa o estado desta revisão.

## 1. O que é o produto

ScreenShare é um aplicativo desktop Windows para compartilhar telas em grupos privados. Cada pessoa se autentica (e-mail/senha ou OAuth via Google/GitHub/Discord), cria ou entra em grupos por convite, e compartilha a própria tela — captura nativa, opcionalmente com o áudio do sistema junto — pros outros membros do grupo.

**Não é chat de voz. Sem microfone, sem controles de chamada.** Áudio do sistema (o que está tocando na tela compartilhada — jogo, vídeo, música) é opcional e controlado por quem compartilha; voz/microfone continuam fora de escopo.

Arquitetura:

```text
React + TypeScript (interface)
            ↓
Tauri 2 (integração desktop)
            ↓
Rust (camada nativa: captura de tela, áudio, OAuth desktop)
            ↓
Windows x64 → ScreenShare.exe + instalador NSIS

Backend Node/Fastify separado (repositório mesmo, pasta backend/, dono: @ProgVictorPe)
            ↓
Auth própria, grupos/convites, sinalização WebSocket, credenciais TURN
```

Frontend e backend têm donos e escopos separados (ver `CONTRIBUTING.md`): frontend é `@Ruthraas` (React/TypeScript/Tauri/Rust do lado cliente), backend é `@ProgVictorPe` (Node/Fastify, sinalização, TURN, infraestrutura). Uma alteração de frontend não implementa serviços remotos; uma alteração de backend não mexe em componentes, CSS ou tokens visuais.

## 2. Estado real hoje

| Área | Implementado | Limite atual |
| --- | --- | --- |
| Autenticação | Backend próprio (`src/services/authClient.ts`): cadastro/login por e-mail+senha, OAuth desktop via deep link (Google/GitHub/Discord), refresh automático de sessão | Nome/avatar do provedor OAuth ainda não são expostos pelo backend (issue #70, aberta) — nome cai pro digitado no cadastro ou local-part do e-mail |
| Grupos e convites | `src/services/groupsApi.ts` contra `/v1/groups`/`/v1/invites` reais: criar, listar, entrar por convite, sair, excluir (dono) | Sem perfil público de outros membros (rótulo curto derivado do id) |
| Captura de tela | 100% nativa via Windows Graphics Capture (`src-tauri/src/capture.rs`), sem `getDisplayMedia`/navegador. Seletor com grid de miniaturas reais (estilo Discord), qualidade (auto/720p/1080p) e fps (15/30/60) configuráveis | Só visualização local — enviar pra outros participantes ainda não existe (depende da #71) |
| Áudio do sistema | Loopback via `wasapi` (`src-tauri/src/audio.rs`), opcional, nunca microfone | Independente do vídeo; falha de áudio nunca derruba a captura de tela |
| Compartilhar com outros | — | **Não implementado.** Falta o cliente WebRTC (issue #71): `RTCPeerConnection`, anexar o `MediaStream` local, receber stream remoto, indicador de ping/qualidade |
| Navegação | Rotas por hash, sidebar e header compartilhados pós-login, paleta de comandos (Ctrl+K) funcional | — |
| Configurações | Tema claro/escuro (local, `localStorage`) | Demais preferências ainda não persistem |
| Atualizações do app | — | **Não implementado.** Depende do updater/release automatizado do backend (issue #49) antes da UI de update (issue #48) |
| Logging de diagnóstico | `src/services/logger.ts` (auth/desktop/captura), redação automática de campos sensíveis | Só `console.*`, sem persistência em arquivo (deliberado — é diagnóstico, não telemetria) |

## 3. Stack e arquivos

Dependências principais (`package.json`, versões exatas em `package-lock.json`):

- React `^19.1.1` + React DOM; TypeScript `^5.9.2`.
- Vite `^7.1.5`, plugin React `^5.0.2`.
- `@tabler/icons-react` `^3.46.0` — biblioteca de ícones aprovada, outline/stroke.
- `@tauri-apps/api` `^2.11.1`, `@tauri-apps/cli` `^2.11.4`.
- Playwright `^1.63.0` — usado só pelo smoke test (`npm run test:e2e`), não é dependência de produção.
- Rust edition 2021; mínimo declarado no Cargo: `1.77.2`.

Sem Firebase (removido junto da migração pro backend próprio), sem Tailwind/MUI/Ant/shadcn ou outro framework de design, sem framework de estado (Redux/Zustand) — estado local via hooks/Context (`AccountProvider`) e um punhado de módulos "subscribable state" (`authClient.ts`, `sharingState.ts`) pro que precisa ser lido fora de React (ex. `AppShell` reagindo a uma captura ativa).

```text
Screen-Share/
├── README.md
├── CONTRIBUTING.md
├── backend/                        # Node/Fastify, dono @ProgVictorPe — não documentado aqui
├── docs/
│   ├── BACKEND.md, backend/*       # Contrato/arquitetura do backend (openapi.yaml é a fonte da verdade)
│   ├── FRONTEND.md                 # Padrões de teste e decisões do lado cliente
│   └── WEBRTC_TURN_PLAN.md         # Plano de arquitetura pra issue #71 (ainda não implementado)
├── src/
│   ├── main.tsx                    # App, rotas por hash, splash e modais globais
│   ├── styles.css                  # Tokens, temas, layouts e estilos compartilhados
│   ├── data/types.ts               # Contratos locais (User, Group, Route...)
│   ├── services/
│   │   ├── authClient.ts           # Cliente HTTP de auth + OAuth desktop + sessão
│   │   ├── groupsApi.ts            # Cliente HTTP de /v1/groups e /v1/invites
│   │   ├── captureClient.ts        # Ponte fina pros comandos/eventos Tauri de captura
│   │   ├── sharingState.ts         # Sinal global "captura ativa" (sem prop drilling)
│   │   ├── logger.ts               # Log de diagnóstico com redação automática
│   │   └── sessionRouting.ts / localData.ts
│   ├── components/
│   │   ├── ui/                     # Button, Input/TextArea, Avatar, Icons, Modal, Toggle
│   │   ├── layout/                 # AppShell, SplashScreen, CommandPalette, AccountProvider
│   │   ├── groups/                 # CreateGroupModal, JoinGroupModal
│   │   └── sharing/                # ScreenViewer, CaptureSourcePicker, useLocalCapture
│   └── pages/                      # Login, Groups, EmptyState, Share, MultiScreen,
│                                    # Settings, Profile
├── src-tauri/
│   ├── src/main.rs                 # Entrada do executável Windows
│   ├── src/lib.rs                  # Registro dos comandos Tauri
│   ├── src/desktop_auth.rs         # OAuth desktop via deep link (screenshare://)
│   ├── src/secure_store.rs         # Armazenamento seguro de tokens (Windows Credential Manager)
│   ├── src/capture.rs              # Captura de tela nativa (Windows Graphics Capture)
│   ├── src/audio.rs                # Áudio do sistema (loopback, wasapi)
│   ├── capabilities/default.json   # Permissões Tauri v2 (core:event p/ eventos de captura)
│   ├── Cargo.toml / Cargo.lock
│   ├── tauri.conf.json
│   └── target/                     # Saída de build, ignorada pelo Git
├── tests/frontend/*.test.ts        # node --test, sem transformar JSX (ver docs/FRONTEND.md)
├── test-harness/                   # Páginas isoladas pra testar componente sem rota própria
├── scripts/check-ui.mjs            # Smoke test Playwright (npm run test:e2e)
├── .env.example                    # VITE_API_URL, sem segredos
├── package.json / package-lock.json
├── tsconfig.json / tsconfig.app.json
├── vite.config.ts
└── index.html
```

Não existe mais pasta `assets/` com PNGs de referência (mencionada em revisões antigas deste README) nem `pages/Home.tsx`/`components/groups/GroupCard.tsx` (código antigo, já removido). As 7 rotas de `data/types.ts` (`Route`) mapeiam todas pra um componente real em `main.tsx` — nenhuma rota morta.

O TypeScript usa `strict`, `noUnusedLocals`, `noUnusedParameters`, resolução `bundler`, alvo ES2022 e `noEmit`. O build é `tsc -b && vite build`.

## 4. Executar e gerar o aplicativo

### Preparação

No Windows: Node/npm compatíveis com o projeto, Rust/Cargo com toolchain MSVC x64, Visual Studio Build Tools (C++/Windows SDK) e WebView2. Pra rodar contra o backend real, ele precisa estar de pé (`backend/`, `npm install` + variáveis de `backend/.env.example`) — sem backend rodando, login/grupos não funcionam (não há mais modo mock).

Na raiz:

```powershell
npm ci
```

Usar os lockfiles existentes. No PowerShell, se a política de execução impedir `npm.ps1`, usar `npm.cmd`.

Criar `.env.local` a partir de `.env.example`:

```dotenv
VITE_API_URL=http://127.0.0.1:8787
```

Reiniciar o Vite/reconstruir após alterar variáveis — o Vite as incorpora ao frontend no build.

### Desenvolvimento

```powershell
# Apenas frontend no navegador (auth/grupos exigem o backend rodando à parte)
npm run dev

# Aplicativo desktop; inicia o Vite via beforeDevCommand
npm run tauri:dev
```

Vite usa `http://127.0.0.1:5173`, `strictPort: true`, e ignora `src-tauri` no watcher. `tauri:dev` recompila o Rust automaticamente a cada alteração em `src-tauri/`.

### Produção

```powershell
# Verificação TypeScript e build frontend
npm run build

# Executável e instalador Windows (ambiente Windows x64)
npm run tauri:build
```

Saídas geradas:

```text
src-tauri/target/release/ScreenShare.exe
src-tauri/target/release/bundle/nsis/ScreenShare_1.0.0_x64-setup.exe
```

Os artefatos são ignorados pelo Git; em outro computador, gerar novamente.

### Configuração desktop atual

- Produto: `ScreenShare`; identifier: `com.screenshare.desktop`; versão `1.0.0`.
- Binário Cargo: `ScreenShare`; biblioteca: `screenshare_lib`.
- Janela: 1280×720, mínimo 800×460, centralizada, redimensionável, decorações nativas do Windows.
- Bundle: NSIS, ícone `src-tauri/icons/icon.ico`.
- `frontendDist`: `../dist`.
- `security.csp` está `null`.
- Deep link registrado: `screenshare://` (callback de OAuth desktop).
- Permissões (`src-tauri/capabilities/default.json`): comandos `#[tauri::command]` próprios (auth, captura, áudio, secure_store) são liberados por padrão; só a API `core:event` do lado do frontend (usada pelos eventos de captura) precisa de permissão explícita.
- Sem assinatura digital nem auto-update ainda (issues #48/#49, backend).

## 5. Autenticação e backend

Não há mais Firebase nem modo mock: auth, grupos, convites e sinalização são o backend próprio (`backend/`, Node/Fastify, dono `@ProgVictorPe`). Contrato exato em `docs/backend/openapi.yaml`; arquitetura e decisões em `docs/backend/ARQUITETURA.md` e `docs/BACKEND.md`.

`src/services/authClient.ts` implementa:

- `registerWithEmail`/`loginWithEmail` contra `/v1/auth/*`.
- Refresh automático de sessão (token de acesso expirado → refresh → repete a chamada original, uma única vez).
- OAuth desktop: `loginWithOAuth(provider)` abre o navegador padrão do sistema, o backend redireciona de volta via deep link `screenshare://...#access_token=...&refresh_token=...`, `desktop_auth.rs` (Rust) captura o argv do relançamento do app (via `tauri-plugin-single-instance`) e entrega pro frontend. Timeout de 180s e `cancelOAuthLogin()` expostos na UI.
- Tokens ficam no Windows Credential Manager (`secure_store.rs`), nunca em `localStorage`.

`src/services/groupsApi.ts` cobre `/v1/groups` e `/v1/invites` (listar, criar, detalhar, atualizar, sair, excluir, convidar, aceitar convite) com o mesmo padrão de erro (`ApiError` com `code`/`status`/`correlationId`) e retry de refresh do `authClient`.

## 6. Captura de tela e áudio (issue #8/#18/#72 — concluídas)

Captura 100% nativa via Rust, decisão explícita do produto: **nunca `getDisplayMedia`/API de navegador**, só o app empacotado.

- `src-tauri/src/capture.rs`: Windows Graphics Capture (crate `windows-capture`) enumera monitores/janelas (`list_capture_sources`, filtrando janelas "cloaked" pelo DWM que nunca conseguem ser capturadas), inicia/para uma sessão (`start_capture`/`stop_capture`) e gera miniaturas (`capture_thumbnail`, uma sessão própria que para no primeiro frame). Cada frame é redimensionado conforme a qualidade escolhida, tem o canal alfa descartado (**JPEG não suporta RGBA**, só RGB) e é codificado em JPEG, emitido pro frontend via evento Tauri (`capture-frame`). O fps é controlado no próprio WGC via `MinimumUpdateIntervalSettings`.
- `src/components/sharing/useLocalCapture.ts`: escuta os eventos, desenha cada frame num `<canvas>` oculto e usa `canvas.captureStream(fps)` — o `MediaStream` resultante é o que `ScreenViewer` consome, sem contrato especial.
- `src/components/sharing/CaptureSourcePicker.tsx`: seletor com abas (janelas/tela inteira), grid de miniaturas reais (uma por fonte, busca independente), qualidade e fps.
- `src-tauri/src/audio.rs`: áudio do sistema (loopback, `wasapi`), opcional, nunca microfone — decisão de produto de 2026-09-13, documentada em `CONTRIBUTING.md`.
- Toda chamada que toca WinRT/COM roda numa thread nova (`run_on_fresh_thread`) — o WebView2 do Tauri já inicializa COM em modo STA nas threads de comando, e a `windows-capture` precisa de MTA.

**O que falta**: enviar o `MediaStream` local pra outros participantes (issue #71 — `RTCPeerConnection` do cliente, ver §7).

## 7. Próximo passo: WebRTC entre participantes (issue #71, em aberto)

Hoje cada pessoa só vê a própria tela localmente. Falta o cliente WebRTC: conectar no `/ws` de sinalização do backend (protocolo versionado, já implementado e testado no backend), abrir um `RTCPeerConnection` por participante, anexar as tracks do `MediaStream` local (vídeo sempre, áudio do sistema quando ligado), receber o stream remoto e entregar pro `ScreenViewer` já existente, usando credenciais TURN reais (`POST /v1/turn-credentials`) como ICE servers. Indicador de qualidade/ping via `RTCPeerConnection.getStats()`.

Depende de infraestrutura TURN real do backend (issues #40/#41, em aberto com `@ProgVictorPe`) pra validação de ponta a ponta fora de rede local. Plano de arquitetura detalhado em `docs/WEBRTC_TURN_PLAN.md`.

## 8. Testes

- `npm run test:frontend` — `node --test` puro (sem jsdom/testing-library), só lógica extraída em `.ts` (não importa `.tsx` — `--experimental-strip-types` remove anotação de tipo, não transforma JSX).
- `npm run test:e2e` (`scripts/check-ui.mjs`) — smoke test Playwright: sobe o Vite, mocka `/v1/*` via `page.route()` quando o teste não precisa do backend real, cobre login→grupos→captura→paleta de comandos→troca de tema→logging sem vazar segredo.
- `test-harness/` — páginas montando um componente real fora de qualquer rota (ex. `screen-viewer.html`/`.tsx`), nunca listadas em `vite.config.ts` (confirmar rodando `npm run build` e checando que não aparecem em `dist/`), usadas só pelo `check-ui.mjs`.
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml --lib` — testes unitários de lógica pura (parsing, validação, transformação de buffer); nada que dependa de hardware/captura real (isso é sempre validação manual).

Ver `docs/FRONTEND.md` pro padrão de `test-harness/` e decisões de cobertura.

## 9. Regras que já causaram retrabalho — não repetir

- **Nunca `getDisplayMedia`/API de navegador pra captura.** Decisão explícita do produto (2026-09-13): só captura nativa via Rust.
- **JPEG não aceita canal alfa.** Todo buffer de captura de tela vem RGBA — descartar o alfa antes de `JpegEncoder::encode`, senão falha silenciosamente (sem isso, foi a causa de um bug real de "tela cinza" nesta mesma revisão).
- **Toda chamada WinRT/COM roda em thread nova** (`run_on_fresh_thread` em `capture.rs`) — WebView2 já inicializa COM em modo STA nas threads de comando Tauri, `windows-capture` precisa de MTA.
- **API `core:event` do Tauri v2 exige permissão explícita** em `src-tauri/capabilities/*.json` — comandos `#[tauri::command]` próprios não precisam, só APIs "core" do lado do frontend (ex. `listen()`).
- **Sem microfone, sem chat de voz.** Áudio do sistema (loopback) é o único áudio permitido, sempre opcional.
- **Frontend não implementa serviços remotos** (WebRTC, TURN, Firestore) fora do escopo de uma issue de frontend; backend não mexe em componente, CSS ou token visual — ver `CONTRIBUTING.md`.
- **Nunca commitar segredo** (`.env`, tokens, credenciais TURN) — `.env`/`.env.local` são ignorados pelo Git; `VITE_*` nunca carrega segredo (é embutido no bundle, público).

## 10. Convenções de sessão (pra quem continuar isto)

- Uma IA deve ler este README e `CONTRIBUTING.md` inteiros antes de alterar código, e ler a issue completa antes de começar.
- Diferenciar sempre comportamento local, mock (hoje só existe em teste, nunca em produção) e funcionalidade integrada de verdade.
- Ao terminar uma issue: validar de verdade (build, testes, e quando aplicável teste manual — captura de tela real não dá pra automatizar), comentar o resultado na issue no GitHub com o que foi feito e como foi validado, e fechá-la.
- Alterações de frontend nunca reatribuem ou fecham issues do backend sem o `@ProgVictorPe` — só comentar/abrir issue nova quando um gap do lado dele for encontrado.
