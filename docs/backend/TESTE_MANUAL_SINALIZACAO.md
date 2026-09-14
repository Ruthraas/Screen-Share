# Roteiro de teste — transmissão de tela (backend + app)

Documento vivo (atualizar conforme o frontend for ligando as partes que
faltam). Objetivo: dizer exatamente o que já dá pra testar de verdade hoje,
o que ainda é só mock/local, e como validar cada parte.

## 0. Antes de tudo — o que é real e o que é mock hoje (atualizado 2026-09-14)

O achado mais importante deste roteiro ainda vale, só que com escopo menor
do que antes: **o app já captura tela de verdade e já usa grupos reais,
mas ainda não manda essa tela pra outro participante.**

| Parte | Estado |
|---|---|
| Cadastro/login por e-mail+senha | **Real** — chama o backend (`src/services/authClient.ts`) |
| Login OAuth (Google/GitHub/Discord) | **Real** — chama o backend, inclusive o fluxo desktop via deep link |
| Grupos/convites (`/v1/groups`, `/v1/invites`) | **Real desde 2026-09-13** (issue #60) — `src/services/groupsApi.ts` chama o backend de verdade; `MultiScreen.tsx` mostra grupo/membros reais, "copiar convite" gera um convite de verdade |
| Captura de tela local (Windows Graphics Capture nativo, com áudio de sistema opcional) | **Real desde 2026-09-13** (issue #8/#18/#72) — `src-tauri/src/capture.rs` + `useLocalCapture.ts`; **é 100% nativo Rust, não `getDisplayMedia`** (decisão explícita: só o app empacotado, nunca navegador). `Share.tsx` já deixa escolher fonte (grid com miniatura real), qualidade e áudio, e mostra a tela capturada no `ScreenViewer` — só que **só pra você mesmo**, o próprio app avisa: *"so voce ve sua tela por enquanto — enviar pra outros participantes ainda nao esta disponivel"* |
| Presença (`/v1/groups/:id/presence`) | Implementado e testado **no backend**; **frontend ainda não chama** |
| Sinalização WebSocket (`/ws`, offer/answer/ICE/peer-reconnected) | Implementado e testado **no backend** (inclusive reconexão — issue #42); **frontend ainda não tem cliente WebSocket** — issue [#71](https://github.com/Ruthraas/Screen-Share/issues/71), em aberto (só existe um doc de plano, `docs/WEBRTC_TURN_PLAN.md`, implementação não começou) |
| Credenciais TURN (`POST /v1/turn-credentials`) | **Real desde 2026-09-14** (issue #40/#41, Cloudflare Realtime) — validado ponta a ponta contra a API real da Cloudflare, `iceServers` de verdade emitidos |
| Conexão P2P (`RTCPeerConnection`) | **Não existe no código ainda** — depende da #71 acima |
| Tela "Multi-Screen" do app | Grupo/membros já são reais; o texto ainda avisa que a conexão entre participantes não está habilitada — isso é preciso, não é mock esquecido |

Ou seja: **dá pra validar o backend inteiro de ponta a ponta hoje** (seção
1), **dá pra testar login de verdade pelo app** (seção 2), e **dá pra
testar captura de tela local e grupos reais pelo app** (você vê sua
própria tela, cria/entra em grupos de verdade). Mas **ainda não dá pra
testar duas pessoas vendo a tela um do outro pelo app** — falta a #71
(cliente WebSocket + `RTCPeerConnection`, @Ruthraas). A seção 3 lista
exatamente o que falta pra isso ser possível.

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
reais fariam — só que com um SDP falso no lugar de mídia de verdade (a
captura de tela local já é real, ver seção 0, mas ainda não tem cliente
WebRTC do lado do cliente pra gerar um SDP de verdade). Também simula uma
reconexão (Alice cai e volta com uma conexão nova) pra provar `peer-reconnected`
sem `peer-left` espúrio (issue #42), e por fim chama
`POST /v1/turn-credentials` de verdade contra a Cloudflare (issue #40/#41)
— se a `TURN_KEY_ID` do `.env` não for válida na conta, isso aparece como
um aviso (⚠), não como falha do script, já que é uma pendência externa,
não um bug de código. Termina imprimindo quantos passos passaram.

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

Três das quatro peças já saíram do jeito antigo (~~grupos mock~~, ~~sem
captura de tela~~, ~~sem TURN~~ — issues #60, #8/#18/#72 e #40/#41, todas
landed). Falta só o que a issue
[#71](https://github.com/Ruthraas/Screen-Share/issues/71) já escopa (nada
disso é trabalho de backend — o backend já suporta tudo isso, provado na
seção 1):

1. **Cliente WebSocket** que conecta em `/ws?token=...&groupId=...` e fala o
   protocolo de `docs/backend/openapi.yaml`/`src/signaling/protocol.ts`
   (mensagens `offer`/`answer`/`ice-candidate`/`stream-started`/
   `stream-stopped`, todas com `v: 1` e `correlationId` — e agora também
   `peer-reconnected`, issue #42: chega no lugar de `peer-joined` quando um
   participante já estava na sala e só trocou de conexão; é o sinal pra
   tentar ICE restart em vez de tratar como entrada nova).
2. **`RTCPeerConnection`** de verdade usando o `/ws` acima só pra
   sinalização (nunca pra mídia) — anexar as tracks do `MediaStream` real
   que `useLocalCapture.ts` já produz (issue #8) como tracks de saída,
   trocar offer/answer/ICE reais no lugar do SDP fake do script da seção 1,
   e entregar o stream remoto pro `ScreenViewer` (contrato já pronto, só
   consumir).
3. Usar as credenciais TURN reais de `POST /v1/turn-credentials` (#41,
   pronto e já validado com a Cloudflare de verdade) como `iceServers` do
   `RTCPeerConnection` — resolve conexão fora da LAN também, não só mesma
   rede/STUN. Nada pendente do lado backend pra isso (ver
   `docs/WEBRTC_TURN_PLAN.md` pro contrato completo). `#47` (teste de
   capacidade) fica pra depois disso funcionar de ponta a ponta.

Plano completo de integração (diagrama de sequência) em
`docs/WEBRTC_TURN_PLAN.md`.

## 4. Achado e corrigido durante este roteiro (2026-09-12): erro desconhecido virava 500

Rodando o script da seção 1, uma chamada `POST` sem corpo mas com
`Content-Type: application/json` (erro no próprio script na primeira
tentativa) fez o Fastify recusar o corpo vazio
(`FST_ERR_CTP_EMPTY_JSON_BODY`, um erro que já vem com `statusCode: 400`) —
só que o `setErrorHandler` central (`src/server.ts`) só reconhecia as
classes de erro de domínio (`ValidationError`, `UnauthorizedError`, etc.) e
jogava **qualquer outra coisa pro branch de 500**, mesmo quando o próprio
erro já dizia qual status usar. Um cliente real que monte requisições assim
(comum em wrappers de HTTP que sempre setam `Content-Type`) receberia 500
em vez de 400.

**Corrigido**: o `setErrorHandler` agora lê `statusCode` de qualquer erro
não reconhecido (`statusCodeOf()`) e, se for um 4xx, responde com esse
status e `code: "bad_request"` em vez de cair no 500 genérico — só erros
sem `statusCode` conhecido (ou 5xx de verdade) continuam virando 500.
Validado com teste de regressão (`src/server.test.ts`) e confirmado via
HTTP real contra o processo: `POST /v1/auth/register` com
`Content-Type: application/json` e corpo vazio agora responde
`400 {"error":{"code":"bad_request",...}}`.
