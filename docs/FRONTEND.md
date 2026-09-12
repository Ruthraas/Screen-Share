# Frontend/Desktop — build, testes e empacotamento Windows

Documento vivo (issue #5). Objetivo: qualquer pessoa ou IA consegue ler só
este arquivo e saber como builda, testa e empacota o cliente sem depender de
contexto de conversa anterior. Ver [`docs/BACKEND.md`](BACKEND.md) para o
contrato HTTP que este cliente consome.

## 1. Pré-requisitos

- **Node.js**: versão fixada em [`.nvmrc`](../.nvmrc) (22). `npm ci` usa
  `package-lock.json` — não usar `npm install` para builds reproduzíveis.
- **Rust**: `stable`, mínimo `1.77.2` (`src-tauri/Cargo.toml`,
  `rust-version`). Sem toolchain C++ extra — todas as dependências nativas
  (`keyring`, `tauri-plugin-deep-link`, `tauri-plugin-single-instance`) usam
  crates Windows puras (`windows-sys`), não `node-gyp` nem MSVC Build Tools
  além do que o próprio Rust/`rustup` já traz.
- **WebView2**: já vem instalado por padrão no Windows 10/11 atualizado; é o
  runtime que o Tauri usa para renderizar a UI. Não precisa instalar nada à
  parte para desenvolver — só relevante se o instalador NSIS precisar
  redistribuí-lo para máquinas muito desatualizadas (não configurado hoje).
- **NSIS**: a própria `tauri-bundler` baixa o toolchain NSIS automaticamente
  na primeira vez que `tauri build` roda (fica em cache local); não precisa
  instalar `makensis` manualmente.
- **Playwright (Chromium)**: `npx playwright install chromium` antes de
  rodar o smoke test (`npm run test:e2e`) pela primeira vez numa máquina.

## 2. Comandos

| Comando | O que faz |
| --- | --- |
| `npm ci` | Instala dependências a partir do lockfile (ambiente limpo). |
| `npm run test:frontend` | Testes unitários (`node --test`), sem browser nem servidor. |
| `npm run build` | `tsc -b` (typecheck) + `vite build` → `dist/`. |
| `npm run dev` | Dev server em `http://127.0.0.1:5173`. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Testes Rust da ponte desktop (OAuth via deep link, armazenamento seguro). |
| `npm run test:e2e` | Smoke test end-to-end (ver §3) — sobe um dev server próprio na porta 5180 se nenhum já estiver rodando lá. |
| `npm run tauri:build` | Empacota Windows: builda o frontend, compila o Rust em release e gera o instalador NSIS. |

## 3. Smoke test (`scripts/check-ui.mjs`)

Roda com Playwright contra o app real (`chromium`), mas **sem backend nem
conta real** — intercepta `POST /v1/auth/login`, `/refresh` e `/logout` com
respostas fixas (issue #30: mesmo formato de resposta do backend,
`{ accessToken, refreshToken }`, com um access token no formato certo pra
`authClient.ts` conseguir decodificar `uid`/`email`). `VITE_API_URL` do dev
server que o script sobe é `http://smoke-test.invalid` — um host que nunca
deveria ser alcançado de verdade; se algum request escapar da interceptação,
ele falha por DNS, não vaza nada.

Cobre: login por e-mail/senha → estado vazio (sem grupos) → criar grupo →
tela de compartilhamento → grupos → trocar tema → editar perfil → reload
(sessão restaurada via refresh token) → paleta de comandos → responsividade
em 3 resoluções → logout → guarda de rota (`#/profile` sem sessão volta pro
login). Também valida a geometria/hover da `PixelWave` (issue #3/#4).

Capturas de tela vão para `artifacts/ui/` (gitignored) — em caso de falha,
uma captura extra `failure.png` mostra o estado exato em que travou. No CI
(`.github/workflows/frontend-ci.yml`) essas capturas são publicadas como
artifact do workflow (`smoke-test-screenshots`) para diagnóstico, mesmo
quando o job falha.

Nenhum passo do smoke test ou do CI imprime conteúdo de `.env`/`.env.local`
nem token real — a única "credencial" usada é a fixture local acima.

## 4. CI (`.github/workflows/frontend-ci.yml`)

Só Windows por agora (mesmo critério do `backend-ci.yml`: é o ambiente de
desenvolvimento real validado até aqui). Roda em push para `main` e em PRs
que tocam `src/`, `src-tauri/`, `scripts/`, `tests/frontend/` ou os arquivos
de configuração do build. Ordem: instala deps → testes unitários → build →
testes Rust → smoke test → `tauri build`.

## 5. Caminhos de artefatos

Depois de `npm run tauri:build` (local ou no CI):

- `src-tauri/target/release/ScreenShare.exe` — executável standalone.
- `src-tauri/target/release/bundle/nsis/ScreenShare_<versão>_x64-setup.exe` — instalador NSIS x64.

Ambos os caminhos deixam de existir depois de uma limpeza local
(`cargo clean`, remover `src-tauri/target/`) e são recriados do zero pelo
build — não são versionados no Git. No CI, o workflow publica os dois como
artifact `screenshare-windows` do run (retenção de 14 dias).
