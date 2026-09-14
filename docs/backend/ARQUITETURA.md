# Arquitetura do backend — ScreenShare

Refere-se à issue [#27](https://github.com/Ruthraas/Screen-Share/issues/27).
Documento vivo: atualizar sempre que um módulo mudar de forma, não só na
criação.

## 1. Papel do backend

O backend é um **serviço remoto separado do cliente** (React/Vite + Tauri).
Ele não roda dentro do processo Tauri nem depende dele — é implantado à
parte e o cliente fala com ele só pela rede, pelos contratos definidos aqui.

Responsabilidades:
- Autenticar requisições (verificar token do provedor de auth do cliente).
- Persistir grupos, membros, papéis e convites.
- Reportar/derivar presença (quem está online, em qual grupo).
- Emitir credenciais TURN temporárias para travessia de NAT.
- Retransmitir sinalização WebRTC (offer/answer/ICE) entre participantes
  autorizados do mesmo grupo, sem transportar mídia.

Não é responsabilidade do backend: UI, lógica de `RTCPeerConnection` no
cliente, design system, build do Tauri.

## 2. Decisão de tecnologia (registrada conforme exigido pela issue #27)

**Escolha: Node.js + TypeScript, HTTP com Fastify, WebSocket com `ws`.**

Justificativa:
- O frontend já é TypeScript (`src/`, Vite); manter a mesma linguagem no
  backend reduz troca de contexto para uma equipe de 2 pessoas e reaproveita
  o mesmo tooling de lint/test/CI que o `CONTRIBUTING.md` já descreve
  (`npm ci`, `npm run build`).
- Fastify: validação de schema nativa (JSON Schema), baixo overhead,
  ecossistema maduro para plugins de auth/rate-limit — encaixa bem num
  contrato guiado por OpenAPI.
- `ws`: biblioteca mínima e amplamente auditada para WebSocket; a issue #37
  (serviço de sinalização) não precisa de um framework de tempo real maior,
  só salas por grupo e roteamento ponto a ponto.
- Alternativas consideradas e descartadas por ora: Rust/Axum (reaproveitaria
  conhecimento do `src-tauri`, mas dobraria a superfície de aprendizado sem
  necessidade — o backend não tem restrição de performance que justifique
  Rust hoje); Python/FastAPI (bom para contrato OpenAPI, mas introduz uma
  terceira linguagem no repo sem ganho claro).
- Esta decisão pode ser revisitada, mas qualquer troca de stack precisa
  registrar justificativa aqui antes de ser aplicada (regra da issue #27).

**Adendo (issue #29): validação de configuração com `zod`, persistência com
SQLite via `better-sqlite3`, autenticação com `firebase-admin`.**

- `zod`: schema de ambiente único, mensagens de erro claras por campo —
  exatamente o que a issue #29 pede ("inicialização falha com mensagem
  clara"), sem escrever um validador manual.
- SQLite (`better-sqlite3`): a escala do produto (grupos privados de amigos,
  não um serviço multi-tenant de grande porte) não justifica operar um
  Postgres/MySQL separado. SQLite é um arquivo, API síncrona (sem
  callback/pool para gerenciar), migrações reversíveis simples de escrever à
  mão (issue #31), e zero custo/infra adicional para os dois mantenedores.
  Reavaliar se o produto crescer para múltiplos processos/instâncias
  concorrentes gravando no mesmo banco. **Custo conhecido (issue #58):**
  `better-sqlite3` é um addon nativo; a instalação depende de um binário
  pré-compilado pra plataforma/arquitetura (linux/darwin/win32 × x64/arm64,
  cobertos hoje) — ver `backend/README.md` e `backend/.npmrc` pro porquê
  disso quase quebrou a instalação no Windows.
- ~~`firebase-admin`~~: decisão revertida em 2026-09-12 — ver adendo da
  issue #30 abaixo. O backend não depende mais de Firebase pra autenticação.

**Adendo (issue #30, 2026-09-12): autenticação própria substitui o Firebase
Auth — decisão de produto do Ruthraas, não técnica.** Senha com `scrypt`
(built-in do `node:crypto`, sem dependência nova — issue #58 já mostrou o
custo de instalação de todo pacote nativo); sessão via token HMAC próprio
(`node:crypto` `createHmac`, sem biblioteca de JWT); refresh token opaco
hasheado no banco, revogável. OAuth 2.0 (Google, GitHub, Discord) via
`fetch` nativo do Node 22 (sem SDK de terceiro por provedor) — endpoints
exatos de cada provedor documentados em `src/auth/oauthProviders.ts` e
verificados nas docs oficiais em 2026-09-12. Detalhe completo na seção 5.

**Adendo (issue #40/#41, 2026-09-14): TURN via Cloudflare Realtime (serviço
gerenciado) em vez de coturn autogerenciado.** O plano original (issue #27)
previa operar um `coturn` próprio, com credenciais de curta duração
derivadas de um segredo estático via HMAC (padrão "TURN REST API"). Decisão
revertida: o usuário provisionou uma TURN Key na Cloudflare Realtime em vez
de subir infraestrutura própria — mesma lógica de custo/operação que já
levou a decisões parecidas neste projeto (SQLite em vez de Postgres
operado à parte, scrypt em vez de mais uma dependência nativa): dois
mantenedores não ganham nada operando um `coturn` quando um serviço
gerenciado resolve o mesmo problema sem servidor pra manter no ar,
atualizar ou escalar.

Integração: `src/turn/cloudflareTurnProvider.ts` chama
`POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers`
(`fetch` nativo, sem SDK — mesma filosofia do módulo `auth`), autenticado
com `TURN_KEY_API_TOKEN` (`Authorization: Bearer`, segredo de servidor,
nunca chega ao cliente). A resposta da Cloudflare já vem no formato exato
de `RTCConfiguration.iceServers` (array com uma entrada STUN e uma TURN,
username/credential de curta duração) — `POST /v1/turn-credentials`
(issue #41) só repassa isso pro cliente autenticado, sem decidir STUN/TURN
nem montar URL por conta própria. Endpoint/formato confirmados na doc
oficial da Cloudflare em 2026-09-14. Detalhe do contrato completo e do
diagrama de sequência em `docs/WEBRTC_TURN_PLAN.md`.

**Adendo (issue #43/#44, 2026-09-14): limites configuráveis + métricas em
memória, sem serviço externo.** Duas decisões pequenas registradas juntas
por serem a mesma etapa:

- **Rate limit**: as rotas HTTP já usavam `@fastify/rate-limit` com valores
  fixos (issue #43 original). Viraram configuráveis via env
  (`RATE_LIMIT_*`, uma janela só compartilhada — variar isso por rota
  também multiplicaria combinações sem ganho real pra 2 pessoas). Conexão
  WebSocket (`/ws`) ganhou limite próprio (`src/signaling/connectRateLimiter.ts`,
  janela deslizante em memória) em vez de tentar encaixar
  `@fastify/rate-limit` no upgrade de protocolo do `@fastify/websocket` —
  não é uma interação documentada/testada pelos dois plugins juntos, e um
  limitador de ~20 linhas, testável isolado, resolve sem essa incerteza.
- **Métricas**: `src/observability/metrics.ts`, contadores/gauges em
  memória (mesma escolha já feita pra `SignalingRooms`/`PresenceStore` —
  perde estado no restart, aceitável pro tamanho do produto), expostos em
  `GET /metrics` (JSON simples, não Prometheus/OpenMetrics — sem scraper
  configurado ainda, adotar esse formato agora seria decisão sem uso).
  Público como `/health`/`/ready` (só números operacionais, nunca dado de
  usuário) — por isso, como aqueles dois, `/metrics` também fica **fora**
  do `openapi.yaml` (convenção já estabelecida: endpoints operacionais não
  entram no contrato de negócio).
- **Achado no caminho**: uma rota genuinely inexistente (`404` de
  roteamento, não `NotFoundError` de domínio) respondia com o shape
  padrão do Fastify (`{message, error, statusCode}`), não o envelope único
  do contrato (#27), e nunca era contada nas métricas — `app.setNotFoundHandler`
  corrige os dois.

**Adendo (issue #47, 2026-09-14): `journal_mode = WAL` no SQLite — achado
real de teste de capacidade, não decisão especulativa.** Construído um
script de teste de capacidade da camada de sinalização
(`backend/scripts/teste-capacidade-signaling.mjs`, ver
`docs/backend/TESTE_CAPACIDADE_SIGNALING.md` pro detalhe completo) e, ao
rodar com centenas de conexões simultâneas, o setup (registro de
usuários) mostrou degradação claramente super-linear (500 registros:
~10s pros primeiros 100, ~147s no total). Causa: `openDatabase()`
(`src/db/connection.ts`) nunca configurava `journal_mode`, então o SQLite
usava o padrão (rollback journal), que recria/apaga um arquivo de journal
e faz `fsync` a cada transação de escrita — em Windows isso piora com
antivírus/indexação reescaneando o arquivo, e piora ainda mais conforme o
arquivo cresce. Adicionado `PRAGMA journal_mode = WAL` + `PRAGMA
synchronous = NORMAL` (pareamento padrão da própria documentação do
SQLite pra esse cenário — ainda seguro contra corrupção). Resultado
medido, mesmo teste: 147s → 8.4s pros 500 registros (17.6x), curva virou
linear. Isso não é específico do teste sintético — vale pra qualquer
sequência de escritas reais do produto (cadastro, importação em lote
etc.), então é uma correção de produção, não só do ambiente de teste.

**Adendo (issue #49, 2026-09-14): release automatizada via `tauri-apps/tauri-action`
(oficial, fixada por SHA de commit), assinatura de update com chave Ed25519
gerada localmente (`tauri signer generate`), nunca no repositório.**
Decisão de infraestrutura, não muda nada do frontend/cliente em si — a
issue explicitamente proíbe alterar comportamento do app (`não habilitar
atualização automática sem ação do usuário`); só o pipeline de build e o
manifesto que a issue #48 (cliente, @Ruthraas) vai consumir depois.

- **`tauri-apps/tauri-action`** em vez de reimplementar build+empacotamento
  Windows+assinatura+criação de release à mão: é a action oficial do
  próprio projeto Tauri, cobre exatamente esse fluxo, e a "Regra para IA"
  da própria issue pede ação oficial fixada por versão — fixada pelo SHA
  do commit (`action-v1.0.0`), não só a tag, pela mesma razão de qualquer
  pin de dependência de terceiro (tag pode ser recriada apontando pra
  outro commit; SHA não).
- **Assinatura de update é uma chave Ed25519 separada** (formato
  minisign, via `tauri signer generate`) — **não** é um certificado
  Authenticode de code-signing do Windows (isso é um problema/custo
  diferente, não coberto por esta issue; sem ele o instalador continua
  mostrando aviso do SmartScreen, mas isso não impede o updater de
  funcionar). A chave pública mora em `tauri.conf.json`
  (`plugins.updater.pubkey`, seguro de commitar — só serve pra verificar,
  não pra assinar); a privada foi gerada nesta etapa e entregue fora do
  Git (não em texto de PR/commit) — detalhe operacional em
  `docs/backend/RELEASES.md`.
- **`createUpdaterArtifacts: true`** (não a instalação do crate
  `tauri-plugin-updater`) é o que faz o `tauri build` assinar os
  artefatos — mecanismo do bundler/CLI, independente de o app ter o
  plugin de update instalado/inicializado (isso é trabalho da #48,
  cliente). Confirmado na documentação oficial do Tauri antes de
  configurar, pra não arriscar um manifesto mal formado. **Fica só no
  `release.yml`** (mesclado via `tauri build --config
  '{"bundle":{"createUpdaterArtifacts":true}}'`), não em
  `tauri.conf.json` — achado real na primeira tentativa: colocar isso na
  config base faz *qualquer* `tauri build` (inclusive o do
  `frontend-ci.yml`, que roda sem `TAURI_SIGNING_PRIVATE_KEY`) exigir a
  chave privada e falhar. `plugins.updater.pubkey`/`endpoints` continuam
  em `tauri.conf.json` normalmente — só são dados de configuração, não
  disparam a exigência de assinatura sozinhos.
- **Verificação de versão própria** (`scripts/verificar-versao-release.mjs`)
  em vez de confiar só na tag: a issue exige que tag, `package.json`,
  `Cargo.toml` e `tauri.conf.json` batam exatamente, e que uma divergência
  interrompa o workflow antes de publicar qualquer coisa.
- **Release sempre nasce como rascunho**, só vira pública
  (`gh release edit --draft=false`) no último passo do job, condicionado
  a todos os passos anteriores terem passado — garante que uma falha no
  meio do caminho nunca deixa uma release "meio pronta" visível como
  estável.
- **Checksums SHA256** gerados a partir dos arquivos já construídos
  localmente (não baixados de volta do GitHub) e anexados como asset
  extra — "origem rastreável" sem reintroduzir dependência de rede
  desnecessária no próprio job que acabou de gerar os arquivos.

**Adendo (issue #82, 2026-09-14): hospedagem em Fly.io com um Volume
persistente anexado, decisão final do @ProgVictorPe entre quatro rotas
avaliadas (registradas na própria issue).** Mesma lógica de custo/operação
que já guiou SQLite-em-vez-de-Postgres-operado-à-parte e TURN
gerenciado-em-vez-de-coturn: para um time de 2 pessoas, a opção que exige
menos operação contínua e ainda tem chance real de ficar de graça vence,
mesmo quando existe uma opção "mais correta arquiteturalmente" (Turso,
banco sem estado) ou "mais barata pra sempre" (VM crua na Oracle Cloud,
mas com TLS/processo/atualização manuais).

- **Por que não Render/equivalente no plano grátis simples**: disco
  efêmero — todo redeploy (e, em vários planos grátis, todo período de
  inatividade) apaga o arquivo SQLite inteiro. Não é sobre carga, é sobre
  persistência; nenhuma configuração de aplicação resolve isso, só trocar
  de hospedagem ou de banco.
- **Fly.io + Volume não exige nenhuma mudança de código**: mesmo
  `better-sqlite3`, mesmo `HOST`/`PORT`/`DATABASE_PATH` já lidos do
  ambiente (`src/config.ts`, issue #29) — só aponta `DATABASE_PATH` pra
  dentro do Volume montado (`/data`, ver `backend/fly.toml`).
  Migrações continuam rodando sozinhas no boot (`src/index.ts`), inclusive
  em produção.
  - **Exatamente UMA máquina, nunca escalada**: `min_machines_running = 1`
    + `auto_stop_machines = "off"` em `fly.toml`. Dois motivos, não um:
    suspender a máquina derrubaria toda conexão WebSocket de sinalização
    aberta (ao contrário de uma API HTTP stateless, não dá pra só
    "acordar no próximo request"); e `better-sqlite3` não foi desenhado
    pra múltiplos processos escrevendo no mesmo arquivo ao mesmo tempo —
    um Volume do Fly também só monta numa máquina por vez, então escalar
    horizontalmente quebraria de qualquer forma.
  - **Imagem Docker em `node:*-bookworm-slim` (Debian/glibc), não
    Alpine**: `better-sqlite3` só publica prebuild pra glibc (issue #58,
    já documentado em `backend/README.md`) — Alpine (musl) forçaria
    compilar a dependência nativa do zero dentro do build, reintroduzindo
    exatamente o problema que `backend/.npmrc` (`ignore-scripts=true`)
    foi criado pra evitar.
- **Se o limite gratuito do Fly não sustentar na prática**: próximo passo
  registrado é migrar pra Turso (libSQL), não trocar de hospedagem de novo
  — resolve o problema na raiz (backend vira sem estado) e libera
  qualquer hospedagem simples depois, não só uma alternativa pontual. Não
  fazer essa migração especulativamente agora — só se o Fly de fato não
  servir, critério que só a operação real vai confirmar.
- Passo a passo operacional (fora do escopo de decisão de arquitetura) em
  `docs/backend/HOSPEDAGEM.md`.

## 3. Módulos e limites

| Módulo | Responsabilidade | Issue de implementação |
|---|---|---|
| `http` | Rotas REST: grupos, convites, presença, credenciais TURN | #32, #33, #34, #41 |
| `ws` | Servidor de sinalização WebSocket, salas por grupo | #37 |
| `auth` | Autenticação própria: senha, sessão, OAuth (Google/GitHub/Discord), middleware de verificação | #30 |
| `authz` | Policy única de papel (owner/admin/member) aplicada a `http` e `ws` | #35, #39 |
| `data` | Schema/migrações de grupos, membros, convites | #31 |
| `presence` | Heartbeat, TTL, eventos de entrada/saída | #36 |
| `turn` | Integração com Cloudflare Realtime TURN (serviço gerenciado), emissão de credenciais de curta duração | #40, #41 |
| `signaling-protocol` | Contratos versionados de evento (join/leave/offer/answer/ice/…) | #38 |
| `config` | Configuração validada por ambiente, segredos fora do Git | #29 |
| `observability` | Logs estruturados, métricas em memória (`/metrics`), health/readiness | #44 |
| — (transversal) | Limites de uso/anti-abuso: rate limit HTTP configurável, limite de conexão WS, corpo máximo | #43 |

Nenhum desses módulos está implementado ainda — esta issue (#27) entrega só
a documentação e o contrato (`openapi.yaml`); a implementação é rastreada
issue por issue conforme a tabela.

## 4. Versionamento e formato de erro

- Todas as rotas HTTP são prefixadas por versão: `/v1/...`. Uma mudança
  incompatível ganha `/v2/...` em vez de alterar `/v1/...` no lugar.
- Erros seguem um envelope único (ver `openapi.yaml`, schema `Error`):

```json
{
  "error": {
    "code": "invite_expired",
    "message": "O convite expirou.",
    "correlationId": "b3f1c2..."
  }
}
```

- `code` é estável e machine-readable (para o cliente decidir o que fazer);
  `message` é texto pt-BR para exibição direta se o cliente quiser;
  `correlationId` aparece também nos logs do backend para rastrear o pedido
  (issue #44), nunca contém dado sensível.
- O protocolo de sinalização WebSocket tem versionamento próprio, definido
  na issue #38 (cada evento carrega um campo `version`).

## 5. Autenticação (reescrita em 2026-09-12 — issue #30)

O backend deixou de confiar no Firebase Auth e passou a ser dono da própria
identidade: cadastro/login por e-mail+senha e login via OAuth 2.0 (Google,
GitHub, Discord). `Authorization: Bearer <token>` continua o formato do
cabeçalho pra toda rota HTTP (exceto `/health` e `/v1/auth/*`, que são
públicas por definição — não faria sentido exigir sessão pra criar sessão).

**Tokens**: access token (`src/auth/sessionTokens.ts`) é um payload JSON
assinado com HMAC-SHA256 (`SESSION_SIGNING_SECRET`) — `{ uid, email, exp }`
— verificado sem consulta ao banco (rápido, roda em toda requisição), vida
curta (15 min). Refresh token é um valor opaco aleatório; só o **hash**
(SHA-256) fica no banco (`refresh_tokens`), igual à regra de nunca guardar
segredo em texto puro — permite revogação (logout) e rotação (cada uso do
refresh emite um novo e invalida o antigo).

**Senha**: hash com `scrypt` (built-in do `node:crypto`) + salt aleatório +
`PASSWORD_PEPPER` da config — nenhuma dependência nova (`argon2`/`bcrypt`
são módulos nativos; depois da dor do #58 com `better-sqlite3`, evitar mais
um addon nativo pesou na decisão). Comparação em tempo constante
(`timingSafeEqual`). Login com senha errada ou e-mail inexistente responde
o mesmo `401` genérico (`src/routes/auth.ts`) — não dá pra descobrir se uma
conta existe só pela resposta.

**OAuth 2.0** (`src/auth/oauthProviders.ts`): fluxo authorization code
clássico — `GET /v1/auth/oauth/:provider/start` redireciona pro provedor
com um `state` assinado e expirável (10 min, CSRF); `GET
/v1/auth/oauth/:provider/callback` valida o `state`, troca `code` por token
do provedor (`fetch` nativo do Node, sem SDK por provedor) e busca o
perfil, aí emite sessão própria e redireciona pro frontend com os tokens
num **fragmento** da URL (`#access_token=...&refresh_token=...`) — nunca
como query string (não fica em log de servidor/proxy). Erro do provedor
(`?error=...` no callback) nunca é repassado cru; sempre um código genérico
próprio (`provider_error`). Endpoints confirmados nas docs oficiais em
2026-09-12:

**Dois destinos de redirect, escolhidos por `?target=` (2026-09-12,
combinado com @Ruthraas):** existem `OAUTH_FRONTEND_REDIRECT_URL_BROWSER`
(fallback de dev, `src/oauth.tsx`) e `OAUTH_FRONTEND_REDIRECT_URL_DESKTOP`
(deep link `screenshare://` do app empacotado, `src-tauri/src/desktop_auth.rs`)
configurados ao mesmo tempo — antes só existia um valor fixo, o que
impedia testar os dois fluxos contra o mesmo backend. `/start` recebe
`?target=browser|desktop` (o cliente já manda isso —
`buildOAuthStartUrl`/`desktop_oauth_login`); o valor é validado contra essa
allowlist (qualquer coisa fora disso, incluindo ausência, vira "browser")
e embutido dentro do `state` assinado, porque é o único dado que sobrevive
à ida-e-volta pelo provedor (o `/callback` não recebe `target` de volta,
só o que o provedor ecoa). O `/callback` lê o `target` do `state` (mesmo
em caminhos de erro, antes até de validar o resto do pedido) pra saber
pra onde mandar o resultado — sem isso, um erro no fluxo desktop voltaria
por padrão pro navegador dev, quebrando o app empacotado.

| Provedor | Autorização | Troca de código | Perfil |
|---|---|---|---|
| Google | `accounts.google.com/o/oauth2/v2/auth` | `oauth2.googleapis.com/token` (POST form-urlencoded) | `openidconnect.googleapis.com/v1/userinfo` |
| GitHub | `github.com/login/oauth/authorize` | `github.com/login/oauth/access_token` (POST + `Accept: application/json`) | `api.github.com/user` (+ `/user/emails` se privado) |
| Discord | `discord.com/oauth2/authorize` | `discord.com/api/oauth2/token` (POST form-urlencoded, Basic auth) | `discord.com/api/users/@me` |

Credenciais reais de cada provedor (`GOOGLE_CLIENT_ID`/`_SECRET` etc.) são
opcionais na config — sem elas, aquele provedor responde `404` no `/start`
em vez de travar o boot do backend inteiro. Os três provedores (Google,
GitHub, Discord) têm credenciais reais configuradas desde 2026-09-12.

**Identidade de conta OAuth** (`src/auth/userRepository.ts`): a primeira
vez que um `(provider, providerAccountId)` aparece, ou vincula a um usuário
existente com o mesmo e-mail, ou cria um usuário novo (sem senha). Reusar o
mesmo provedor+conta depois é idempotente.

**Adendo (issue #70, 2026-09-14): nome/avatar do provedor entram no access
token, sem endpoint novo.** Cada `fetchProfile` (Google/GitHub/Discord)
agora também extrai `displayName`/`avatarUrl` (opcionais — nunca bloqueiam
login se o provedor não devolver). Persistidos em `users.display_name`/
`users.avatar_url` (não em `oauth_accounts`: um usuário só tem um nome de
exibição por vez) via `UPDATE ... COALESCE(?, coluna)` — sobrescreve só
quando o provedor de fato devolveu um valor nesse login, nunca apaga um
nome/avatar bom por uma resposta incompleta pontual; "o provedor usado por
último vence" é a regra, sem prioridade fixa entre provedores. Decisão
sobre onde expor: em vez de um `GET /v1/me` novo (opção que a issue também
sugeria), os campos entram direto no **access token** — mesmo padrão já
usado pra `uid`/`email` desde a #30 (`src/auth/sessionTokens.ts`), que o
cliente já decodifica localmente sem round-trip. Conta só-senha (sem OAuth
vinculado nunca) não tem nome/avatar do backend — o fallback pro e-mail já
é responsabilidade do frontend, não muda aqui.

## 6. Próximos passos

Ver [`docs/BACKEND.md`](../BACKEND.md) para o backlog completo em ordem de
dependência. Depois desta issue (#27), a sequência natural é #28 (serviço
mínimo com health check) seguida de #29/#30/#31 em paralelo.
