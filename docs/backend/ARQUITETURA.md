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
- `firebase-admin`: o cliente já autentica via Firebase Auth
  (`src/services/firebase.ts`); verificar o mesmo ID token no backend com o
  SDK oficial evita reimplementar verificação de JWT/JWK manualmente
  (issue #30).

## 3. Módulos e limites

| Módulo | Responsabilidade | Issue de implementação |
|---|---|---|
| `http` | Rotas REST: grupos, convites, presença, credenciais TURN | #32, #33, #34, #41 |
| `ws` | Servidor de sinalização WebSocket, salas por grupo | #37 |
| `auth` | Middleware de verificação de token, identidade normalizada | #30 |
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

## 5. Autenticação

O cliente já usa `src/services/firebase.ts` para login — a autenticação de
requisições ao backend usa o **token do Firebase Auth** emitido para esse
mesmo usuário, enviado como `Authorization: Bearer <idToken>`. A verificação
do token (assinatura, expiração, normalização da identidade) é escopo da
issue #30; aqui só se define o formato do cabeçalho e os códigos de erro
(`401 unauthorized`, `403 forbidden`) usados por todas as rotas.

## 6. Próximos passos

Ver [`docs/BACKEND.md`](../BACKEND.md) para o backlog completo em ordem de
dependência. Depois desta issue (#27), a sequência natural é #28 (serviço
mínimo com health check) seguida de #29/#30/#31 em paralelo.
