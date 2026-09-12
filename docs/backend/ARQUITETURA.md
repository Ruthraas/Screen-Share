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

## 3. Módulos e limites

| Módulo | Responsabilidade | Issue de implementação |
|---|---|---|
| `http` | Rotas REST: grupos, convites, presença, credenciais TURN | #32, #33, #34, #41 |
| `ws` | Servidor de sinalização WebSocket, salas por grupo | #37 |
| `auth` | Autenticação própria: senha, sessão, OAuth (Google/GitHub/Discord), middleware de verificação | #30 |
| `authz` | Policy única de papel (owner/admin/member) aplicada a `http` e `ws` | #35, #39 |
| `data` | Schema/migrações de grupos, membros, convites | #31 |
| `presence` | Heartbeat, TTL, eventos de entrada/saída | #36 |
| `turn` | Integração com coturn, emissão de credenciais de curta duração | #40, #41 |
| `signaling-protocol` | Contratos versionados de evento (join/leave/offer/answer/ice/…) | #38 |
| `config` | Configuração validada por ambiente, segredos fora do Git | #29 |
| `observability` | Logs estruturados, métricas, health/readiness | #44 |

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
em vez de travar o boot do backend inteiro. Só o Google tem credenciais
reais até agora (2026-09-12); GitHub e Discord aguardam o Ruthraas criar os
apps nas respectivas consoles de desenvolvedor — **isso não é algo que uma
sessão de IA consegue fazer**, precisa de alguém com acesso a essas contas.

**Identidade de conta OAuth** (`src/auth/userRepository.ts`): a primeira
vez que um `(provider, providerAccountId)` aparece, ou vincula a um usuário
existente com o mesmo e-mail, ou cria um usuário novo (sem senha). Reusar o
mesmo provedor+conta depois é idempotente.

## 6. Próximos passos

Ver [`docs/BACKEND.md`](../BACKEND.md) para o backlog completo em ordem de
dependência. Depois desta issue (#27), a sequência natural é #28 (serviço
mínimo com health check) seguida de #29/#30/#31 em paralelo.
