# Roteiro de teste — transmissão de tela (backend + app)

Documento vivo (atualizar conforme o frontend for ligando as partes que
faltam). Objetivo: dizer exatamente o que já dá pra testar de verdade hoje,
o que ainda é só mock/local, e como validar cada parte.

## 0. Antes de tudo — o que é real e o que é mock hoje (2026-09-12)

Isto é o achado mais importante deste roteiro, então vai primeiro: **o app
ainda não faz transmissão de tela de verdade nenhuma.**

| Parte | Estado |
|---|---|
| Cadastro/login por e-mail+senha | **Real** — chama o backend (`src/services/authClient.ts`) |
| Login OAuth (Google/GitHub/Discord) | **Real** — chama o backend, inclusive o fluxo desktop via deep link |
| Grupos/convites (`/v1/groups`, `/v1/invites`) | Implementado e testado **no backend**; **nenhuma tela do frontend chama isso ainda** |
| Presença (`/v1/groups/:id/presence`) | Implementado e testado **no backend**; **frontend não chama** |
| Sinalização WebSocket (`/ws`, offer/answer/ICE) | Implementado e testado **no backend**; **frontend não tem cliente WebSocket nenhum** |
| Captura de tela (`getDisplayMedia`) | **Não existe no código ainda** |
| Conexão P2P (`RTCPeerConnection`) | **Não existe no código ainda** |
| Tela "Multi-Screen" do app | Mostra dados **locais/mock** (`src/pages/MultiScreen.tsx`) — o próprio texto da tela diz isso: *"grupo local. conexoes entre participantes ainda nao estao habilitadas"* |

Ou seja: **dá pra validar o backend inteiro de ponta a ponta hoje** (seção
1), e **dá pra testar login de verdade pelo app** (seção 2). Mas **não dá
pra testar duas pessoas compartilhando tela pelo app** ainda — falta o
frontend ligar grupos/sinalização/captura de mídia (issue #20 e
correlatas). A seção 3 lista exatamente o que falta pra isso ser possível.

## 1. Validar o backend de ponta a ponta (automatizado, já dá pra rodar)

Prova que auth + grupos + convites + presença + sinalização funcionam
**juntos**, de verdade, pela rede — não só isolados como nos testes
automatizados (`npm test`, que usa `.inject()` sem servidor de verdade).

```bash
cd backend
npm run dev          # deixa rodando num terminal
```

Em outro terminal:

```bash
cd backend
npm run test:e2e-manual
```

O script (`backend/scripts/testar-fluxo-completo.mjs`) registra dois
usuários reais (Alice e Bob), Alice cria um grupo e um convite, Bob aceita,
os dois mandam heartbeat/consultam presença, conectam no `/ws` de verdade e
trocam `offer`/`answer`/`ice-candidate`/`stream-started` como dois clientes
reais fariam — só que com um SDP falso no lugar de mídia de verdade (não
tem captura de tela ainda, ver seção 0). Termina imprimindo quantos passos
passaram.

Pra testar contra um backend rodando em outra máquina da rede (ele já
escuta em `0.0.0.0`, então a IP da LAN funciona sem mudar nada):

```bash
API_URL=http://<ip-da-lan>:8787 npm run test:e2e-manual
```

Rode isso de novo sempre que mexer em auth/grupos/convites/presença/
sinalização — é o jeito mais rápido de saber se alguma mudança quebrou a
integração entre os módulos sem precisar montar o cenário na mão.

## 2. Validar login de verdade pelo app (manual, hoje já dá)

Isso já é real — vale testar pelo app empacotado, não só pela API:

1. Suba o backend (`npm run dev`) com `backend/.env` configurado (as três
   credenciais OAuth + `OAUTH_REDIRECT_BASE_URL` +
   `OAUTH_FRONTEND_REDIRECT_URL_BROWSER`/`_DESKTOP`, todas obrigatórias —
   ver `backend/.env.example`).
2. Abra o app (Tauri, `npm run tauri dev` na raiz do repo, ou o instalado).
3. Cadastro por e-mail+senha → confirmar que a sessão persiste (fechar e
   reabrir o app continua logado).
4. Login com Google, GitHub e Discord, um de cada vez → confirmar que o
   navegador abre, você autoriza, e o app recebe a sessão de volta pelo
   deep link `screenshare://oauth-callback` (não precisa fechar o app).
5. Logout → confirmar que desloga de verdade (não só na tela, testar que o
   refresh token antigo não funciona mais tentando reusar).

Se algo aqui falhar, é bug de verdade — essa parte não é mock.

## 3. O que falta pra testar transmissão de tela de verdade (pro Ruthraas)

Pra sair do "grupo local" (`MultiScreen.tsx`) pra uma sessão real entre duas
pessoas, falta no **frontend** (nada disso é trabalho de backend — o
backend já suporta tudo isso, provado na seção 1):

1. **Trocar os dados mock de grupo/membros por chamadas reais** a
   `/v1/groups`, `/v1/invites` (via `authClient`-style client autenticado,
   igual ao que já existe pra auth).
2. **Cliente WebSocket** que conecta em `/ws?token=...&groupId=...` e fala o
   protocolo de `docs/backend/openapi.yaml`/`src/signaling/protocol.ts`
   (mensagens `offer`/`answer`/`ice-candidate`/`stream-started`/
   `stream-stopped`, todas com `v: 1` e `correlationId`).
3. **Captura de tela** via `getDisplayMedia` (não pode ser dentro de um
   WebView embutido sem gesto do usuário — confirmar que o Tauri permite).
4. **`RTCPeerConnection`** de verdade usando o `/ws` acima só pra
   sinalização (nunca pra mídia) — trocar offer/answer/ICE reais no lugar
   do SDP fake do script da seção 1.
5. Só depois disso faz sentido decidir sobre TURN (#40/#41/#47, já
   combinado que fica pra depois) — sem TURN, a conexão P2P só funciona
   entre redes que conseguem se conectar direto ou via STUN (ex.: mesma
   rede local), o que já é suficiente pra um primeiro teste real entre duas
   máquinas na mesma LAN.

## 4. Achado durante este roteiro (2026-09-12): erro desconhecido vira 500

Rodando o script da seção 1, uma chamada `POST` sem corpo mas com
`Content-Type: application/json` (erro no próprio script na primeira
tentativa, corrigido) fez o Fastify recusar o corpo vazio
(`FST_ERR_CTP_EMPTY_JSON_BODY`, um erro que já vem com `statusCode: 400`) —
só que o `setErrorHandler` central (`src/server.ts`) só reconhece as classes
de erro de domínio (`ValidationError`, `UnauthorizedError`, etc.) e joga
**qualquer outra coisa pro branch de 500**, mesmo quando o próprio erro já
diz qual status usar. Um cliente real que monte requisições assim (comum em
wrappers de HTTP que sempre setam `Content-Type`) receberia 500 em vez de
400. Não corrigido ainda nesta etapa — ver se vale abrir como issue
separada ou corrigir junto da próxima mudança em `src/server.ts`.
